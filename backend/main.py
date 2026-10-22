"""
AeroCascade — FastAPI Backend Entry Point
Exposes REST API endpoints for NetworkX topology analysis, SimPy discrete-event cascade simulation,
FMEA RPN quantification, and EASA Part-IS / EUROCAE ER-040 regulatory exports.
"""

from __future__ import annotations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .graph_engine import build_dependency_graph
from .models import SimulationRequest, SimulationResponse
from .simpy_engine import run_cascade_simulation

app = FastAPI(
    title="AeroCascade Aviation Cybersecurity Simulation Engine",
    description=(
        "FastAPI + NetworkX + SimPy + NumPy backend for 'Modernizing Aviation Infrastructure—"
        "Cybersecurity Challenges in the Era of Remote Tower Operations' (Aggarwal & Dhillon, AIAA Aviation 2026)."
    ),
    version="1.0.0",
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
        "engine": "AeroCascade FastAPI + SimPy + NetworkX",
        "frameworks": ["Dhillon & Moores (2001)", "EASA Part-IS (EU) 2022/1645 & 2023/203", "EUROCAE ER-040", "PSOE"],
    }


@app.post("/api/simulate", response_model=SimulationResponse)
def simulate_cascade(payload: SimulationRequest) -> SimulationResponse:
    return run_cascade_simulation(payload)


@app.post("/api/topology/centrality")
def analyze_topology(payload: SimulationRequest) -> dict:
    _, analytics = build_dependency_graph(payload.nodes, payload.edges)
    return {"scenario_id": payload.scenario_id, "node_analytics": analytics}
