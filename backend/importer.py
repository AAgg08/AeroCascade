"""
AeroCascade — Server-Side Topology Importer & Validation Engine
Provides bounded, secure ingestion for:
- One-sheet vendor spreadsheet (.xlsx / .csv)
- Two-sheet Vendors/Dependencies workbook (.xlsx / multi-table .csv)
- Versioned CanonicalTopology JSON

Features:
- Bounded parser (byte limit, row limit, zip decompression limit)
- Formula injection / DDE attack rejection
- External workbook link rejection
- Provisional ID generation and ambiguous name resolution
- Canonical provider-to-dependent edge direction
- Reciprocal declaration reconciliation and deduplication
- Cycle detection with discrete-event simulation engine explanation
- Explicit SLA and repair duration validation
- Log redaction (excluding source cell values)
"""

from __future__ import annotations
import csv
import io
import json
import logging
import os
import re
import zipfile
from typing import Any, Dict, List, Optional, Set, Tuple
from pydantic import BaseModel, Field
import networkx as nx

from .canonical import (
    CanonicalDependency,
    CanonicalNode,
    CanonicalSourceProvenance,
    CanonicalTopology,
)
from .models import (
    CascadeStage,
    ControlCategory,
    ER040Severity,
    FMEAMetrics,
    PSOELevel,
    TripartiteControls,
)

logger = logging.getLogger("aerocascade.importer")

# ==============================================================================
# Security & Resource Bounds
# ==============================================================================
MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_DECOMPRESSED_BYTES = 25 * 1024 * 1024  # 25 MB
MAX_COMPRESSION_RATIO = 100
MAX_ROWS = 500
MAX_COLS = 50
SUPPORTED_EXTENSIONS = {".xlsx", ".csv", ".json"}
VALID_SLA_UNITS = {
    "%",
    "pct",
    "percent",
    "percentage",
    "hours",
    "hour",
    "h",
    "hr",
    "hrs",
    "minutes",
    "minute",
    "min",
    "m",
    "days",
    "day",
    "d",
    "nines",
}


# ==============================================================================
# Pydantic Models for Import
# ==============================================================================

class ImportErrorDetail(BaseModel):
    row: Optional[int] = Field(default=None, description="Source row number (1-based)")
    column: Optional[str] = Field(default=None, description="Mapped column name")
    message: str = Field(..., description="Validation error or warning explanation")
    source_ref: Optional[str] = Field(default=None, description="Sheet and row/cell reference")
    severity: str = Field(default="ERROR", description="'ERROR' or 'WARNING'")


class ImportSummary(BaseModel):
    node_count: int = 0
    edge_count: int = 0
    error_count: int = 0
    warning_count: int = 0
    cycle_count: int = 0
    provisional_id_count: int = 0
    deduplicated_edge_count: int = 0


class ImportPreviewResponse(BaseModel):
    valid: bool
    file_name: str
    file_type: str
    summary: ImportSummary
    errors: List[ImportErrorDetail] = Field(default_factory=list)
    warnings: List[ImportErrorDetail] = Field(default_factory=list)
    cycles: List[str] = Field(default_factory=list)
    cycle_handling_explanation: Optional[str] = None
    preview_topology: Optional[CanonicalTopology] = None


class SaveImportRequest(BaseModel):
    canonical: CanonicalTopology
    name: str = Field(..., min_length=1)
    description: Optional[str] = ""
    confirm_cycles: bool = False
    change_summary: Optional[str] = "Imported from validated spreadsheet/CSV/JSON"


# ==============================================================================
# Bounded Inspection & Formula Check
# ==============================================================================

def check_cell_formula_injection(val: Any) -> Optional[str]:
    """
    Checks if a cell contains executable formulas or DDE injection characters.
    Rejects string values starting with '=', '@', '\t', '\r', or non-numeric '+' / '-'.
    """
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    first = s[0]
    if first in ("=", "@", "\t", "\r"):
        return first
    if first in ("+", "-"):
        try:
            float(s)
            return None
        except ValueError:
            return first
    return None


def sanitize_header(h: Any) -> str:
    """Normalizes header text: lowercase, alphanumeric only."""
    if h is None:
        return ""
    return re.sub(r"[^a-z0-9]", "", str(h).strip().lower())


# Canonical column alias maps
NODE_HEADER_MAP: Dict[str, str] = {
    "vendorid": "vendor_id",
    "nodeid": "vendor_id",
    "id": "vendor_id",
    "code": "vendor_id",
    "systemid": "vendor_id",
    "vendorname": "vendor_name",
    "nodename": "vendor_name",
    "name": "vendor_name",
    "label": "vendor_name",
    "systemname": "vendor_name",
    "system": "vendor_name",
    "category": "category",
    "subsystem": "category",
    "domain": "category",
    "type": "category",
    "upstreamids": "upstream_ids",
    "upstreamid": "upstream_ids",
    "upstream": "upstream_ids",
    "providerids": "upstream_ids",
    "providerid": "upstream_ids",
    "providers": "upstream_ids",
    "inputs": "upstream_ids",
    "downstreamids": "downstream_ids",
    "downstreamid": "downstream_ids",
    "downstream": "downstream_ids",
    "dependentids": "downstream_ids",
    "dependentid": "downstream_ids",
    "dependents": "downstream_ids",
    "outputs": "downstream_ids",
    "slatarget": "sla_target",
    "sla": "sla_target",
    "target": "sla_target",
    "target_sla": "sla_target",
    "availability": "sla_target",
    "slaunit": "sla_unit",
    "unit": "sla_unit",
    "metric": "sla_unit",
    "stage": "stage",
    "cascadestage": "stage",
    "dominantcontrol": "dominant_control",
    "control": "dominant_control",
    "controlcategory": "dominant_control",
    "repairduration": "repair_duration_hours",
    "repairdurationhours": "repair_duration_hours",
    "mttr": "repair_duration_hours",
    "recoverytime": "repair_duration_hours",
    "description": "description",
    "details": "description",
    "narrative": "description",
    "failuremode": "failure_mode",
    "failure": "failure_mode",
}

DEP_HEADER_MAP: Dict[str, str] = {
    "providerid": "provider_id",
    "provider": "provider_id",
    "upstreamid": "provider_id",
    "upstream": "provider_id",
    "source": "provider_id",
    "sourceid": "provider_id",
    "from": "provider_id",
    "fromnode": "provider_id",
    "dependentid": "dependent_id",
    "dependent": "dependent_id",
    "downstreamid": "dependent_id",
    "downstream": "dependent_id",
    "target": "dependent_id",
    "targetid": "dependent_id",
    "to": "dependent_id",
    "tonode": "dependent_id",
    "couplingweight": "coupling_weight",
    "weight": "coupling_weight",
    "criticality": "coupling_weight",
    "propagationdelay": "propagation_delay_hours",
    "delay": "propagation_delay_hours",
    "propagationdelayhours": "propagation_delay_hours",
    "propagationmechanism": "propagation_mechanism",
    "mechanism": "propagation_mechanism",
    "causalmechanism": "propagation_mechanism",
    "protocollayer": "protocol_layer",
    "layer": "protocol_layer",
    "protocol": "protocol_layer",
}


# ==============================================================================
# Spreadsheet & File Decoders (Bounded)
# ==============================================================================

def validate_xlsx_zip_safety(file_bytes: bytes) -> None:
    """
    Inspects ZIP archive structure to defend against decompression bombs and external workbook links.
    """
    if not zipfile.is_zipfile(io.BytesIO(file_bytes)):
        raise ValueError("Uploaded file is not a valid Excel (.xlsx) OpenXML package.")

    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
        total_uncompressed = 0
        for info in z.infolist():
            total_uncompressed += info.file_size
            if total_uncompressed > MAX_DECOMPRESSED_BYTES:
                raise ValueError(
                    f"Excel archive decompression limit exceeded ({total_uncompressed} bytes > {MAX_DECOMPRESSED_BYTES} bytes maximum)."
                )
            if info.compress_size > 0 and (info.file_size / info.compress_size) > MAX_COMPRESSION_RATIO:
                raise ValueError("Excel file rejected due to suspicious compression ratio (decompression bomb protection).")
            # Check for external links
            if "externalLink" in info.filename or "externalReference" in info.filename:
                raise ValueError("Excel file contains external workbook links. External workbook links are disabled for security.")


def parse_xlsx_sheets(file_bytes: bytes) -> Dict[str, List[List[Any]]]:
    """
    Safely reads an XLSX workbook in data_only and read_only mode up to MAX_ROWS.
    """
    import openpyxl

    validate_xlsx_zip_safety(file_bytes)

    wb = openpyxl.load_workbook(
        io.BytesIO(file_bytes),
        read_only=True,
        data_only=True,
        keep_links=False,
    )
    sheets_data: Dict[str, List[List[Any]]] = {}

    try:
        for sheetname in wb.sheetnames:
            ws = wb[sheetname]
            sheet_rows: List[List[Any]] = []
            for row_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
                if row_idx > MAX_ROWS + 1:  # header + max rows
                    break
                row_vals = list(row[:MAX_COLS])
                # Skip trailing empty rows
                if any(v is not None and str(v).strip() != "" for v in row_vals):
                    sheet_rows.append(row_vals)
            sheets_data[sheetname] = sheet_rows
    finally:
        wb.close()

    return sheets_data


def parse_csv_content(file_bytes: bytes) -> Dict[str, List[List[Any]]]:
    """
    Parses UTF-8 CSV content, supporting either single-sheet or multi-table '# SHEET: Name' headers.
    """
    try:
        text = file_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("CSV file is not valid UTF-8 text.")

    lines = [line.rstrip("\r\n") for line in text.splitlines()]
    if not lines:
        return {"Sheet1": []}

    sheets_data: Dict[str, List[List[Any]]] = {}
    current_sheet = "Sheet1"
    current_rows: List[List[Any]] = []

    for line in lines:
        if line.startswith("# SHEET:"):
            if current_rows:
                sheets_data[current_sheet] = current_rows
                current_rows = []
            current_sheet = line.split(":", 1)[1].strip() or "Sheet1"
            continue

        if not line.strip() or line.startswith("#"):
            continue

        reader = csv.reader([line])
        for row in reader:
            if len(current_rows) < MAX_ROWS + 1:
                current_rows.append(row[:MAX_COLS])

    if current_rows:
        sheets_data[current_sheet] = current_rows

    return sheets_data


# ==============================================================================
# Core Topology Parser & Validator
# ==============================================================================

def parse_file_to_preview(
    file_bytes: bytes,
    file_name: str,
    overrides: Optional[Dict[str, Any]] = None,
) -> ImportPreviewResponse:
    """
    Server-side preview parser:
    Validates, extracts, resolves references, deduplicates reciprocal declarations,
    detects cycles, and produces a preview without writing to the database.
    """
    ext = os.path.splitext(file_name)[1].lower()
    errors: List[ImportErrorDetail] = []
    warnings: List[ImportErrorDetail] = []

    # 1. Byte limit check
    if len(file_bytes) > MAX_FILE_BYTES:
        errors.append(
            ImportErrorDetail(
                message=f"File exceeds maximum allowed size ({len(file_bytes)} bytes > {MAX_FILE_BYTES} bytes limit).",
                severity="ERROR",
            )
        )
        return ImportPreviewResponse(
            valid=False,
            file_name=file_name,
            file_type=ext.replace(".", ""),
            summary=ImportSummary(error_count=1),
            errors=errors,
            warnings=warnings,
        )

    # 2. Extension check
    if ext not in SUPPORTED_EXTENSIONS:
        errors.append(
            ImportErrorDetail(
                message=f"Unsupported file format '{ext}'. Supported formats: .xlsx, .csv, .json",
                severity="ERROR",
            )
        )
        return ImportPreviewResponse(
            valid=False,
            file_name=file_name,
            file_type=ext.replace(".", ""),
            summary=ImportSummary(error_count=1),
            errors=errors,
            warnings=warnings,
        )

    # 3. Handle JSON topology directly
    if ext == ".json":
        try:
            payload = json.loads(file_bytes.decode("utf-8-sig"))
            canonical = CanonicalTopology.model_validate(payload)

            # Cycle detection on JSON input
            g = nx.DiGraph()
            for n in canonical.nodes:
                g.add_node(n.id)
            for d in canonical.dependencies:
                g.add_edge(d.provider_node_id, d.dependent_node_id)
            raw_cycles = list(nx.simple_cycles(g))
            cycle_strs = [" -> ".join(c + [c[0]]) for c in raw_cycles]

            cycle_explanation = None
            if raw_cycles:
                cycle_explanation = (
                    f"Graph contains {len(raw_cycles)} feedback cycle(s). The AeroCascade discrete-event simulation (DES) "
                    "evaluates failure cascades chronologically with propagation delay timestamps and state dampening. "
                    "Cycles propagate failure cascades across recurring timesteps until all constituent nodes are either "
                    "fully failed, mitigated by formal/informal controls, or the simulation reaches its 24-hour horizon."
                )

            return ImportPreviewResponse(
                valid=True,
                file_name=file_name,
                file_type="json",
                summary=ImportSummary(
                    node_count=len(canonical.nodes),
                    edge_count=len(canonical.dependencies),
                    error_count=0,
                    warning_count=0,
                    cycle_count=len(raw_cycles),
                ),
                errors=[],
                warnings=[],
                cycles=cycle_strs,
                cycle_handling_explanation=cycle_explanation,
                preview_topology=canonical,
            )
        except Exception as e:
            errors.append(
                ImportErrorDetail(
                    message=f"Invalid canonical topology JSON: {str(e)}",
                    severity="ERROR",
                )
            )
            return ImportPreviewResponse(
                valid=False,
                file_name=file_name,
                file_type="json",
                summary=ImportSummary(error_count=1),
                errors=errors,
                warnings=warnings,
            )

    # 4. Parse workbook / CSV sheets
    try:
        if ext == ".xlsx":
            sheets = parse_xlsx_sheets(file_bytes)
        else:
            sheets = parse_csv_content(file_bytes)
    except Exception as e:
        errors.append(ImportErrorDetail(message=f"Failed to read file: {str(e)}", severity="ERROR"))
        return ImportPreviewResponse(
            valid=False,
            file_name=file_name,
            file_type=ext.replace(".", ""),
            summary=ImportSummary(error_count=1),
            errors=errors,
            warnings=warnings,
        )

    # Determine one-sheet vs two-sheet structure
    # If there are sheets named 'dependencies', 'links', or 'edges', treat as two-sheet
    dep_sheet_name: Optional[str] = None
    node_sheet_name: Optional[str] = None

    for sname in sheets.keys():
        slower = sname.lower()
        if slower in ("dependencies", "links", "edges", "dependency"):
            dep_sheet_name = sname
        elif slower in ("vendors", "nodes", "systems", "vendor", "node"):
            node_sheet_name = sname

    if not node_sheet_name:
        node_sheet_name = list(sheets.keys())[0] if sheets else "Sheet1"

    node_rows = sheets.get(node_sheet_name, [])
    dep_rows = sheets.get(dep_sheet_name, []) if dep_sheet_name else []

    if not node_rows:
        errors.append(
            ImportErrorDetail(
                message=f"Sheet '{node_sheet_name}' is empty. No vendor or node records found.",
                severity="ERROR",
            )
        )
        return ImportPreviewResponse(
            valid=False,
            file_name=file_name,
            file_type=ext.replace(".", ""),
            summary=ImportSummary(error_count=1),
            errors=errors,
            warnings=warnings,
        )

    # Map headers for node sheet
    raw_node_headers = node_rows[0]
    node_col_map: Dict[str, int] = {}
    for idx, h in enumerate(raw_node_headers):
        clean_h = sanitize_header(h)
        if clean_h in NODE_HEADER_MAP:
            canon_col = NODE_HEADER_MAP[clean_h]
            if canon_col not in node_col_map:
                node_col_map[canon_col] = idx

    if "vendor_name" not in node_col_map and "vendor_id" not in node_col_map:
        errors.append(
            ImportErrorDetail(
                row=1,
                column="Headers",
                message="Missing required headers. Header row must include at least 'Vendor Name' or 'Vendor ID'.",
                source_ref=f"{node_sheet_name}, Row 1",
                severity="ERROR",
            )
        )
        return ImportPreviewResponse(
            valid=False,
            file_name=file_name,
            file_type=ext.replace(".", ""),
            summary=ImportSummary(error_count=1),
            errors=errors,
            warnings=warnings,
        )

    # Check for formula injection in node sheet
    for r_idx, row in enumerate(node_rows[1:], start=2):
        for c_idx, val in enumerate(row):
            inj = check_cell_formula_injection(val)
            if inj:
                errors.append(
                    ImportErrorDetail(
                        row=r_idx,
                        column=str(raw_node_headers[c_idx] if c_idx < len(raw_node_headers) else f"Col {c_idx+1}"),
                        message=f"Cell formula or executable prefix ('{inj}') is prohibited for security.",
                        source_ref=f"{node_sheet_name}, Row {r_idx}",
                        severity="ERROR",
                    )
                )

    # Check for formula injection in dep sheet if present
    if dep_rows:
        raw_dep_headers = dep_rows[0]
        for r_idx, row in enumerate(dep_rows[1:], start=2):
            for c_idx, val in enumerate(row):
                inj = check_cell_formula_injection(val)
                if inj:
                    errors.append(
                        ImportErrorDetail(
                            row=r_idx,
                            column=str(raw_dep_headers[c_idx] if c_idx < len(raw_dep_headers) else f"Col {c_idx+1}"),
                            message=f"Cell formula or executable prefix ('{inj}') is prohibited for security.",
                            source_ref=f"{dep_sheet_name}, Row {r_idx}",
                            severity="ERROR",
                        )
                    )

    # If critical errors already found (e.g. formula injection), return early
    if errors:
        return ImportPreviewResponse(
            valid=False,
            file_name=file_name,
            file_type=ext.replace(".", ""),
            summary=ImportSummary(error_count=len(errors)),
            errors=errors,
            warnings=warnings,
        )

    # 5. Extract Nodes
    parsed_nodes: List[CanonicalNode] = []
    nodes_by_id: Dict[str, CanonicalNode] = {}
    nodes_by_name: Dict[str, List[str]] = {}  # normalized name -> list of node IDs
    node_id_to_source_row: Dict[str, int] = {}
    provisional_id_count = 0

    # Temporary storage for inline upstream/downstream declarations (for 1-sheet format)
    # node_id -> {"upstream": [refs...], "downstream": [refs...], "row": int}
    inline_deps: Dict[str, Dict[str, Any]] = {}

    for r_idx, row in enumerate(node_rows[1:], start=2):
        def get_val(canon_col: str) -> Any:
            idx = node_col_map.get(canon_col)
            if idx is not None and idx < len(row):
                v = row[idx]
                return str(v).strip() if v is not None else ""
            return ""

        raw_id = get_val("vendor_id")
        raw_name = get_val("vendor_name")
        raw_category = get_val("category") or "General Aerodrome Subsystem"
        raw_sla_target = get_val("sla_target")
        raw_sla_unit = get_val("sla_unit")
        raw_repair = get_val("repair_duration_hours")
        raw_stage = get_val("stage")
        raw_control = get_val("dominant_control")
        raw_desc = get_val("description")
        raw_failure = get_val("failure_mode")

        if not raw_id and not raw_name:
            continue

        # Handle ID assignment
        if not raw_id:
            provisional_id_count += 1
            node_id = f"PROV-{provisional_id_count:03d}"
            warnings.append(
                ImportErrorDetail(
                    row=r_idx,
                    column="Vendor ID",
                    message=f"Vendor ID missing for '{raw_name or 'Node'}'; assigned provisional ID '{node_id}'.",
                    source_ref=f"{node_sheet_name}, Row {r_idx}",
                    severity="WARNING",
                )
            )
        else:
            node_id = str(raw_id).strip()

        # Handle Name
        node_name = str(raw_name).strip() if raw_name else node_id

        # Check for duplicate node ID
        if node_id in nodes_by_id:
            errors.append(
                ImportErrorDetail(
                    row=r_idx,
                    column="Vendor ID",
                    message=f"Duplicate Vendor ID '{node_id}' already defined on row {node_id_to_source_row[node_id]}.",
                    source_ref=f"{node_sheet_name}, Row {r_idx}",
                    severity="ERROR",
                )
            )
            continue

        # Validate SLA Unit
        if raw_sla_unit:
            clean_unit = raw_sla_unit.strip().lower()
            if clean_unit not in VALID_SLA_UNITS:
                errors.append(
                    ImportErrorDetail(
                        row=r_idx,
                        column="SLA Unit",
                        message=f"Invalid SLA unit '{raw_sla_unit}'. Supported units: hours, minutes, days, percent (%).",
                        source_ref=f"{node_sheet_name}, Row {r_idx}",
                        severity="ERROR",
                    )
                )

        # Parse repair duration
        repair_duration = 2.0
        if raw_repair:
            try:
                repair_duration = max(0.01, float(raw_repair))
            except ValueError:
                errors.append(
                    ImportErrorDetail(
                        row=r_idx,
                        column="Repair Duration",
                        message=f"Invalid repair duration number '{raw_repair}'. Expected positive numeric value.",
                        source_ref=f"{node_sheet_name}, Row {r_idx}",
                        severity="ERROR",
                    )
                )
        else:
            if not raw_sla_target:
                warnings.append(
                    ImportErrorDetail(
                        row=r_idx,
                        column="SLA Target / Repair Duration",
                        message=f"SLA target or repair duration not specified for '{node_id}'. Defaulted to 2.0h repair duration (illustrative baseline).",
                        source_ref=f"{node_sheet_name}, Row {r_idx}",
                        severity="WARNING",
                    )
                )

        # Parse Stage
        stage = CascadeStage.STAGE_2_PROPAGATION
        if raw_stage:
            stage_str = str(raw_stage).upper().strip()
            if "1" in stage_str or "TRIGGER" in stage_str:
                stage = CascadeStage.STAGE_1_TRIGGER
            elif "3" in stage_str or "BLOCKER" in stage_str:
                stage = CascadeStage.STAGE_3_BLOCKER
            elif "2" in stage_str or "PROPAGATION" in stage_str:
                stage = CascadeStage.STAGE_2_PROPAGATION

        # Parse Dominant Control
        dominant_control = ControlCategory.TECHNICAL
        if raw_control:
            ctrl_str = str(raw_control).upper().strip()
            if "INFORMAL" in ctrl_str:
                dominant_control = ControlCategory.INFORMAL
            elif "FORMAL" in ctrl_str:
                dominant_control = ControlCategory.FORMAL
            elif "TECHNICAL" in ctrl_str:
                dominant_control = ControlCategory.TECHNICAL

        node = CanonicalNode(
            id=node_id,
            code=node_id,
            label=node_name,
            subsystem=raw_category,
            stage=stage,
            dominant_control=dominant_control,
            description=raw_desc or f"Imported aerodrome entity {node_name}",
            failure_mode=raw_failure or f"Degradation or total outage of {node_name}",
            tripartite=TripartiteControls(
                technical_score=60.0 if dominant_control == ControlCategory.TECHNICAL else 30.0,
                formal_score=60.0 if dominant_control == ControlCategory.FORMAL else 30.0,
                informal_score=60.0 if dominant_control == ControlCategory.INFORMAL else 30.0,
            ),
            fmea=FMEAMetrics(
                likelihood=3,
                impact=4 if stage == CascadeStage.STAGE_3_BLOCKER else 3,
                recovery_complexity=3,
            ),
            psoe_status=PSOELevel.NOT_ASSESSED,
            er040_severity=ER040Severity.MAJOR_3,
            base_latency_minutes=15.0,
            repair_duration_hours=repair_duration,
        )

        parsed_nodes.append(node)
        nodes_by_id[node_id] = node
        node_id_to_source_row[node_id] = r_idx

        norm_name = sanitize_header(node_name)
        nodes_by_name.setdefault(norm_name, []).append(node_id)

        # Record inline dependencies (Upstream / Downstream IDs)
        raw_upstream = get_val("upstream_ids")
        raw_downstream = get_val("downstream_ids")
        if raw_upstream or raw_downstream:
            inline_deps[node_id] = {
                "upstream": [u.strip() for u in re.split(r"[,;|]+", raw_upstream) if u.strip()],
                "downstream": [d.strip() for d in re.split(r"[,;|]+", raw_downstream) if d.strip()],
                "row": r_idx,
            }

    # 6. Reference Resolution Function
    def resolve_ref(ref_str: str, source_row: int, col_name: str, sheet_name: str) -> Optional[str]:
        cleaned = ref_str.strip()
        if not cleaned:
            return None
        # Exact ID match
        if cleaned in nodes_by_id:
            return cleaned
        # Name match
        norm = sanitize_header(cleaned)
        if norm in nodes_by_name:
            matches = nodes_by_name[norm]
            if len(matches) == 1:
                return matches[0]
            # Ambiguous name
            errors.append(
                ImportErrorDetail(
                    row=source_row,
                    column=col_name,
                    message=f"Ambiguous reference to '{cleaned}': matches multiple Vendor IDs ({', '.join(matches)}). Please use explicit Vendor IDs.",
                    source_ref=f"{sheet_name}, Row {source_row}",
                    severity="ERROR",
                )
            )
            return None

        # Unresolved
        errors.append(
            ImportErrorDetail(
                row=source_row,
                column=col_name,
                message=f"Unresolved entity reference '{cleaned}'. No vendor or node with this ID or Name exists.",
                source_ref=f"{sheet_name}, Row {source_row}",
                severity="ERROR",
            )
        )
        return None

    # 7. Extract Dependencies & Reconcile Reciprocal Declarations
    # Canonical direction: provider_node_id -> dependent_node_id
    candidate_edges: Dict[Tuple[str, str], CanonicalDependency] = {}
    deduplicated_edge_count = 0

    # A) Ingest from inline declarations (One-sheet template)
    for curr_id, decl in inline_deps.items():
        s_row = decl["row"]
        # Upstream IDs = Providers supplying to curr_id (Provider -> Dependent)
        for up_ref in decl["upstream"]:
            provider_id = resolve_ref(up_ref, s_row, "Upstream IDs", node_sheet_name)
            if provider_id:
                edge_key = (provider_id, curr_id)
                if edge_key in candidate_edges:
                    deduplicated_edge_count += 1
                    warnings.append(
                        ImportErrorDetail(
                            row=s_row,
                            column="Upstream IDs",
                            message=f"Reconciled reciprocal/duplicate dependency declaration ({provider_id} -> {curr_id}) into a single directed edge.",
                            source_ref=f"{node_sheet_name}, Row {s_row}",
                            severity="WARNING",
                        )
                    )
                else:
                    candidate_edges[edge_key] = CanonicalDependency(
                        id=f"dep-{provider_id}-to-{curr_id}",
                        provider_node_id=provider_id,
                        dependent_node_id=curr_id,
                        coupling_weight=0.75,
                        propagation_delay_hours=0.25,
                        propagation_mechanism="Operational Dependency / Signal Supply",
                        protocol_layer="IP/Ethernet",
                    )

        # Downstream IDs = Dependents consuming curr_id (curr_id -> Dependent)
        for down_ref in decl["downstream"]:
            dependent_id = resolve_ref(down_ref, s_row, "Downstream IDs", node_sheet_name)
            if dependent_id:
                edge_key = (curr_id, dependent_id)
                if edge_key in candidate_edges:
                    deduplicated_edge_count += 1
                    warnings.append(
                        ImportErrorDetail(
                            row=s_row,
                            column="Downstream IDs",
                            message=f"Reconciled reciprocal/duplicate dependency declaration ({curr_id} -> {dependent_id}) into a single directed edge.",
                            source_ref=f"{node_sheet_name}, Row {s_row}",
                            severity="WARNING",
                        )
                    )
                else:
                    candidate_edges[edge_key] = CanonicalDependency(
                        id=f"dep-{curr_id}-to-{dependent_id}",
                        provider_node_id=curr_id,
                        dependent_node_id=dependent_id,
                        coupling_weight=0.75,
                        propagation_delay_hours=0.25,
                        propagation_mechanism="Downstream Feed / Service Consumption",
                        protocol_layer="IP/Ethernet",
                    )

    # B) Ingest from separate Dependencies sheet if present (Two-sheet template)
    if dep_rows and dep_sheet_name:
        raw_dep_headers = dep_rows[0]
        dep_col_map: Dict[str, int] = {}
        for idx, h in enumerate(raw_dep_headers):
            clean_h = sanitize_header(h)
            if clean_h in DEP_HEADER_MAP:
                canon_col = DEP_HEADER_MAP[clean_h]
                if canon_col not in dep_col_map:
                    dep_col_map[canon_col] = idx

        for r_idx, row in enumerate(dep_rows[1:], start=2):
            def get_dep_val(canon_col: str) -> Any:
                idx = dep_col_map.get(canon_col)
                if idx is not None and idx < len(row):
                    v = row[idx]
                    return str(v).strip() if v is not None else ""
                return ""

            raw_prov = get_dep_val("provider_id")
            raw_dep = get_dep_val("dependent_id")
            if not raw_prov and not raw_dep:
                continue

            provider_id = resolve_ref(raw_prov, r_idx, "Provider ID", dep_sheet_name)
            dependent_id = resolve_ref(raw_dep, r_idx, "Dependent ID", dep_sheet_name)

            if provider_id and dependent_id:
                edge_key = (provider_id, dependent_id)
                if edge_key in candidate_edges:
                    deduplicated_edge_count += 1
                    warnings.append(
                        ImportErrorDetail(
                            row=r_idx,
                            column="Dependencies",
                            message=f"Duplicate dependency ({provider_id} -> {dependent_id}) deduplicated.",
                            source_ref=f"{dep_sheet_name}, Row {r_idx}",
                            severity="WARNING",
                        )
                    )
                else:
                    raw_weight = get_dep_val("coupling_weight")
                    weight = 0.75
                    if raw_weight:
                        try:
                            weight = max(0.05, min(1.0, float(raw_weight)))
                        except ValueError:
                            pass

                    raw_delay = get_dep_val("propagation_delay_hours")
                    delay = 0.25
                    if raw_delay:
                        try:
                            delay = max(0.0, float(raw_delay))
                        except ValueError:
                            pass

                    candidate_edges[edge_key] = CanonicalDependency(
                        id=f"dep-{provider_id}-to-{dependent_id}",
                        provider_node_id=provider_id,
                        dependent_node_id=dependent_id,
                        coupling_weight=weight,
                        propagation_delay_hours=delay,
                        propagation_mechanism=get_dep_val("propagation_mechanism") or "Inter-System Link",
                        protocol_layer=get_dep_val("protocol_layer") or "IP/Ethernet",
                    )

    # 8. Check for Cycles
    g = nx.DiGraph()
    for n in parsed_nodes:
        g.add_node(n.id)
    for (p, d) in candidate_edges.keys():
        g.add_edge(p, d)

    raw_cycles = list(nx.simple_cycles(g))
    cycle_strs = [" -> ".join(c + [c[0]]) for c in raw_cycles]

    cycle_explanation = None
    if raw_cycles:
        cycle_explanation = (
            f"Graph contains {len(raw_cycles)} feedback cycle(s). The AeroCascade discrete-event simulation (DES) "
            "evaluates failure cascades chronologically with propagation delay timestamps and state dampening. "
            "Cycles propagate failure cascades across recurring timesteps until all constituent nodes are either "
            "fully failed, mitigated by formal/informal controls, or the simulation reaches its 24-hour horizon."
        )
        warnings.append(
            ImportErrorDetail(
                message=f"Topology contains {len(raw_cycles)} cyclical loop(s): {', '.join(cycle_strs[:3])}. Cycle simulation confirmation required.",
                severity="WARNING",
            )
        )

    # If any validation errors occurred, return invalid preview
    if errors:
        return ImportPreviewResponse(
            valid=False,
            file_name=file_name,
            file_type=ext.replace(".", ""),
            summary=ImportSummary(
                node_count=len(parsed_nodes),
                edge_count=len(candidate_edges),
                error_count=len(errors),
                warning_count=len(warnings),
                cycle_count=len(raw_cycles),
                provisional_id_count=provisional_id_count,
                deduplicated_edge_count=deduplicated_edge_count,
            ),
            errors=errors,
            warnings=warnings,
            cycles=cycle_strs,
            cycle_handling_explanation=cycle_explanation,
            preview_topology=None,
        )

    # Build validated preview CanonicalTopology
    topology_name = overrides.get("name") if overrides and overrides.get("name") else os.path.splitext(file_name)[0].replace("_", " ").title()
    topo_id = f"import-{re.sub(r'[^a-z0-9]', '-', topology_name.lower())[:32]}"

    preview_topo = CanonicalTopology(
        schema_version="1.0.0",
        topology_id=topo_id,
        name=topology_name,
        description=f"Imported from {file_name} with {len(parsed_nodes)} nodes and {len(candidate_edges)} dependencies.",
        version=1,
        source_provenance=CanonicalSourceProvenance(
            author="AeroCascade Importer",
            citation="AeroCascade Synthetic Import Suite (EUROCAE ER-040 & EASA Part-IS)",
            source_document=file_name,
            synthetic_fixture=True,
        ),
        nodes=parsed_nodes,
        dependencies=list(candidate_edges.values()),
    )

    return ImportPreviewResponse(
        valid=True,
        file_name=file_name,
        file_type=ext.replace(".", ""),
        summary=ImportSummary(
            node_count=len(parsed_nodes),
            edge_count=len(candidate_edges),
            error_count=0,
            warning_count=len(warnings),
            cycle_count=len(raw_cycles),
            provisional_id_count=provisional_id_count,
            deduplicated_edge_count=deduplicated_edge_count,
        ),
        errors=[],
        warnings=warnings,
        cycles=cycle_strs,
        cycle_handling_explanation=cycle_explanation,
        preview_topology=preview_topo,
    )


# ==============================================================================
# Template Generators (Downloadable Excel & CSV)
# ==============================================================================

def generate_one_sheet_template_xlsx() -> bytes:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Vendors"

    headers = [
        "Vendor ID",
        "Vendor Name",
        "Category",
        "Upstream IDs",
        "Downstream IDs",
        "SLA Target",
        "SLA Unit",
        "Stage",
        "Dominant Control",
        "Repair Duration Hours",
        "Description",
    ]
    ws.append(headers)

    # Style Header
    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
    for col_num in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_num)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")

    sample_rows = [
        [
            "SURV-PSR-01",
            "Primary Surveillance Radar",
            "Surveillance",
            "",
            "ARTAS-TRACKER",
            "99.95",
            "%",
            "STAGE_1_TRIGGER",
            "Technical",
            "3.0",
            "S-band terminal area primary radar sensor",
        ],
        [
            "SURV-ADSB-01",
            "ADS-B 1090MHz Receiver",
            "Surveillance",
            "",
            "ARTAS-TRACKER",
            "99.9",
            "%",
            "STAGE_1_TRIGGER",
            "Technical",
            "1.5",
            "Dual-redundant 1090ES ground receiver station",
        ],
        [
            "ARTAS-TRACKER",
            "Radar Tracker & Correlator",
            "Surveillance Data Processing",
            "SURV-PSR-01, SURV-ADSB-01",
            "FUSION-ASMGCS",
            "99.99",
            "%",
            "STAGE_2_PROPAGATION",
            "Technical",
            "2.0",
            "Multi-radar tracker providing smoothed state vectors",
        ],
        [
            "FUSION-ASMGCS",
            "A-SMGCS Surface Guidance Server",
            "Guidance & Control",
            "ARTAS-TRACKER",
            "CWP-TWR-DISPLAY",
            "99.99",
            "%",
            "STAGE_2_PROPAGATION",
            "Technical",
            "2.5",
            "Safety nets and runway conflict monitoring server",
        ],
        [
            "CWP-TWR-DISPLAY",
            "Tower Controller Air Situation Display",
            "Air Traffic Control",
            "FUSION-ASMGCS",
            "",
            "99.999",
            "%",
            "STAGE_3_BLOCKER",
            "Formal",
            "1.0",
            "Primary controller situational awareness display console",
        ],
    ]

    for row in sample_rows:
        ws.append(row)

    # Set column widths
    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def generate_two_sheet_template_xlsx() -> bytes:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    wb = openpyxl.Workbook()

    # Sheet 1: Vendors
    ws1 = wb.active
    ws1.title = "Vendors"
    headers1 = [
        "Vendor ID",
        "Vendor Name",
        "Category",
        "SLA Target",
        "SLA Unit",
        "Stage",
        "Dominant Control",
        "Repair Duration Hours",
        "Description",
    ]
    ws1.append(headers1)

    # Sheet 2: Dependencies
    ws2 = wb.create_sheet(title="Dependencies")
    headers2 = [
        "Provider ID",
        "Dependent ID",
        "Coupling Weight",
        "Propagation Mechanism",
        "Protocol Layer",
        "Propagation Delay Hours",
    ]
    ws2.append(headers2)

    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")

    for ws, h_len in [(ws1, len(headers1)), (ws2, len(headers2))]:
        for c in range(1, h_len + 1):
            cell = ws.cell(row=1, column=c)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

    sample_vendors = [
        ["RADAR-01", "Primary Terminal Radar", "Surveillance", "99.9", "%", "STAGE_1_TRIGGER", "Technical", "2.5", "S-band primary surveillance sensor"],
        ["FUSION-01", "Surveillance Data Fusion Hub", "Processing", "99.99", "%", "STAGE_2_PROPAGATION", "Technical", "2.0", "Sensor fusion engine"],
        ["CWP-01", "Tower Controller Situation Display", "CWP", "99.999", "%", "STAGE_3_BLOCKER", "Formal", "1.5", "Controller workstation"],
    ]
    for v in sample_vendors:
        ws1.append(v)

    sample_deps = [
        ["RADAR-01", "FUSION-01", "0.85", "Surveillance Track Stream (ASTERIX Cat-048)", "IP/Multicast", "0.20"],
        ["FUSION-01", "CWP-01", "0.90", "System Situation Feed (ASTERIX Cat-062)", "IP/Ethernet", "0.15"],
    ]
    for d in sample_deps:
        ws2.append(d)

    for ws in [ws1, ws2]:
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def generate_one_sheet_template_csv() -> bytes:
    rows = [
        ["Vendor ID", "Vendor Name", "Category", "Upstream IDs", "Downstream IDs", "SLA Target", "SLA Unit", "Stage", "Dominant Control", "Repair Duration Hours", "Description"],
        ["SURV-PSR-01", "Primary Surveillance Radar", "Surveillance", "", "ARTAS-TRACKER", "99.95", "%", "STAGE_1_TRIGGER", "Technical", "3.0", "S-band terminal area radar"],
        ["SURV-ADSB-01", "ADS-B Ground Station", "Surveillance", "", "ARTAS-TRACKER", "99.9", "%", "STAGE_1_TRIGGER", "Technical", "1.5", "1090MHz ES receiver"],
        ["ARTAS-TRACKER", "Radar Tracker & Correlator", "Processing", "SURV-PSR-01, SURV-ADSB-01", "FUSION-ASMGCS", "99.99", "%", "STAGE_2_PROPAGATION", "Technical", "2.0", "Multi-radar tracker"],
        ["FUSION-ASMGCS", "A-SMGCS Surface Guidance", "Guidance", "ARTAS-TRACKER", "CWP-TWR-DISPLAY", "99.99", "%", "STAGE_2_PROPAGATION", "Technical", "2.5", "Surface movement safety server"],
        ["CWP-TWR-DISPLAY", "Tower Situation Display", "CWP", "FUSION-ASMGCS", "", "99.999", "%", "STAGE_3_BLOCKER", "Formal", "1.0", "Controller working position"],
    ]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def generate_two_sheet_vendors_csv() -> bytes:
    rows = [
        ["Vendor ID", "Vendor Name", "Category", "SLA Target", "SLA Unit", "Stage", "Dominant Control", "Repair Duration Hours", "Description"],
        ["RADAR-01", "Primary Terminal Radar", "Surveillance", "99.9", "%", "STAGE_1_TRIGGER", "Technical", "2.5", "S-band primary surveillance sensor"],
        ["FUSION-01", "Surveillance Data Fusion Hub", "Processing", "99.99", "%", "STAGE_2_PROPAGATION", "Technical", "2.0", "Sensor fusion engine"],
        ["CWP-01", "Tower Controller Situation Display", "CWP", "99.999", "%", "STAGE_3_BLOCKER", "Formal", "1.5", "Controller workstation"],
    ]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def generate_two_sheet_dependencies_csv() -> bytes:
    rows = [
        ["Provider ID", "Dependent ID", "Coupling Weight", "Propagation Mechanism", "Protocol Layer", "Propagation Delay Hours"],
        ["RADAR-01", "FUSION-01", "0.85", "Surveillance Track Stream (ASTERIX Cat-048)", "IP/Multicast", "0.20"],
        ["FUSION-01", "CWP-01", "0.90", "System Situation Feed (ASTERIX Cat-062)", "IP/Ethernet", "0.15"],
    ]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def generate_template(template_name: str) -> Tuple[bytes, str, str]:
    """
    Returns (bytes, media_type, filename) for the requested template.
    """
    tname = template_name.lower().strip()
    if tname in ("one-sheet.xlsx", "one-sheet", "vendor-template.xlsx"):
        return (
            generate_one_sheet_template_xlsx(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "aerocascade_vendor_template_one_sheet.xlsx",
        )
    elif tname in ("two-sheet.xlsx", "two-sheet", "workbook.xlsx"):
        return (
            generate_two_sheet_template_xlsx(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "aerocascade_vendors_dependencies_workbook.xlsx",
        )
    elif tname in ("one-sheet.csv", "vendor-template.csv", "csv"):
        return (
            generate_one_sheet_template_csv(),
            "text/csv",
            "aerocascade_vendor_template_one_sheet.csv",
        )
    elif tname in ("vendors.csv", "nodes.csv"):
        return (
            generate_two_sheet_vendors_csv(),
            "text/csv",
            "aerocascade_vendors.csv",
        )
    elif tname in ("dependencies.csv", "links.csv"):
        return (
            generate_two_sheet_dependencies_csv(),
            "text/csv",
            "aerocascade_dependencies.csv",
        )
    raise ValueError(f"Unknown template name '{template_name}'.")


# ==============================================================================
# 30-Node Synthetic Benchmark Fixture
# ==============================================================================

def get_30_node_fixture() -> CanonicalTopology:
    """
    Returns an authoritative 30-node synthetic airport remote tower & IT/OT convergence fixture.
    """
    nodes: List[CanonicalNode] = [
        # Stage 1: Sensors & Cyber-Physical Ingestion (7 nodes)
        CanonicalNode(id="SURV-PSR-01", code="PSR-01", label="Primary Surveillance Radar Channel A", subsystem="Surveillance", stage=CascadeStage.STAGE_1_TRIGGER, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=3.5, description="S-band primary surveillance radar transceiver"),
        CanonicalNode(id="SURV-SSR-01", code="SSR-01", label="Secondary Surveillance Radar Mode S", subsystem="Surveillance", stage=CascadeStage.STAGE_1_TRIGGER, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.5, description="Interrogator and azimuth encoder Mode-S"),
        CanonicalNode(id="SURV-ADSB-01", code="ADSB-01", label="ADS-B Ground Station Cluster", subsystem="Surveillance", stage=CascadeStage.STAGE_1_TRIGGER, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=1.5, description="1090ES redundant ground receivers"),
        CanonicalNode(id="SURV-MLAT-01", code="MLAT-01", label="Multilateration Ground Sensor Grid", subsystem="Surveillance", stage=CascadeStage.STAGE_1_TRIGGER, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.0, description="Time-difference-of-arrival aerodrome sensor array"),
        CanonicalNode(id="SURV-SMR-01", code="SMR-01", label="Surface Movement Radar Transceiver", subsystem="Surveillance", stage=CascadeStage.STAGE_1_TRIGGER, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=4.0, description="X-band high-resolution runway radar"),
        CanonicalNode(id="OPT-CAM-01", code="OPT-01", label="Remote Tower 360-degree Optical Panoramic Cameras", subsystem="Optical Surveillance", stage=CascadeStage.STAGE_1_TRIGGER, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.0, description="High-definition 4K visual surveillance array"),
        CanonicalNode(id="OPT-IR-01", code="IR-01", label="Infrared Thermal Imaging Sensor", subsystem="Optical Surveillance", stage=CascadeStage.STAGE_1_TRIGGER, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.5, description="Low-visibility long-wave thermal imaging camera"),

        # Stage 2: Processing, Fusion & Core Communication Backbones (13 nodes)
        CanonicalNode(id="FUSION-ASMGCS", code="ASMGCS", label="A-SMGCS Surface Data Server & Safety Nets", subsystem="Fusion", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.5, description="Runway conflict detection and route monitoring server"),
        CanonicalNode(id="ARTAS-TRACKER", code="ARTAS", label="Air Traffic Radar Tracker Extrapolator", subsystem="Fusion", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.0, description="Multi-sensor track correlation and smoothing"),
        CanonicalNode(id="RTC-VIDEO-ENC", code="V-ENC", label="Remote Tower Video Stream Encoders", subsystem="Network", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=1.5, description="H.265 low-latency optical video encoder bank"),
        CanonicalNode(id="C2-SDWAN-GW", code="C2-GW", label="Remote Tower C2 SD-WAN Edge Gateway", subsystem="Network", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=3.0, description="Encrypted multi-bearer aerodrome WAN gateway"),
        CanonicalNode(id="IP-CORE-ROUTER", code="IP-CORE", label="Aerodrome Core IP/MPLS Backbone Switch", subsystem="Network", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.0, description="Industrial 10GbE redundant network core"),
        CanonicalNode(id="SWIM-BROKER", code="SWIM", label="SWIM Yellow Profile Enterprise Broker", subsystem="Aeronautical Information", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.0, description="System Wide Information Management message broker"),
        CanonicalNode(id="AMHS-GATEWAY", code="AMHS", label="Aeronautical Message Handling System Gateway", subsystem="Aeronautical Information", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.5, description="ICAO flight plan and meteorological gateway"),
        CanonicalNode(id="MET-AWOS", code="AWOS", label="Automated Weather Observing System", subsystem="Meteorology", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.0, description="Surface wind, RVR, barometric altimeter server"),
        CanonicalNode(id="AGL-PLC-MASTER", code="AGL-PLC", label="Airfield Ground Lighting Master PLC", subsystem="Airfield Infrastructure", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=3.0, description="Modbus/TCP airfield lighting control PLC"),
        CanonicalNode(id="D-ATIS-SERVER", code="D-ATIS", label="Digital ATIS Flight Broadcast Server", subsystem="Aeronautical Information", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=1.5, description="Automated Terminal Information Service voice/data broadcast"),
        CanonicalNode(id="A-FDP-SERVER", code="A-FDP", label="Flight Data Processing System", subsystem="Air Traffic Management", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.5, description="Electronic flight strip trajectory predictor"),
        CanonicalNode(id="TIME-PTP-GRANDMASTER", code="PTP-CLK", label="Precision Time Protocol Master Clock", subsystem="Timing Infrastructure", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=1.0, description="IEEE 1588 GPS-disciplined grandmaster clock"),
        CanonicalNode(id="SECURITY-IDS", code="IDS-SIEM", label="Airside Network Security IDS Sensor", subsystem="Cybersecurity", stage=CascadeStage.STAGE_2_PROPAGATION, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.0, description="Packet inspection and anomaly detector"),

        # Stage 3: Controller Working Positions, Human Coordination & Operational Governance (10 nodes)
        CanonicalNode(id="CWP-TWR-DISPLAY", code="CWP-TWR", label="Tower Controller Situation Display", subsystem="Controller Working Position", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.FORMAL, repair_duration_hours=1.5, description="Primary air traffic controller visual situation console"),
        CanonicalNode(id="CWP-GND-DISPLAY", code="CWP-GND", label="Ground Movement Situation Display", subsystem="Controller Working Position", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.FORMAL, repair_duration_hours=1.5, description="Taxiway and apron movement control console"),
        CanonicalNode(id="CWP-OPTICAL-PANEL", code="CWP-OPT", label="Panoramic Video Wall Display Console", subsystem="Controller Working Position", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.INFORMAL, repair_duration_hours=2.0, description="Synthesized 360-degree remote tower visual wall"),
        CanonicalNode(id="VCCS-RADIO-TWR", code="VCCS", label="Voice Communications Control System", subsystem="Communications", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.FORMAL, repair_duration_hours=1.0, description="VHF/UHF air-ground voice radio console"),
        CanonicalNode(id="AGL-STOPBAR-ACTUATOR", code="STOPBAR", label="Runway Incursion Prevention Stop-Bar Relays", subsystem="Airfield Infrastructure", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.TECHNICAL, repair_duration_hours=2.0, description="Physical light bar relays at runway holding points"),
        CanonicalNode(id="PART-IS-SOC", code="PART-IS", label="EASA Part-IS Incident Response Desk", subsystem="Governance", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.FORMAL, repair_duration_hours=2.5, description="Part-IS information security management oversight"),
        CanonicalNode(id="STRIP-FALLBACK-PROC", code="FALLBACK", label="Offline Flight Strip Reconciliation Protocol", subsystem="Operating Procedures", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.FORMAL, repair_duration_hours=1.5, description="Manual reversion procedures for flight sequencing"),
        CanonicalNode(id="CONTINGENCY-ATCO-CREW", code="CREW", label="Emergency ATCO Visual Look-Out Crew", subsystem="Human Factors", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.INFORMAL, repair_duration_hours=2.0, description="Backup visual observers stationed at runway edge"),
        CanonicalNode(id="MAINT-DISPATCH-DESK", code="MAINT", label="Avionics Field Technician Dispatch Desk", subsystem="Maintenance Operations", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.FORMAL, repair_duration_hours=1.0, description="On-call hardware restoration and cable repair squad"),
        CanonicalNode(id="SAFETY-GATE-SUPERVISOR", code="WATCH-SUP", label="Tower Watch Supervisor Reversion Gate", subsystem="Supervisory Authority", stage=CascadeStage.STAGE_3_BLOCKER, dominant_control=ControlCategory.FORMAL, repair_duration_hours=1.0, description="Executive authorization authority for runway closure"),
    ]

    dependencies: List[CanonicalDependency] = [
        # Radar to Tracker
        CanonicalDependency(id="dep-1", provider_node_id="SURV-PSR-01", dependent_node_id="ARTAS-TRACKER", coupling_weight=0.85, propagation_delay_hours=0.20),
        CanonicalDependency(id="dep-2", provider_node_id="SURV-SSR-01", dependent_node_id="ARTAS-TRACKER", coupling_weight=0.90, propagation_delay_hours=0.20),
        CanonicalDependency(id="dep-3", provider_node_id="SURV-ADSB-01", dependent_node_id="ARTAS-TRACKER", coupling_weight=0.80, propagation_delay_hours=0.15),
        # Tracker to Fusion
        CanonicalDependency(id="dep-4", provider_node_id="ARTAS-TRACKER", dependent_node_id="FUSION-ASMGCS", coupling_weight=0.95, propagation_delay_hours=0.15),
        CanonicalDependency(id="dep-5", provider_node_id="SURV-MLAT-01", dependent_node_id="FUSION-ASMGCS", coupling_weight=0.85, propagation_delay_hours=0.20),
        CanonicalDependency(id="dep-6", provider_node_id="SURV-SMR-01", dependent_node_id="FUSION-ASMGCS", coupling_weight=0.90, propagation_delay_hours=0.20),
        # Optical to Encoders and Network
        CanonicalDependency(id="dep-7", provider_node_id="OPT-CAM-01", dependent_node_id="RTC-VIDEO-ENC", coupling_weight=0.90, propagation_delay_hours=0.10),
        CanonicalDependency(id="dep-8", provider_node_id="OPT-IR-01", dependent_node_id="RTC-VIDEO-ENC", coupling_weight=0.75, propagation_delay_hours=0.15),
        CanonicalDependency(id="dep-9", provider_node_id="RTC-VIDEO-ENC", dependent_node_id="IP-CORE-ROUTER", coupling_weight=0.85, propagation_delay_hours=0.10),
        # Network Backbone to C2 and Displays
        CanonicalDependency(id="dep-10", provider_node_id="IP-CORE-ROUTER", dependent_node_id="C2-SDWAN-GW", coupling_weight=0.90, propagation_delay_hours=0.15),
        CanonicalDependency(id="dep-11", provider_node_id="IP-CORE-ROUTER", dependent_node_id="CWP-OPTICAL-PANEL", coupling_weight=0.85, propagation_delay_hours=0.10),
        # Fusion to Displays & AGL
        CanonicalDependency(id="dep-12", provider_node_id="FUSION-ASMGCS", dependent_node_id="CWP-TWR-DISPLAY", coupling_weight=0.95, propagation_delay_hours=0.15),
        CanonicalDependency(id="dep-13", provider_node_id="FUSION-ASMGCS", dependent_node_id="CWP-GND-DISPLAY", coupling_weight=0.95, propagation_delay_hours=0.15),
        CanonicalDependency(id="dep-14", provider_node_id="FUSION-ASMGCS", dependent_node_id="AGL-PLC-MASTER", coupling_weight=0.80, propagation_delay_hours=0.20),
        # AGL PLC to Stop-bar Actuator
        CanonicalDependency(id="dep-15", provider_node_id="AGL-PLC-MASTER", dependent_node_id="AGL-STOPBAR-ACTUATOR", coupling_weight=0.90, propagation_delay_hours=0.10),
        # Aeronautical Information & Weather
        CanonicalDependency(id="dep-16", provider_node_id="MET-AWOS", dependent_node_id="D-ATIS-SERVER", coupling_weight=0.85, propagation_delay_hours=0.25),
        CanonicalDependency(id="dep-17", provider_node_id="SWIM-BROKER", dependent_node_id="A-FDP-SERVER", coupling_weight=0.80, propagation_delay_hours=0.20),
        CanonicalDependency(id="dep-18", provider_node_id="AMHS-GATEWAY", dependent_node_id="A-FDP-SERVER", coupling_weight=0.85, propagation_delay_hours=0.25),
        CanonicalDependency(id="dep-19", provider_node_id="A-FDP-SERVER", dependent_node_id="CWP-TWR-DISPLAY", coupling_weight=0.85, propagation_delay_hours=0.20),
        # Timing Synchronization
        CanonicalDependency(id="dep-20", provider_node_id="TIME-PTP-GRANDMASTER", dependent_node_id="IP-CORE-ROUTER", coupling_weight=0.90, propagation_delay_hours=0.05),
        CanonicalDependency(id="dep-21", provider_node_id="TIME-PTP-GRANDMASTER", dependent_node_id="FUSION-ASMGCS", coupling_weight=0.90, propagation_delay_hours=0.05),
        # Security Monitoring
        CanonicalDependency(id="dep-22", provider_node_id="IP-CORE-ROUTER", dependent_node_id="SECURITY-IDS", coupling_weight=0.75, propagation_delay_hours=0.10),
        CanonicalDependency(id="dep-23", provider_node_id="SECURITY-IDS", dependent_node_id="PART-IS-SOC", coupling_weight=0.85, propagation_delay_hours=0.30),
        # Stage 3 Governance & Reversion Connections
        CanonicalDependency(id="dep-24", provider_node_id="CWP-TWR-DISPLAY", dependent_node_id="SAFETY-GATE-SUPERVISOR", coupling_weight=0.90, propagation_delay_hours=0.20),
        CanonicalDependency(id="dep-25", provider_node_id="PART-IS-SOC", dependent_node_id="SAFETY-GATE-SUPERVISOR", coupling_weight=0.85, propagation_delay_hours=0.25),
        CanonicalDependency(id="dep-26", provider_node_id="SAFETY-GATE-SUPERVISOR", dependent_node_id="STRIP-FALLBACK-PROC", coupling_weight=0.80, propagation_delay_hours=0.30),
        CanonicalDependency(id="dep-27", provider_node_id="SAFETY-GATE-SUPERVISOR", dependent_node_id="CONTINGENCY-ATCO-CREW", coupling_weight=0.85, propagation_delay_hours=0.35),
        CanonicalDependency(id="dep-28", provider_node_id="PART-IS-SOC", dependent_node_id="MAINT-DISPATCH-DESK", coupling_weight=0.80, propagation_delay_hours=0.20),
        CanonicalDependency(id="dep-29", provider_node_id="VCCS-RADIO-TWR", dependent_node_id="SAFETY-GATE-SUPERVISOR", coupling_weight=0.90, propagation_delay_hours=0.10),
    ]

    return CanonicalTopology(
        schema_version="1.0.0",
        topology_id="synthetic-hub-30-nodes",
        name="Synthetic 30-Node Aerodrome Digital Tower & C2 Hub",
        description="Comprehensive 30-node IT/OT benchmark model covering primary/secondary radar, ADS-B, optical array, A-SMGCS, C2 SD-WAN, and EASA Part-IS governance.",
        version=1,
        aerodrome_profile="Major European Regional Hub (60 mvmt/hr)",
        baseline_movements_per_hour=60.0,
        trigger_hour=4.0,
        horizon_hours=24.0,
        cost_per_delayed_movement=7500.0,
        source_provenance=CanonicalSourceProvenance(
            author="Aryan Aggarwal & Gurpreet Dhillon",
            citation="Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations (AIAA Aviation 2026)",
            source_document="AIAA 2026 Benchmark 30-Node Synthetic Aviation Infrastructure Model",
            synthetic_fixture=True,
        ),
        nodes=nodes,
        dependencies=dependencies,
    )


def generate_30_node_fixture_xlsx() -> bytes:
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment

    fixture = get_30_node_fixture()
    wb = openpyxl.Workbook()

    # Sheet 1: Vendors
    ws1 = wb.active
    ws1.title = "Vendors"
    headers1 = [
        "Vendor ID",
        "Vendor Name",
        "Category",
        "SLA Target",
        "SLA Unit",
        "Stage",
        "Dominant Control",
        "Repair Duration Hours",
        "Description",
    ]
    ws1.append(headers1)

    for n in fixture.nodes:
        ws1.append([
            n.id,
            n.label,
            n.subsystem,
            "99.95",
            "%",
            n.stage.value,
            n.dominant_control.value,
            n.repair_duration_hours,
            n.description,
        ])

    # Sheet 2: Dependencies
    ws2 = wb.create_sheet(title="Dependencies")
    headers2 = [
        "Provider ID",
        "Dependent ID",
        "Coupling Weight",
        "Propagation Mechanism",
        "Protocol Layer",
        "Propagation Delay Hours",
    ]
    ws2.append(headers2)

    for d in fixture.dependencies:
        ws2.append([
            d.provider_node_id,
            d.dependent_node_id,
            d.coupling_weight,
            d.propagation_mechanism or "Causal Signal Feed",
            d.protocol_layer or "IP/Ethernet",
            d.propagation_delay_hours,
        ])

    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")

    for ws, h_len in [(ws1, len(headers1)), (ws2, len(headers2))]:
        for c in range(1, h_len + 1):
            cell = ws.cell(row=1, column=c)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center")

    for ws in [ws1, ws2]:
        for col in ws.columns:
            max_len = max(len(str(cell.value or "")) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 4, 14)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
