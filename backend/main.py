"""
AeroCascade — FastAPI Backend Entry Point
Exposes authoritative REST API endpoints for NetworkX topology analysis,
SimPy causal discrete-event simulation, FMEA RPN quantification, and EASA Part-IS compliance exports.

Version: 2.0.0-causal
"""

from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .graph_engine import build_dependency_graph
from .models import SimulationRequest, SimulationResponse
from .simpy_engine import run_cascade_simulation

app = FastAPI(
    title="AeroCascade Aviation Cybersecurity Causal Simulation Engine",
    description=(
        "Authoritative FastAPI + NetworkX + SimPy causal simulator for 'Modernizing Aviation Infrastructure—"
        "Cybersecurity Challenges in the Era of Remote Tower Operations' (Aggarwal & Dhillon, AIAA Aviation 2026)."
    ),
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health_check() -> dict:
    return {
        "status": "ok",
        "engine": "AeroCascade FastAPI + SimPy + NetworkX (Authoritative Causal Engine)",
        "model_version": "2.0.0-causal",
        "schema_version": "2.0.0",
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
        return run_cascade_simulation(payload)
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
