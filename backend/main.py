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
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .canonical import (
    CanonicalTopology,
    canonical_to_simulation_request,
)
from .graph_engine import build_dependency_graph
from .models import SimulationRequest, SimulationResponse
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
