"""
AeroCascade — Pydantic v2 Domain Models
Based on "Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations"
(Aggarwal & Dhillon, AIAA Aviation 2026) and Dhillon & Moores (2001) Tripartite Control Framework.

Version: 2.0.0-causal
"""

from __future__ import annotations
from enum import Enum
from typing import Any, Dict, List, Optional
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
    NOT_ASSESSED = "NOT_ASSESSED"
    NOT_PRESENT = "NOT_PRESENT"
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


class NodeState(str, Enum):
    AVAILABLE = "AVAILABLE"
    FAILED = "FAILED"
    REPAIRING = "REPAIRING"
    AWAITING_AUTHORIZATION = "AWAITING_AUTHORIZATION"
    RECOVERED = "RECOVERED"


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
    base_latency_minutes: float = Field(default=18.0, ge=0.0, le=1440.0)
    repair_duration_hours: float = Field(default=2.0, ge=0.0, description="Technical repair time required once technician is assigned")
    requires_authorization: bool = Field(default=False, description="Whether operational restoration requires formal supervisor/Part-IS sign-off")
    authorization_delay_hours: float = Field(default=0.0, ge=0.0, description="Administrative authorization delay post-repair")
    required_technicians: int = Field(default=1, ge=0, description="Technicians required concurrently for repair")
    redundancy_group: Optional[str] = Field(default=None, description="Identifier for shared redundancy pool if applicable")
    is_primary: bool = Field(default=True, description="True if primary asset in redundancy group, False if backup")


class DependencyEdgeModel(BaseModel):
    id: str
    source: str
    target: str
    coupling_weight: float = Field(default=0.75, ge=0.05, le=1.0)
    propagation_mechanism: str
    protocol_layer: str
    propagation_delay_hours: float = Field(default=0.25, ge=0.0, description="Delay in hours before failure propagates along this edge")
    dependency_type: str = Field(default="REQUIRED", description="REQUIRED (failure forces target failure) or REDUNDANT")
    distance_weight: float = Field(default=1.0, gt=0.0, description="Positive edge distance for NetworkX shortest path calculation")


class RedundancyGroupConfig(BaseModel):
    """
    Explicit redundancy configuration between primary and backup nodes.
    One failed source does not interrupt service after a successful configured failover;
    loss of both causes complete service outage.
    """
    group_id: str
    primary_node_id: str
    backup_node_ids: List[str] = Field(default_factory=list)
    failover_delay_hours: float = Field(default=0.05, ge=0.0, description="Transient delay during automatic/manual failover")
    degraded_capacity_factor: float = Field(default=1.0, ge=0.0, le=1.0, description="Capacity factor when running on backup")


class AirportService(BaseModel):
    """
    Explicit operational airport service (e.g. Visual Surveillance, Flight Strip Synchronization).
    Capacity is governed by the bottleneck function: nominal * min(services) * staffed_fraction.
    """
    service_id: str
    name: str
    required_node_ids: List[str] = Field(default_factory=list)
    redundancy_group_id: Optional[str] = None
    criticality_weight: float = Field(default=1.0, ge=0.0, le=1.0)
    degraded_availability_factor: float = Field(default=0.0, ge=0.0, le=1.0)


class InitiatingEvent(BaseModel):
    """
    Explicit initiating event specifying node and event trigger time.
    With no initiating events, capacities remain nominal.
    """
    event_id: str = ""
    node_id: str
    event_time_hours: float = Field(ge=0.0)
    failure_mode: str = "Initiating cyber-physical fault breach"
    parent_event_id: Optional[str] = None


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
    parent_event_id: Optional[str] = None
    causal_reason: str = ""
    state_from: str = ""
    state_to: str = ""


class HourlyCapacityPoint(BaseModel):
    hour: int
    time_label: str
    baseline_capacity: float
    unmitigated_capacity: float
    technical_only_capacity: float
    tripartite_mitigated_capacity: float
    active_stage: str
    estimated_lost_capacity_cumulative: int = 0
    delayed_flights_cumulative: int = 0
    capacity_median: Optional[float] = None
    capacity_5th: Optional[float] = None
    capacity_95th: Optional[float] = None


class HourlyCapacityPercentiles(BaseModel):
    """Per-hour Monte Carlo confidence band: median, 5th and 95th percentiles of mitigated capacity."""
    hour: int
    time_label: str
    baseline_capacity: float
    capacity_median: float
    capacity_5th: float
    capacity_95th: float


class NodeCentralityMetric(BaseModel):
    node_id: str
    node_code: str
    label: str
    stage: CascadeStage
    dominant_control: Optional[str] = None
    betweenness_centrality: float
    in_degree_vulnerability: float
    out_degree_blast_radius: float
    chokepoint_index: float
    raw_rpn: int
    residual_rpn: float
    adjusted_risk_score: Optional[float] = None
    policy_investment: float
    investment_efficiency_gap: float
    psoe_status: Optional[str] = None
    er040_severity: Optional[str] = None
    direct_in_degree: int = 0
    direct_out_degree: int = 0
    downstream_reachable_nodes: int = 0
    downstream_reachability_ratio: float = 0.0


class RecoveryMetrics(BaseModel):
    """
    Sustained recovery metrics over [0, horizon).
    Reported as first sustained crossing of configured threshold for configured duration.
    If not observed before horizon, is_censored is True and recovery_time_hours is None.
    """
    recovered: bool
    recovery_time_hours: Optional[float] = None
    threshold_capacity: float
    sustained_duration_hours: float
    is_censored: bool
    censored_reason: Optional[str] = None


class EASAPartISReportingStage(BaseModel):
    stage_name: str
    legal_basis: str
    timing_rule: str
    status: str
    notes: str


class EASAPartISNotification(BaseModel):
    report_id: str
    regulation_basis: List[str]
    statutory_regulations: List[str] = Field(default_factory=list)
    voluntary_standards: List[str] = Field(default_factory=list)
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
    is_exercise_draft: bool = True
    reporting_applicability: str = "Not assessed (Subject to (EU) 2023/203 Art. 2 scope)"
    awareness_time: str = "Not assessed"
    official_guidance_url: str = (
        "https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-information-security?erules-id=ERULES-1963177438-19981"
    )
    reporting_stages: List[EASAPartISReportingStage] = Field(default_factory=list)


class ResultProvenance(BaseModel):
    engine: str = "fastapi-python"
    engine_label: str = "Python 3.12 (SimPy + NetworkX)"
    model_version: str = "2.0.0-causal"
    schema_version: str = "2.0.0"
    input_revision: int = 1
    replicates: int = 1
    generated_at: str
    is_fallback: bool = False
    fallback_reason: Optional[str] = None


class SimulationRequest(BaseModel):
    scenario_id: str
    topology_version: Optional[int] = Field(default=None, ge=1)
    horizon_hours: int = Field(default=24, ge=1, le=168)
    baseline_movements_per_hour: int = Field(default=48, ge=1, le=240)
    trigger_hour: int = Field(default=4, ge=0, le=168)
    random_seed: int = Field(default=2026)
    replicates: int = Field(default=1, ge=1, le=30, description="Number of Monte Carlo replicates (1 = deterministic baseline)")
    nodes: List[SystemNodeModel] = Field(default_factory=list)
    edges: List[DependencyEdgeModel] = Field(default_factory=list)
    initiating_events: List[InitiatingEvent] = Field(default_factory=list)
    services: List[AirportService] = Field(default_factory=list)
    redundancy_groups: List[RedundancyGroupConfig] = Field(default_factory=list)
    num_technicians: int = Field(default=1, ge=1)
    recovery_threshold_pct: float = Field(default=90.0, ge=10.0, le=100.0)
    recovery_sustained_hours: float = Field(default=1.0, ge=0.01, le=48.0)
    staffed_operation_fraction: float = Field(default=1.0, ge=0.0, le=1.0)
    input_revision: int = Field(default=1)


class SimulationResponse(BaseModel):
    scenario_id: str
    model_version: str = "2.0.0-causal"
    schema_version: str = "2.0.0"
    run_id: str = ""
    input_hash: str = ""
    parameter_set_version: str = "2026.1"
    random_seed: int = 2026
    replicates: int = 1
    summary_kpis: Dict[str, Any]
    events: List[DiscreteEventRecord]
    hourly_capacity: List[HourlyCapacityPoint]
    stochastic_capacity: Optional[List[HourlyCapacityPercentiles]] = None
    capacity_median: Optional[List[float]] = None
    capacity_5th: Optional[List[float]] = None
    capacity_95th: Optional[List[float]] = None
    node_analytics: List[NodeCentralityMetric]
    easa_notification: EASAPartISNotification
    recovery_metrics: Optional[RecoveryMetrics] = None
    provenance: Optional[ResultProvenance] = None
    input_snapshot: Optional[Dict[str, Any]] = None
