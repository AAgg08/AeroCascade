"""
AeroCascade — Pydantic v2 Domain Models
Based on "Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations"
(Aggarwal & Dhillon, AIAA Aviation 2026) and Dhillon & Moores (2001) Tripartite Control Framework.
"""

from __future__ import annotations
from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field, computed_field


class CascadeStage(str, Enum):
    STAGE_1_TRIGGER = "STAGE_1_TRIGGER"
    STAGE_2_PROPAGATION = "STAGE_2_PROPAGATION"
    STAGE_3_BLOCKER = "STAGE_3_BLOCKER"


class ControlCategory(str, Enum):
    TECHNICAL = "TECHNICAL"
    FORMAL = "FORMAL"
    INFORMAL = "INFORMAL"


class PSOELevel(str, Enum):
    PRESENT = "PRESENT"
    SUITABLE = "SUITABLE"
    OPERATIONAL = "OPERATIONAL"
    EFFECTIVE = "EFFECTIVE"


class ER040Severity(str, Enum):
    CATASTROPHIC_1 = "1_CATASTROPHIC"
    HAZARDOUS_2 = "2_HAZARDOUS"
    MAJOR_3 = "3_MAJOR"
    MINOR_4 = "4_MINOR"
    NO_SAFETY_EFFECT_5 = "5_NO_SAFETY_EFFECT"


class TripartiteControls(BaseModel):
    """
    Dhillon & Moores (2001) Tripartite Security Control Allocation (0-100 scale).
    - Technical: Cryptographic link auth, SDI/IP packet inspection, GNSS anti-spoofing, network segmentation.
    - Formal: EASA Part-IS playbooks, contingency SOPs, SLA governance, formal authority delegation.
    - Informal: ATCO situational awareness, tacit trust calibration, cross-team communication norms, safety culture.
    """
    technical: float = Field(default=60.0, ge=0.0, le=100.0, description="Technical control maturity (0-100)")
    formal: float = Field(default=50.0, ge=0.0, le=100.0, description="Formal rule/SOP control maturity (0-100)")
    informal: float = Field(default=45.0, ge=0.0, le=100.0, description="Informal behavioral/cultural maturity (0-100)")

    @computed_field
    @property
    def composite_effectiveness(self) -> float:
        # Weighted harmonic-geometric blend emphasizing that technical controls alone cannot clear Stage 3 blockers
        return round(0.35 * self.technical + 0.35 * self.formal + 0.30 * self.informal, 2)


class FMEAMetrics(BaseModel):
    """
    Failure Mode and Effects Analysis (FMEA) Quantification:
    RPN = Likelihood (1-5) * Impact (1-5) * Recovery Complexity (1-5)
    """
    likelihood: int = Field(default=3, ge=1, le=5, description="Probability of exploit/occurrence (1-5)")
    impact: int = Field(default=4, ge=1, le=5, description="Operational & safety severity (1-5)")
    recovery_complexity: int = Field(default=4, ge=1, le=5, description="Restoration & synchronization difficulty (1-5)")
    policy_investment: float = Field(default=45.0, ge=0.0, le=100.0, description="Allocated resource/policy investment (0-100)")

    @computed_field
    @property
    def raw_rpn(self) -> int:
        return self.likelihood * self.impact * self.recovery_complexity


class SystemNodeModel(BaseModel):
    id: str
    code: str
    label: str
    subsystem: str
    stage: CascadeStage
    dominant_control: ControlCategory
    description: str
    failure_mode: str
    tripartite: TripartiteControls
    fmea: FMEAMetrics
    psoe_status: PSOELevel
    er040_severity: ER040Severity
    base_latency_minutes: float = Field(default=18.0, ge=1.0, le=360.0)


class DependencyEdgeModel(BaseModel):
    id: str
    source: str
    target: str
    coupling_weight: float = Field(default=0.75, ge=0.05, le=1.0)
    propagation_mechanism: str
    protocol_layer: str


class SimulationRequest(BaseModel):
    scenario_id: str
    horizon_hours: int = Field(default=24, ge=6, le=72)
    baseline_movements_per_hour: int = Field(default=48, ge=10, le=120)
    trigger_hour: int = Field(default=4, ge=1, le=12)
    random_seed: int = Field(default=2026)
    nodes: List[SystemNodeModel]
    edges: List[DependencyEdgeModel]


class DiscreteEventRecord(BaseModel):
    event_id: str
    timestamp_hours: float
    formatted_time: str
    stage: CascadeStage
    node_id: str
    node_code: str
    node_label: str
    dominant_control: ControlCategory
    event_type: str
    narrative: str
    capacity_impact_pct: float
    residual_rpn: float


class HourlyCapacityPoint(BaseModel):
    hour: int
    time_label: str
    baseline_capacity: float
    unmitigated_capacity: float
    technical_only_capacity: float
    tripartite_mitigated_capacity: float
    active_stage: str
    delayed_flights_cumulative: int


class NodeCentralityMetric(BaseModel):
    node_id: str
    node_code: str
    label: str
    stage: CascadeStage
    betweenness_centrality: float
    in_degree_vulnerability: float
    out_degree_blast_radius: float
    chokepoint_index: float
    raw_rpn: int
    residual_rpn: float
    policy_investment: float
    investment_efficiency_gap: float


class EASAPartISNotification(BaseModel):
    report_id: str
    regulation_basis: List[str]
    reporting_entity: str
    initial_notification_deadline_hours: int = 72
    incident_classification: str
    er040_risk_class: str
    affected_assets: List[str]
    stage_1_technical_root_cause: str
    stage_2_operational_propagation: str
    stage_3_governance_recovery_blocker: str
    psoe_maturity_summary: Dict[str, str]
    containment_actions: List[str]
    structural_remediations: List[str]


class SimulationResponse(BaseModel):
    scenario_id: str
    summary_kpis: Dict[str, float]
    events: List[DiscreteEventRecord]
    hourly_capacity: List[HourlyCapacityPoint]
    node_analytics: List[NodeCentralityMetric]
    easa_notification: EASAPartISNotification
