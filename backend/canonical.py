"""
AeroCascade — Canonical Topology and Migration Adapter
Defines a versioned canonical topology format with:
- Stable node and dependency IDs
- Explicit provider-to-dependent edge direction (provider_node_id -> dependent_node_id)
- Machine-readable synthetic source provenance
- Single adapter mapping canonical topology to SimulationRequest
"""

from __future__ import annotations
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from .models import (
    AirportService,
    CascadeStage,
    ControlCategory,
    DependencyEdgeModel,
    ER040Severity,
    FMEAMetrics,
    InitiatingEvent,
    PSOELevel,
    RedundancyGroupConfig,
    SimulationRequest,
    SystemNodeModel,
    TripartiteControls,
)


class CanonicalSourceProvenance(BaseModel):
    author: str = Field(
        default="Aryan Aggarwal & Gurpreet Dhillon",
        description="Original research model authors",
    )
    citation: str = Field(
        default="Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations (AIAA Aviation 2026)",
        description="Academic citation for the case study",
    )
    source_document: str = Field(
        default="AIAA 2026 / EUROCAE ER-040 synthetic case study",
        description="Source document or regulatory basis",
    )
    synthetic_fixture: bool = Field(
        default=True,
        description="Flags that this model is a synthetic benchmark fixture, not live operational data",
    )
    origin_scenario_id: Optional[str] = Field(
        default=None,
        description="ID of baseline scenario from which this canonical topology was seeded",
    )
    cloned_from_id: Optional[str] = Field(
        default=None,
        description="If cloned, ID of the origin topology",
    )
    cloned_from_version: Optional[int] = Field(
        default=None,
        description="If cloned, version number of the origin topology at time of clone",
    )
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO-8601 UTC creation timestamp",
    )


class CanonicalNode(BaseModel):
    id: str = Field(..., description="Stable node ID (e.g. 'n-ptz-rtp')")
    code: str = Field(..., description="Short identifier code (e.g. 'S1-OPT-01')")
    label: str = Field(..., description="Human-readable node label")
    subsystem: str = Field(..., description="Subsystem or operational domain")
    stage: CascadeStage = Field(..., description="Stage 1 (Trigger), Stage 2 (Propagation), Stage 3 (Blocker)")
    dominant_control: ControlCategory = Field(..., description="Technical, Formal, or Informal primary control")
    description: str = Field(default="", description="Detailed node description")
    failure_mode: str = Field(default="", description="Specific failure mode narrative")
    tripartite: TripartiteControls = Field(default_factory=TripartiteControls)
    fmea: FMEAMetrics = Field(default_factory=FMEAMetrics)
    psoe_status: PSOELevel = Field(default=PSOELevel.NOT_ASSESSED)
    er040_severity: ER040Severity = Field(default=ER040Severity.MAJOR_3)
    base_latency_minutes: float = Field(default=18.0, ge=0.0)
    repair_duration_hours: float = Field(default=2.0, ge=0.0)
    requires_authorization: bool = Field(default=False)
    authorization_delay_hours: float = Field(default=0.0, ge=0.0)
    required_technicians: int = Field(default=1, ge=0)
    redundancy_group: Optional[str] = Field(default=None)
    is_primary: bool = Field(default=True)
    failover_delay_hours: float = Field(default=0.05, ge=0.0)
    degraded_capacity_factor: float = Field(default=0.5, ge=0.0, le=1.0)
    mitigation_recommendation: str = Field(default="")


class CanonicalDependency(BaseModel):
    id: str = Field(..., description="Stable dependency ID (e.g. 'dep-ptz-to-fusion' or 'e-1')")
    provider_node_id: str = Field(
        ...,
        description="Explicit provider / upstream source node that supplies service or signal",
    )
    dependent_node_id: str = Field(
        ...,
        description="Explicit dependent / downstream target node impacted if provider fails",
    )
    coupling_weight: float = Field(default=0.75, ge=0.05, le=1.0)
    propagation_mechanism: str = Field(default="", description="Causal mechanism description")
    protocol_layer: str = Field(default="", description="Network, application, or organizational protocol")
    propagation_delay_hours: float = Field(default=0.25, ge=0.0)
    dependency_type: str = Field(default="REQUIRED")
    distance_weight: float = Field(default=1.0, gt=0.0)


class CanonicalTopology(BaseModel):
    schema_version: str = Field(default="1.0.0", description="Canonical topology schema version")
    topology_id: str = Field(..., description="Stable topology identifier")
    name: str = Field(..., description="Human-readable topology name")
    description: str = Field(default="", description="Operational overview and context")
    version: int = Field(default=1, ge=1, description="Immutable version counter")
    aerodrome_profile: str = Field(default="Regional Hub (48 mvmt/hr)")
    baseline_movements_per_hour: float = Field(default=48.0, ge=1.0, le=240.0)
    trigger_hour: float = Field(default=4.0, ge=0.0)
    horizon_hours: float = Field(default=24.0, ge=1.0, le=168.0)
    cost_per_delayed_movement: float = Field(default=7500.0, ge=0.0)
    source_provenance: CanonicalSourceProvenance = Field(default_factory=CanonicalSourceProvenance)
    nodes: List[CanonicalNode] = Field(default_factory=list)
    dependencies: List[CanonicalDependency] = Field(default_factory=list)
    services: List[AirportService] = Field(default_factory=list)
    redundancy_groups: Dict[str, RedundancyGroupConfig] = Field(default_factory=dict)


def canonical_to_simulation_request(
    canonical: CanonicalTopology,
    overrides: Optional[Dict[str, Any]] = None,
) -> SimulationRequest:
    """
    Single authoritative adapter: converts a versioned CanonicalTopology into the
    exact SimulationRequest expected by the SimPy discrete-event simulation engine.
    Maps:
      dep.provider_node_id -> edge.source
      dep.dependent_node_id -> edge.target
    """
    # 1. Map canonical nodes to SystemNodeModel
    system_nodes: List[SystemNodeModel] = []
    for node in canonical.nodes:
        system_nodes.append(
            SystemNodeModel(
                id=node.id,
                code=node.code,
                label=node.label,
                subsystem=node.subsystem,
                stage=node.stage,
                dominant_control=node.dominant_control,
                description=node.description,
                failure_mode=node.failure_mode,
                tripartite=node.tripartite,
                fmea=node.fmea,
                psoe_status=node.psoe_status,
                er040_severity=node.er040_severity,
                base_latency_minutes=node.base_latency_minutes,
                repair_duration_hours=node.repair_duration_hours,
                requires_authorization=node.requires_authorization,
                authorization_delay_hours=node.authorization_delay_hours,
                required_technicians=node.required_technicians,
                redundancy_group=node.redundancy_group,
                is_primary=node.is_primary,
            )
        )

    # 2. Map canonical dependencies to DependencyEdgeModel (provider -> source, dependent -> target)
    dependency_edges: List[DependencyEdgeModel] = []
    for dep in canonical.dependencies:
        dependency_edges.append(
            DependencyEdgeModel(
                id=dep.id,
                source=dep.provider_node_id,
                target=dep.dependent_node_id,
                coupling_weight=dep.coupling_weight,
                propagation_mechanism=dep.propagation_mechanism,
                protocol_layer=dep.protocol_layer,
                propagation_delay_hours=dep.propagation_delay_hours,
                dependency_type=dep.dependency_type,
                distance_weight=dep.distance_weight,
            )
        )

    # 3. Explicit initiating events for Stage 1 trigger nodes
    stage1_nodes = [n for n in canonical.nodes if n.stage == CascadeStage.STAGE_1_TRIGGER]
    initiating_events = [
        InitiatingEvent(
            node_id=n.id,
            event_time_hours=canonical.trigger_hour,
            failure_mode=n.failure_mode,
        )
        for n in stage1_nodes
    ]

    redundancy_groups_list: List[RedundancyGroupConfig] = []
    if isinstance(canonical.redundancy_groups, dict):
        redundancy_groups_list = list(canonical.redundancy_groups.values())
    elif isinstance(canonical.redundancy_groups, list):
        redundancy_groups_list = canonical.redundancy_groups

    payload: Dict[str, Any] = {
        "scenario_id": canonical.topology_id,
        "horizon_hours": int(round(canonical.horizon_hours)),
        "baseline_movements_per_hour": int(round(canonical.baseline_movements_per_hour)),
        "trigger_hour": int(round(canonical.trigger_hour)),
        "nodes": system_nodes,
        "edges": dependency_edges,
        "initiating_events": initiating_events,
        "services": canonical.services,
        "redundancy_groups": redundancy_groups_list,
        "replicates": 1,
        "random_seed": 2026,
        "input_revision": canonical.version,
    }

    if overrides:
        payload.update(overrides)

    return SimulationRequest(**payload)


def preset_dict_to_canonical_topology(preset: Dict[str, Any]) -> CanonicalTopology:
    """
    Converts a scenario preset dictionary into a valid CanonicalTopology.
    Preserves existing presets and browser workspace compatibility while ensuring
    stable IDs and explicit provider-to-dependent edge directions.
    """
    nodes: List[CanonicalNode] = []
    for n in preset.get("nodes", []):
        nodes.append(
            CanonicalNode(
                id=n["id"],
                code=n["code"],
                label=n["label"],
                subsystem=n.get("subsystem", "General"),
                stage=n["stage"],
                dominant_control=n["dominant_control"],
                description=n.get("description", ""),
                failure_mode=n.get("failure_mode", ""),
                tripartite=TripartiteControls(**n.get("tripartite", {})),
                fmea=FMEAMetrics(**n.get("fmea", {})),
                psoe_status=n.get("psoe_status", PSOELevel.NOT_ASSESSED),
                er040_severity=n.get("er040_severity", ER040Severity.MAJOR_3),
                base_latency_minutes=float(n.get("base_latency_minutes", 18.0)),
                repair_duration_hours=float(n.get("repair_duration_hours", 2.0)),
                requires_authorization=bool(n.get("requires_authorization", False)),
                authorization_delay_hours=float(n.get("authorization_delay_hours", 0.0)),
                required_technicians=int(n.get("required_technicians", 1)),
                redundancy_group=n.get("redundancy_group"),
                is_primary=bool(n.get("is_primary", True)),
                failover_delay_hours=float(n.get("failover_delay_hours", 0.05)),
                degraded_capacity_factor=float(n.get("degraded_capacity_factor", 0.5)),
                mitigation_recommendation=n.get("mitigation_recommendation", ""),
            )
        )

    dependencies: List[CanonicalDependency] = []
    for idx, e in enumerate(preset.get("edges", [])):
        dep_id = e.get("id") or f"dep-{e['source']}-to-{e['target']}"
        dependencies.append(
            CanonicalDependency(
                id=dep_id,
                provider_node_id=e["source"],   # source is provider
                dependent_node_id=e["target"],  # target is dependent
                coupling_weight=float(e.get("coupling_weight", 0.75)),
                propagation_mechanism=e.get("propagation_mechanism", ""),
                protocol_layer=e.get("protocol_layer", "IP/Ethernet"),
                propagation_delay_hours=float(e.get("propagation_delay_hours", 0.25)),
                dependency_type=e.get("dependency_type", "REQUIRED"),
                distance_weight=float(e.get("distance_weight", 1.0)),
            )
        )

    services: List[AirportService] = []
    for s in preset.get("services", []):
        services.append(AirportService(**s))

    redundancy_groups: Dict[str, RedundancyGroupConfig] = {}
    for gid, cfg in preset.get("redundancy_groups", {}).items():
        if isinstance(cfg, dict):
            redundancy_groups[gid] = RedundancyGroupConfig(**cfg)
        else:
            redundancy_groups[gid] = cfg

    return CanonicalTopology(
        schema_version="1.0.0",
        topology_id=preset["id"],
        name=preset.get("title", preset["id"]),
        description=preset.get("abstract", preset.get("subtitle", "")),
        version=1,
        aerodrome_profile=preset.get("aerodrome_profile", "Regional Hub (48 mvmt/hr)"),
        baseline_movements_per_hour=float(preset.get("baseline_movements_per_hour", 48.0)),
        trigger_hour=float(preset.get("trigger_hour", 4.0)),
        horizon_hours=float(preset.get("horizon_hours", 24.0)),
        cost_per_delayed_movement=float(preset.get("cost_per_delayed_movement", 7500.0)),
        source_provenance=CanonicalSourceProvenance(
            origin_scenario_id=preset["id"],
            synthetic_fixture=True,
            source_document="Aggarwal & Dhillon (AIAA Aviation 2026)",
        ),
        nodes=nodes,
        dependencies=dependencies,
        services=services,
        redundancy_groups=redundancy_groups,
    )
