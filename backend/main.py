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
import json
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Query, status, Request, Response, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import networkx as nx

from .canonical import (
    CanonicalTopology,
    canonical_to_simulation_request,
)
from .graph_engine import build_dependency_graph
from .models import SimulationRequest, SimulationResponse
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

app = FastAPI(
    title="AeroCascade Aviation Cybersecurity Causal Simulation Engine & Topology Repository",
    description=(
        "Authoritative FastAPI + NetworkX + SimPy causal simulator and SQLite versioned topology repository for "
        "'Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations' "
        "(Aggarwal & Dhillon, AIAA Aviation 2026)."
    ),
    version="2.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


@app.post("/api/simulate", response_model=SimulationResponse)
def simulate_cascade(payload: SimulationRequest) -> SimulationResponse:
    try:
        res = run_cascade_simulation(payload)
        # If payload specifies a known topology_id, attempt to record the run against that version
        try:
            topo = repo.get_topology(payload.scenario_id)
            if topo:
                # Find matching version or default to input_revision / current_version
                target_ver = payload.input_revision if payload.input_revision <= topo["current_version"] else topo["current_version"]
                repo.record_run(payload.scenario_id, target_ver, payload, res)
        except Exception:
            # If scenario_id is not in repository (or custom run), simulation still succeeds
            pass
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation engine error: {str(e)}")


@app.post("/api/topology/centrality")
def analyze_topology(payload: SimulationRequest) -> dict:
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

@app.get("/api/topologies")
def list_topologies() -> dict:
    topos = repo.list_topologies()
    return {"topologies": topos}


@app.post("/api/topologies", status_code=status.HTTP_201_CREATED)
def create_topology(body: CreateTopologyPayload) -> dict:
    try:
        return repo.create_topology(
            name=body.name,
            canonical=body.canonical,
            description=body.description,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create topology: {e}")


@app.get("/api/topologies/{topology_id}")
def get_topology(topology_id: str) -> dict:
    try:
        return repo.get_topology(topology_id)
    except TopologyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/api/topologies/{topology_id}/versions/{version_num}")
def get_topology_version(topology_id: str, version_num: int) -> dict:
    try:
        return repo.get_version(topology_id, version_num)
    except TopologyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.post("/api/topologies/{topology_id}/versions")
def save_new_version(topology_id: str, body: SaveVersionPayload) -> dict:
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
def clone_topology(topology_id: str, body: CloneTopologyPayload) -> dict:
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


@app.get("/api/runs")
def list_runs(
    topology_id: Optional[str] = Query(None),
    topology_version: Optional[int] = Query(None),
) -> dict:
    runs = repo.list_runs(topology_id=topology_id, topology_version=topology_version)
    return {"runs": runs}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict:
    try:
        return repo.get_run(run_id)
    except TopologyNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ==============================================================================
# Topology Importer REST Endpoints
# ==============================================================================

@app.post("/api/import/preview", response_model=ImportPreviewResponse)
async def preview_topology_import(
    request: Request,
    file: Optional[UploadFile] = File(None),
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
def save_imported_topology(body: SaveImportRequest) -> dict:
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


@app.get("/api/import/templates/{template_name}")
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
