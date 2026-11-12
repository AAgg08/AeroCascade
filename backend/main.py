"""
AeroCascade — FastAPI Backend Entry Point
Exposes authoritative REST API endpoints for:
- SimPy causal discrete-event simulation
- NetworkX topology analysis
- Versioned canonical topology repository (SQLite)
- Immutable topology versioning & optimistic locking
- Topology cloning with origin tracking
- Historical completed run records linked to topology versions
"""

from __future__ import annotations
import hashlib
import json
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Query, status, Request, Response, UploadFile, File, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
import networkx as nx

from .canonical import (
    CanonicalTopology,
    canonical_to_simulation_request,
)
from .graph_engine import build_dependency_graph
from .models import SimulationRequest, SimulationResponse
from .security import (
    Action,
    Account,
    get_authenticated_account,
    get_authenticated_role,
    load_enterprise_accounts,
    Role,
    is_enterprise_mode,
    require_role,
)
from .importer import (
    ImportPreviewResponse,
    SaveImportRequest,
    generate_30_node_fixture_xlsx,
    generate_template,
    get_30_node_fixture,
    parse_file_to_preview,
)
from .repository import (
    StaleVersionConflictError,
    TopologyNotFoundError,
    TopologyRepository,
)
from .simpy_engine import run_cascade_simulation

@asynccontextmanager
async def lifespan(app: FastAPI):
    if is_enterprise_mode():
        app.state.enterprise_accounts = load_enterprise_accounts()
    try:
        yield
    finally:
        app.state.enterprise_accounts = {}


app = FastAPI(
    lifespan=lifespan,
    title="AeroCascade Aviation Cybersecurity Causal Simulation Engine & Topology Repository",
    description=(
        "Authoritative FastAPI + NetworkX + SimPy causal simulator and SQLite versioned topology repository for "
        "'Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations' "
        "(Aggarwal & Dhillon, AIAA Aviation 2026)."
    ),
    version="2.1.0",
)

if not is_enterprise_mode():
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def require_matching_deployment(request: Request, call_next):
    if request.headers.get("X-AeroCascade-Deployment") == "enterprise" and not is_enterprise_mode():
        return JSONResponse(status_code=503, content={"detail": "Enterprise backend is unavailable."})
    return await call_next(request)


repo = TopologyRepository()


class CreateTopologyPayload(BaseModel):
    name: str
    description: str = ""
    canonical: CanonicalTopology


class SaveVersionPayload(BaseModel):
    expected_version: int
    change_summary: str = ""
    canonical: CanonicalTopology


class CloneTopologyPayload(BaseModel):
    new_name: str
    source_version: Optional[int] = None
    description: str = ""


@app.get("/api/health")
def health_check() -> dict:
    return {
        "status": "ok",
        "engine": "AeroCascade FastAPI + SimPy + NetworkX (Authoritative Causal Engine)",
        "model_version": "2.0.0-causal",
        "schema_version": "2.0.0",
        "database": "sqlite",
        "frameworks": [
            "Dhillon & Moores (2001) Tripartite Controls",
            "EASA Part-IS (EU) 2022/1645 & (EU) 2023/203",
            "EUROCAE ER-040",
            "PSOE Maturity Model",
        ],
    }


@app.get("/api/auth/session")
def get_enterprise_session(
    request: Request,
    role: Role = Depends(get_authenticated_role),
) -> dict:
    if is_enterprise_mode():
        account = get_authenticated_account(request)
        return {"username": account.username, "role": account.role.value, "enterprise": True}
    return {"username": "synthetic-operator", "role": role.value, "enterprise": False}


@app.post("/api/simulate", response_model=SimulationResponse)
def simulate_cascade(
    payload: SimulationRequest,
    _role: Role = Depends(require_role(Action.RUN)),
) -> SimulationResponse:
    enterprise = is_enterprise_mode()
    target_version = payload.topology_version
    if enterprise:
        if target_version is None:
            raise HTTPException(status_code=422, detail="A saved topology version is required in enterprise mode.")
        try:
            repo.get_version(payload.scenario_id, target_version)
        except TopologyNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        result = run_cascade_simulation(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if enterprise:
        assert target_version is not None
        repo.record_run(payload.scenario_id, target_version, payload, result)
        return result

    # Development simulations can run without a saved topology.
    try:
        topology = repo.get_topology(payload.scenario_id)
        version = target_version or min(payload.input_revision, topology["current_version"])
        repo.record_run(payload.scenario_id, version, payload, result)
    except TopologyNotFoundError:
        pass
    return result


@app.post("/api/topology/centrality")
def analyze_topology(payload: SimulationRequest, _role: Role = Depends(require_role(Action.RUN))) -> dict:
    try:
        if not payload.nodes:
            raise HTTPException(status_code=400, detail="Node list cannot be empty for topology analysis.")
        _, analytics = build_dependency_graph(payload.nodes, payload.edges)
        return {
            "scenario_id": payload.scenario_id,
            "node_analytics": analytics,
            "engine": "fastapi-python",
            "model_version": "2.0.0-causal",
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Topology analysis error: {str(e)}")


# ==============================================================================
# Topology Repository REST Endpoints
# ==============================================================================

@app.get("/api/topologies", dependencies=[Depends(get_authenticated_role)])
def list_topologies() -> dict:
    topos = repo.list_topologies()
    return {"topologies": topos}


@app.post("/api/topologies", status_code=status.HTTP_201_CREATED)
def create_topology(
    body: CreateTopologyPayload,
    _role: Role = Depends(require_role(Action.IMPORT)),
) -> dict:
    try:
        return repo.create_topology(
            name=body.name,
            canonical=body.canonical,
            description=body.description,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create topology: {e}")


@app.get("/api/topologies/{topology_id}", dependencies=[Depends(get_authenticated_role)])
def get_topology(topology_id: str) -> dict:
    try:
        return repo.get_topology(topology_id)
    except TopologyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/topologies/{topology_id}/versions/{version_num}", dependencies=[Depends(get_authenticated_role)])
def get_topology_version(topology_id: str, version_num: int) -> dict:
    try:
        return repo.get_version(topology_id, version_num)
    except TopologyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/topologies/{topology_id}/versions")
def save_new_version(
    topology_id: str,
    body: SaveVersionPayload,
    _role: Role = Depends(require_role(Action.SAVE_VERSION)),
) -> dict:
    try:
        return repo.save_new_version(
            topology_id=topology_id,
            canonical=body.canonical,
            expected_version=body.expected_version,
            change_summary=body.change_summary,
        )
    except TopologyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except StaleVersionConflictError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to save version: {e}")


@app.post("/api/topologies/{topology_id}/clone", status_code=status.HTTP_201_CREATED)
def clone_topology(
    topology_id: str,
    body: CloneTopologyPayload,
    _role: Role = Depends(require_role(Action.CLONE)),
) -> dict:
    try:
        return repo.clone_topology(
            source_topology_id=topology_id,
            new_name=body.new_name,
            source_version=body.source_version,
            description=body.description,
        )
    except TopologyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to clone topology: {e}")


@app.get("/api/runs", dependencies=[Depends(get_authenticated_role)])
def list_runs(
    topology_id: Optional[str] = Query(None),
    topology_version: Optional[int] = Query(None),
) -> dict:
    runs = repo.list_runs(topology_id=topology_id, topology_version=topology_version)
    return {"runs": runs}


@app.get("/api/runs/{run_id}", dependencies=[Depends(get_authenticated_role)])
def get_run(run_id: str) -> dict:
    try:
        run = repo.get_run(run_id)
        run_sha256 = dossier_run_hash(run)
        all_approvals = repo.get_all_run_approvals(run_id)
        enterprise_mode = is_enterprise_mode()

        if enterprise_mode:
            # In enterprise mode, only an authenticated enterprise approval is authoritative
            approval = all_approvals.get("enterprise")
        else:
            # In dev mode, return exercise approval if available, else legacy, else enterprise
            approval = all_approvals.get("exercise") or all_approvals.get("legacy") or all_approvals.get("enterprise")

        return {
            **run,
            "approval": approval,
            "all_approvals": all_approvals,
            "run_sha256": run_sha256,
            "approval_status": (
                "enterprise_approved"
                if all_approvals.get("enterprise")
                else ("exercise_approved" if all_approvals.get("exercise") else ("legacy_approved" if all_approvals.get("legacy") else "unapproved"))
            ),
        }
    except TopologyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ==============================================================================
# Topology Importer REST Endpoints
# ==============================================================================

@app.post("/api/import/preview", response_model=ImportPreviewResponse)
async def preview_topology_import(
    request: Request,
    file: Optional[UploadFile] = File(None),
    _role: Role = Depends(require_role(Action.IMPORT)),
) -> ImportPreviewResponse:
    content_type = request.headers.get("content-type", "")
    file_bytes: bytes = b""
    file_name: str = "upload.xlsx"
    overrides: Dict[str, Any] = {}

    if "multipart/form-data" in content_type and file is not None:
        file_name = file.filename or "upload.xlsx"
        try:
            file_bytes = await file.read()
        finally:
            await file.close()
    else:
        body = await request.json()
        file_name = body.get("file_name", "upload.json")
        overrides["name"] = body.get("name")
        if "content_base64" in body and body["content_base64"]:
            import base64
            file_bytes = base64.b64decode(body["content_base64"])
        elif "content_text" in body and body["content_text"]:
            file_bytes = body["content_text"].encode("utf-8")
        elif "canonical" in body and body["canonical"]:
            file_bytes = json.dumps(body["canonical"]).encode("utf-8")
            file_name = "topology.json"
        else:
            raise HTTPException(status_code=400, detail="No file content provided in request.")

    return parse_file_to_preview(file_bytes=file_bytes, file_name=file_name, overrides=overrides)


@app.post("/api/import/save", status_code=status.HTTP_201_CREATED)
def save_imported_topology(
    body: SaveImportRequest,
    _role: Role = Depends(require_role(Action.IMPORT)),
) -> dict:
    # 1. Verify cycles confirmation if cycles exist
    g = nx.DiGraph()
    for n in body.canonical.nodes:
        g.add_node(n.id)
    for d in body.canonical.dependencies:
        g.add_edge(d.provider_node_id, d.dependent_node_id)
    cycles = list(nx.simple_cycles(g))
    if cycles and not body.confirm_cycles:
        raise HTTPException(
            status_code=400,
            detail=f"Topology contains {len(cycles)} feedback cycle(s). You must acknowledge the cycle simulation dynamics by setting confirm_cycles=true before saving.",
        )

    # 2. Save in one transaction
    try:
        created = repo.create_topology(
            name=body.name,
            canonical=body.canonical,
            description=body.description or body.canonical.description,
        )
        return created
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to save imported topology: {str(e)}")


@app.get("/api/import/templates/{template_name}", dependencies=[Depends(get_authenticated_role)])
def download_import_template(template_name: str) -> Response:
    tname = template_name.lower().strip()
    if tname in ("synthetic-30-nodes.xlsx", "synthetic_airport_30nodes.xlsx", "30-nodes.xlsx"):
        content = generate_30_node_fixture_xlsx()
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        filename = "synthetic_airport_30nodes.xlsx"
    elif tname in ("30-nodes.json", "synthetic-30-nodes.json"):
        content = get_30_node_fixture().model_dump_json(indent=2).encode("utf-8")
        media_type = "application/json"
        filename = "synthetic_airport_30nodes.json"
    else:
        try:
            content, media_type, filename = generate_template(template_name)
        except ValueError as e:
            raise HTTPException(status_code=404, detail=str(e))

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ==============================================================================
# Enterprise Governance, Review & Approvals
# ==============================================================================

class ReviewCommentPayload(BaseModel):
    topology_id: str
    comment: str
    reviewer_name: Optional[str] = "Reviewer"


class DossierApprovalPayload(BaseModel):
    topology_id: str
    topology_version: int
    signoff_notes: str = Field(max_length=4000)
    run_id: Optional[str] = None
    approver_name: Optional[str] = "Designated Authority"


@app.post("/api/review/comments")
def add_review_comment(
    body: ReviewCommentPayload,
    _role: Role = Depends(require_role(Action.REVIEW)),
) -> dict:
    return {
        "status": "recorded",
        "topology_id": body.topology_id,
        "role": _role.value,
        "comment": body.comment,
        "reviewer_name": body.reviewer_name,
    }


def dossier_run(run_id: str, topology_id: str, topology_version: Optional[int]) -> dict:
    try:
        run = repo.get_run(run_id)
    except TopologyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if run["topology_id"] != topology_id or (
        topology_version is not None and run["topology_version"] != topology_version
    ):
        raise HTTPException(status_code=409, detail="The run does not belong to this topology version.")
    return run


def dossier_run_hash(run: dict) -> str:
    payload = json.dumps(run, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@app.post("/api/dossier/approve")
def approve_dossier(
    body: DossierApprovalPayload,
    request: Request,
    _role: Role = Depends(require_role(Action.APPROVE)),
) -> dict:
    if is_enterprise_mode():
        if not body.run_id:
            raise HTTPException(status_code=422, detail="A persisted run ID is required.")
        account = get_authenticated_account(request)
        run = dossier_run(body.run_id, body.topology_id, body.topology_version)
        if run["resolved_input"].get("topology_version") != run["topology_version"]:
            raise HTTPException(status_code=409, detail="Re-run with an explicit saved topology version before approval.")
        digest = dossier_run_hash(run)
        approval = repo.approve_run(
            run_id=body.run_id,
            approver=account.username,
            approver_role=account.role.value,
            notes=body.signoff_notes,
            run_sha256=digest,
            approval_type="enterprise",
            topology_id=run["topology_id"],
            topology_version=run["topology_version"],
            authenticated_account=account.username,
        )
        if approval is None:
            raise HTTPException(status_code=409, detail="This run already has an authenticated enterprise approval.")
        return {"status": "approved", "approval": approval}

    if body.run_id:
        run = dossier_run(body.run_id, body.topology_id, body.topology_version)
        if run["resolved_input"].get("topology_version") != run["topology_version"]:
            raise HTTPException(status_code=409, detail="Re-run with an explicit saved topology version before approval.")
        digest = dossier_run_hash(run)
        approver_name = body.approver_name or "Exercise Approver"
        approval = repo.approve_run(
            run_id=body.run_id,
            approver=approver_name,
            approver_role=_role.value,
            notes=body.signoff_notes,
            run_sha256=digest,
            approval_type="exercise",
            topology_id=run["topology_id"],
            topology_version=run["topology_version"],
            authenticated_account=None,
        )
        if approval is None:
            raise HTTPException(status_code=409, detail="This run already has an exercise sign-off.")
        return {"status": "approved", "approval": approval}

    return {
        "status": "approved",
        "topology_id": body.topology_id,
        "topology_version": body.topology_version,
        "approved_by_role": _role.value,
        "approver_name": body.approver_name,
        "signoff_notes": body.signoff_notes,
    }


@app.get("/api/export/dossier")
def export_dossier(
    topology_id: str,
    topology_version: Optional[int] = None,
    run_id: Optional[str] = None,
    _role: Role = Depends(require_role(Action.EXPORT)),
) -> dict:
    if is_enterprise_mode():
        if not run_id:
            raise HTTPException(status_code=422, detail="A persisted run ID is required.")
        run = dossier_run(run_id, topology_id, topology_version)
        digest = dossier_run_hash(run)
        # In enterprise mode, strictly query authenticated enterprise approvals
        approval = repo.get_run_approval(run_id, approval_type="enterprise")
        if approval and approval["run_sha256"] != digest:
            raise HTTPException(status_code=409, detail="Run integrity check failed.")
        return {
            "export_status": "success",
            "run": run,
            "run_sha256": digest,
            "approval": approval,
        }
    if run_id:
        try:
            run = dossier_run(run_id, topology_id, topology_version)
            digest = dossier_run_hash(run)
            approval = repo.get_run_approval(run_id)
            if approval and approval["run_sha256"] != digest:
                raise HTTPException(status_code=409, detail="Run integrity check failed.")
            return {
                "export_status": "success",
                "topology_id": topology_id,
                "topology_version": topology_version or run["topology_version"],
                "run": run,
                "run_sha256": digest,
                "approval": approval,
            }
        except TopologyNotFoundError:
            pass
    try:
        topo = repo.get_topology(topology_id)
    except TopologyNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "export_status": "success",
        "topology_id": topology_id,
        "topology_name": topo["name"],
        "version": topology_version or topo["current_version"],
        "exported_by_role": _role.value,
        "dossier": "Synthetic evidence bundle generated for exercise purposes.",
    }


@app.get("/api/backend-source")
def get_backend_source():
    if is_enterprise_mode():
        raise HTTPException(
            status_code=403,
            detail="Backend source viewer is disabled in the enterprise profile.",
        )
    return {"status": "enabled", "profile": "development"}


class RestorePayload(BaseModel):
    backup_path: str


@app.post("/api/admin/backup")
def trigger_backup(
    _role: Role = Depends(require_role(Action.MANAGE)),
) -> dict:
    import time
    backup_dir = os.environ.get("AEROCASCADE_BACKUP_DIR", "backups")
    os.makedirs(backup_dir, exist_ok=True)
    filename = f"aerocascade_backup_{int(time.time())}.db"
    dest_path = os.path.join(backup_dir, filename)
    repo.backup_database(dest_path)
    size_bytes = os.path.getsize(dest_path) if os.path.exists(dest_path) else 0
    return {
        "status": "success",
        "backup_file": filename,
        "backup_path": dest_path,
        "size_bytes": size_bytes,
    }


@app.post("/api/admin/restore")
def trigger_restore(
    body: RestorePayload,
    _role: Role = Depends(require_role(Action.MANAGE)),
) -> dict:
    target_path = body.backup_path
    if not os.path.isabs(target_path):
        backup_dir = os.environ.get("AEROCASCADE_BACKUP_DIR", "backups")
        target_path = os.path.join(backup_dir, target_path)

    if not os.path.exists(target_path):
        raise HTTPException(status_code=404, detail=f"Backup file '{body.backup_path}' not found")

    repo.restore_database(target_path)
    return {
        "status": "success",
        "restored_from": target_path,
    }
