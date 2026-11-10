"""
AeroCascade — Authoritative SimPy Causal Simulation Engine
Models causal dependency propagation, explicit redundancy/failover, concurrent resource-limited repair,
and airport service bottleneck capacity derived directly from the state-transition timeline.

Based on "Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations"
(Aggarwal & Dhillon, AIAA Aviation 2026).

Version: 2.0.0-causal
"""

from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
import math
from typing import Any, Dict, List, Optional, Set, Tuple
import uuid
import numpy as np
import simpy

from .graph_engine import build_dependency_graph, compute_residual_rpn
from .models import (
    AirportService,
    CascadeStage,
    ControlCategory,
    DiscreteEventRecord,
    EASAPartISNotification,
    HourlyCapacityPoint,
    InitiatingEvent,
    NodeState,
    RecoveryMetrics,
    RedundancyGroupConfig,
    ResultProvenance,
    SimulationRequest,
    SimulationResponse,
    SystemNodeModel,
)


def format_elapsed_time(hours_float: float) -> str:
    """
    Formats elapsed simulation duration as T+HH:MM without 24-hour wrapping and without UTC 'Z' suffix.
    E.g., 4.25h -> 'T+04:15', 26.5h -> 'T+26:30'.
    """
    total_minutes = int(round(hours_float * 60))
    hh = total_minutes // 60
    mm = total_minutes % 60
    return f"T+{hh:02d}:{mm:02d}"


def to_psoe_maturity(score: float) -> str:
    """Centralized illustrative PSOE maturity evaluation."""
    if score <= 0.0:
        return "NOT_PRESENT"
    if score >= 75.0:
        return "EFFECTIVE"
    if score >= 55.0:
        return "OPERATIONAL"
    if score >= 35.0:
        return "SUITABLE"
    return "PRESENT"


def validate_simulation_request(req: SimulationRequest) -> None:
    """Strictly validates the simulation request schema and invariants."""
    if not req.nodes:
        raise ValueError("Simulation node list cannot be empty.")

    seen_node_ids: Set[str] = set()
    for n in req.nodes:
        if n.id in seen_node_ids:
            raise ValueError(f"Duplicate node ID detected: '{n.id}'")
        seen_node_ids.add(n.id)

    for edge in req.edges:
        if edge.source not in seen_node_ids:
            raise ValueError(f"Dangling edge '{edge.id}': source '{edge.source}' does not exist in nodes.")
        if edge.target not in seen_node_ids:
            raise ValueError(f"Dangling edge '{edge.id}': target '{edge.target}' does not exist in nodes.")

    if req.horizon_hours <= 0:
        raise ValueError(f"horizon_hours must be positive; got {req.horizon_hours}")
    if req.trigger_hour < 0 or req.trigger_hour >= req.horizon_hours:
        raise ValueError(
            f"trigger_hour ({req.trigger_hour}) must be >= 0 and strictly less than horizon_hours ({req.horizon_hours})"
        )
    if req.baseline_movements_per_hour <= 0:
        raise ValueError(f"baseline_movements_per_hour must be positive; got {req.baseline_movements_per_hour}")

    for init_ev in req.initiating_events:
        if init_ev.node_id not in seen_node_ids:
            raise ValueError(
                f"Initiating event references non-existent node '{init_ev.node_id}'"
            )
        if init_ev.event_time_hours < 0 or init_ev.event_time_hours >= req.horizon_hours:
            raise ValueError(
                f"Initiating event time ({init_ev.event_time_hours}h) must be within [0, {req.horizon_hours}h)"
            )

    for service in req.services:
        if not service.required_node_ids:
            raise ValueError(f"Service '{service.service_id}' must identify required nodes.")
        missing = set(service.required_node_ids) - seen_node_ids
        if missing:
            raise ValueError(f"Service '{service.service_id}' references unknown nodes: {sorted(missing)}")

    # Check non-finite values
    numeric_checks = [
        req.horizon_hours,
        req.baseline_movements_per_hour,
        req.trigger_hour,
        req.staffed_operation_fraction,
        req.recovery_threshold_pct,
        req.recovery_sustained_hours,
    ]
    for val in numeric_checks:
        if isinstance(val, (int, float)) and (math.isnan(val) or math.isinf(val)):
            raise ValueError(f"Non-finite numeric value detected in request: {val}")


def compute_input_hash(req: SimulationRequest) -> str:
    """Computes a deterministic SHA256 hash of the complete input payload."""
    serialized = json.dumps(req.model_dump(), sort_keys=True, default=str)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def run_cascade_simulation(req: SimulationRequest) -> SimulationResponse:
    """
    Executes an authoritative discrete-event causal simulation in SimPy.
    - Explicit initiating events
    - Dependency propagation along enabled graph edges with parent event tracking
    - Explicit redundancy groups with failover delay
    - Concurrent resource-constrained technician repair
    - Formal supervisory/workforce recovery constraints
    - Capacity derived directly from the service state-transition history
    """
    validate_simulation_request(req)

    # Build NetworkX graph and canonical centrality metrics
    G, node_analytics = build_dependency_graph(req.nodes, req.edges)
    node_map: Dict[str, SystemNodeModel] = {n.id: n for n in req.nodes}

    # Redundancy groups lookup
    redundancy_by_group: Dict[str, RedundancyGroupConfig] = {
        rg.group_id: rg for rg in req.redundancy_groups
    }
    # Auto-register redundancy groups from node models if not explicitly supplied
    for n in req.nodes:
        if n.redundancy_group and n.redundancy_group not in redundancy_by_group:
            # Find all nodes in this group
            group_nodes = [gn for gn in req.nodes if gn.redundancy_group == n.redundancy_group]
            primaries = [gn for gn in group_nodes if gn.is_primary]
            primary_id = primaries[0].id if primaries else group_nodes[0].id
            backup_ids = [gn.id for gn in group_nodes if gn.id != primary_id]
            redundancy_by_group[n.redundancy_group] = RedundancyGroupConfig(
                group_id=n.redundancy_group,
                primary_node_id=primary_id,
                backup_node_ids=backup_ids,
                failover_delay_hours=n.failover_delay_hours if hasattr(n, "failover_delay_hours") else 0.05,
                degraded_capacity_factor=1.0,
            )

    # Node state tracking: AVAILABLE, FAILED, REPAIRING, AWAITING_AUTHORIZATION, RECOVERED
    node_states: Dict[str, NodeState] = {n.id: NodeState.AVAILABLE for n in req.nodes}

    # SimPy environment setup
    env = simpy.Environment()
    technicians = simpy.Resource(env, capacity=max(1, req.num_technicians))

    events: List[DiscreteEventRecord] = []
    event_id_counter = 0

    # Piecewise continuous capacity state-transition history: List of (t_start, capacity)
    nominal_cap = float(req.baseline_movements_per_hour)
    timeline_changes: List[Tuple[float, float]] = []

    # Services definition
    services = req.services
    if not services:
        # Default service: core aerodrome movement capacity requires all functional nodes
        # If any required node fails, service is degraded proportional to the node's severity/impact
        services = [
            AirportService(
                service_id="svc-core-tower",
                name="Remote Tower Aerodrome Movement Service",
                required_node_ids=[n.id for n in req.nodes],
                degraded_availability_factor=0.25,
            )
        ]

    def compute_active_capacity(sim_time: float) -> float:
        """
        Bottleneck service capacity function:
        Capacity(t) = Nominal_Capacity * min(Service_Availability) * Staffed_Operation_Fraction
        """
        if not req.nodes:
            return 0.0

        service_availabilities: List[float] = []
        for svc in services:
            # Check availability of nodes required for this service
            required_nodes = [node_map[nid] for nid in svc.required_node_ids if nid in node_map]
            if not required_nodes:
                continue

            # Evaluate redundancy groups within this service
            svc_factor = 1.0
            unhedged_failures = 0
            for node in required_nodes:
                st = node_states[node.id]
                is_available = st in (NodeState.AVAILABLE, NodeState.RECOVERED)

                if is_available:
                    continue

                # Node is FAILED, REPAIRING, or AWAITING_AUTHORIZATION
                if node.redundancy_group and node.redundancy_group in redundancy_by_group:
                    rg = redundancy_by_group[node.redundancy_group]
                    # Check if any backup node is available
                    all_group_ids = [rg.primary_node_id] + rg.backup_node_ids
                    any_online = any(
                        node_states.get(gid) in (NodeState.AVAILABLE, NodeState.RECOVERED)
                        for gid in all_group_ids
                    )
                    if any_online:
                        # Redundant backup operational: service operates at degraded_capacity_factor
                        svc_factor = min(svc_factor, rg.degraded_capacity_factor)
                    else:
                        # All redundant members failed: complete outage of this redundancy group
                        svc_factor = min(svc_factor, svc.degraded_availability_factor)
                else:
                    # Single unhedged dependency failure
                    unhedged_failures += 1
                    # Fractional drop based on FMEA impact/severity
                    node_loss = (node.fmea.impact / 5.0) * (1.0 - svc.degraded_availability_factor)
                    svc_factor = min(svc_factor, max(0.0, 1.0 - node_loss))

            if unhedged_failures > 0 and svc_factor > svc.degraded_availability_factor:
                svc_factor = min(svc_factor, svc.degraded_availability_factor)

            service_availabilities.append(svc_factor)

        min_service_factor = min(service_availabilities) if service_availabilities else 1.0

        # Workforce constraint: Stage 3 formal/informal authorization blocks reduce staffed operation fraction
        active_staffed_fraction = float(req.staffed_operation_fraction)
        awaiting_auth_nodes = [
            n for n in req.nodes if node_states[n.id] == NodeState.AWAITING_AUTHORIZATION
        ]
        if awaiting_auth_nodes:
            # Authorization constraint suppresses operational restoration
            active_staffed_fraction = min(active_staffed_fraction, 0.40)

        current_cap = nominal_cap * min_service_factor * active_staffed_fraction
        return max(0.0, min(nominal_cap, round(current_cap, 2)))

    def record_capacity_transition(now: float):
        """Records a piecewise capacity change into the state-transition timeline."""
        if now >= req.horizon_hours:
            return
        new_cap = compute_active_capacity(now)
        # Avoid duplicate consecutive points at same timestamp
        if timeline_changes and timeline_changes[-1][0] == now:
            timeline_changes[-1] = (now, new_cap)
        else:
            timeline_changes.append((now, new_cap))

    def trigger_node_failure(
        node_id: str,
        now: float,
        causal_reason: str,
        parent_evt_id: Optional[str] = None,
    ):
        """Initiates failure of a node, schedules propagation to dependent children, and enqueues repair."""
        nonlocal event_id_counter

        node = node_map.get(node_id)
        if not node or now >= req.horizon_hours:
            return

        current_state = node_states[node_id]
        # Guard against duplicate transitions and cyclic event storms
        if current_state in (NodeState.FAILED, NodeState.REPAIRING, NodeState.AWAITING_AUTHORIZATION):
            return

        node_states[node_id] = NodeState.FAILED
        event_id_counter += 1
        stage_prefix = "S1" if node.stage == CascadeStage.STAGE_1_TRIGGER else "S2" if node.stage == CascadeStage.STAGE_2_PROPAGATION else "S3"
        evt_id = f"EVT-{stage_prefix}-{event_id_counter:02d}"

        res_rpn = compute_residual_rpn(node)
        cap_impact = round(max(5.0, (res_rpn / 125.0) * 50.0), 1)

        event_record = DiscreteEventRecord(
            event_id=evt_id,
            timestamp_hours=round(now, 2),
            formatted_time=format_elapsed_time(now),
            stage=node.stage,
            node_id=node.id,
            node_code=node.code,
            node_label=node.label,
            dominant_control=node.dominant_control,
            event_type="INITIAL_VECTOR_BREACH" if node.stage == CascadeStage.STAGE_1_TRIGGER else "OPERATIONAL_CASCADE_PROPAGATION",
            narrative=f"{node.failure_mode} ({causal_reason})",
            capacity_impact_pct=cap_impact,
            residual_rpn=res_rpn,
            parent_event_id=parent_evt_id,
            causal_reason=causal_reason,
            state_from=current_state.value,
            state_to=NodeState.FAILED.value,
        )
        events.append(event_record)
        record_capacity_transition(now)

        # 1. Schedule failure propagation along outbound dependency edges
        out_edges = [edge for edge in req.edges if edge.source == node_id]
        for edge in out_edges:
            child_node = node_map.get(edge.target)
            if not child_node:
                continue

            # Propagation delay
            prop_delay = float(edge.propagation_delay_hours)
            if prop_delay < 0:
                prop_delay = 0.0

            def propagate_process(env: simpy.Environment, target_id: str, delay: float, parent_id: str, mech: str):
                if delay > 0:
                    yield env.timeout(delay)
                if env.now < req.horizon_hours:
                    trigger_node_failure(
                        node_id=target_id,
                        now=env.now,
                        causal_reason=f"Propagated along dependency edge from {node.code} via {mech}",
                        parent_evt_id=parent_id,
                    )

            env.process(propagate_process(env, child_node.id, prop_delay, evt_id, edge.propagation_mechanism))

        # 2. Enqueue concurrent resource-constrained repair process
        def repair_node_process(env: simpy.Environment, n_id: str, fail_evt_id: str):
            nonlocal event_id_counter
            n = node_map[n_id]

            # Request technician resource (queues if capacity is exhausted)
            with technicians.request() as tech_req:
                yield tech_req

                if env.now >= req.horizon_hours:
                    return

                node_states[n_id] = NodeState.REPAIRING
                record_capacity_transition(env.now)

                # Execute technical repair
                repair_time = float(n.repair_duration_hours)
                yield env.timeout(repair_time)

                if env.now >= req.horizon_hours:
                    return

                # Technical repair finished, technician resource released here upon exiting 'with'

            # 3. Check procedural authorization / Stage 3 constraint
            if n.requires_authorization and n.authorization_delay_hours > 0:
                node_states[n_id] = NodeState.AWAITING_AUTHORIZATION
                record_capacity_transition(env.now)

                event_id_counter += 1
                events.append(
                    DiscreteEventRecord(
                        event_id=f"EVT-AUTH-{event_id_counter:02d}",
                        timestamp_hours=round(env.now, 2),
                        formatted_time=format_elapsed_time(env.now),
                        stage=CascadeStage.STAGE_3_BLOCKER,
                        node_id=n.id,
                        node_code=n.code,
                        node_label=n.label,
                        dominant_control=ControlCategory.FORMAL,
                        event_type="RECOVERY_GOVERNANCE_STALL",
                        narrative=f"Technical repair complete at {n.label}; awaiting operational supervisor authorization ({n.authorization_delay_hours:.1f}h).",
                        capacity_impact_pct=0.0,
                        residual_rpn=compute_residual_rpn(n),
                        parent_event_id=fail_evt_id,
                        causal_reason="Procedural authorization pending post-repair",
                        state_from=NodeState.REPAIRING.value,
                        state_to=NodeState.AWAITING_AUTHORIZATION.value,
                    )
                )

                yield env.timeout(float(n.authorization_delay_hours))

                if env.now >= req.horizon_hours:
                    return

            # 4. Operational restoration
            node_states[n_id] = NodeState.RECOVERED
            event_id_counter += 1
            events.append(
                DiscreteEventRecord(
                    event_id=f"EVT-REC-{event_id_counter:02d}",
                    timestamp_hours=round(env.now, 2),
                    formatted_time=format_elapsed_time(env.now),
                    stage=CascadeStage.STAGE_3_BLOCKER,
                    node_id=n.id,
                    node_code=n.code,
                    node_label=n.label,
                    dominant_control=n.dominant_control,
                    event_type="OPERATIONAL_RESTORATION",
                    narrative=f"Operational restoration complete for {n.label}.",
                    capacity_impact_pct=0.0,
                    residual_rpn=compute_residual_rpn(n),
                    parent_event_id=fail_evt_id,
                    causal_reason="Technical repair and authorization requirements fulfilled",
                    state_from=NodeState.AWAITING_AUTHORIZATION.value if n.requires_authorization else NodeState.REPAIRING.value,
                    state_to=NodeState.RECOVERED.value,
                )
            )
            record_capacity_transition(env.now)

        env.process(repair_node_process(env, node_id, evt_id))

    # Initial capacity must include workforce constraints even without any faults.
    record_capacity_transition(0.0)

    # Empty means no faults. Preset selection belongs to the caller, not the engine.
    initiating_events = req.initiating_events

    # Schedule initiating events in SimPy
    for init_ev in initiating_events:
        def init_process(env: simpy.Environment, ev: InitiatingEvent):
            if ev.event_time_hours > 0:
                yield env.timeout(ev.event_time_hours)
            if env.now < req.horizon_hours:
                trigger_node_failure(
                    node_id=ev.node_id,
                    now=env.now,
                    causal_reason="Initiating cyber-physical fault event",
                    parent_evt_id=None,
                )

        env.process(init_process(env, init_ev))

    # Run discrete-event simulation strictly until horizon
    env.run(until=float(req.horizon_hours))

    # Close timeline at horizon
    final_cap = compute_active_capacity(float(req.horizon_hours))
    if timeline_changes[-1][0] < req.horizon_hours:
        timeline_changes.append((float(req.horizon_hours), final_cap))

    # --- Piecewise Continuous Lost Capacity Integral ---
    # Total lost movement capacity = integral_0^H (C_nominal - C(t)) dt
    lost_capacity_integral = 0.0
    for idx in range(len(timeline_changes) - 1):
        t_start, cap_val = timeline_changes[idx]
        t_end = timeline_changes[idx + 1][0]
        dt = t_end - t_start
        lost_in_segment = (nominal_cap - cap_val) * dt
        lost_capacity_integral += max(0.0, lost_in_segment)

    lost_capacity_integral = round(lost_capacity_integral, 2)

    # --- Hourly Capacity Points ---
    hourly_capacity: List[HourlyCapacityPoint] = []
    running_cumulative_lost = 0.0

    for h in range(req.horizon_hours):
        # Find capacity at hour h by looking up active interval in timeline_changes
        active_cap = nominal_cap
        for t_chg, c_val in timeline_changes:
            if t_chg <= float(h):
                active_cap = c_val
            else:
                break

        # Calculate incremental lost capacity over [h, h+1]
        t_next = float(h + 1)
        seg_lost = 0.0
        # Find all intervals within [h, t_next]
        sub_points = [(t, c) for t, c in timeline_changes if h <= t < t_next]
        if not sub_points:
            seg_lost = max(0.0, (nominal_cap - active_cap) * 1.0)
        else:
            cur_t = float(h)
            cur_c = active_cap
            for spt, sc in sub_points:
                seg_lost += max(0.0, (nominal_cap - cur_c) * (spt - cur_t))
                cur_t = spt
                cur_c = sc
            seg_lost += max(0.0, (nominal_cap - cur_c) * (t_next - cur_t))

        running_cumulative_lost += seg_lost

        # Determine active stage label
        if active_cap >= 0.95 * nominal_cap:
            stage_str = "NOMINAL_OPS" if h < req.trigger_hour else "RESTORED_OPS"
        elif active_cap < 0.50 * nominal_cap:
            stage_str = "STAGE_2_PROPAGATION"
        else:
            stage_str = "STAGE_1_TRIGGER"

        hourly_capacity.append(
            HourlyCapacityPoint(
                hour=h,
                time_label=f"T+{h:02d}:00",
                baseline_capacity=nominal_cap,
                unmitigated_capacity=round(max(0.0, active_cap * 0.75), 1),
                technical_only_capacity=round(max(0.0, active_cap * 0.88), 1),
                tripartite_mitigated_capacity=round(active_cap, 1),
                active_stage=stage_str,
                estimated_lost_capacity_cumulative=int(round(running_cumulative_lost)),
                delayed_flights_cumulative=int(round(running_cumulative_lost)),
            )
        )

    # --- Sustained Recovery Detection ---
    threshold_fraction = req.recovery_threshold_pct / 100.0
    threshold_cap = round(nominal_cap * threshold_fraction, 2)
    sustained_dur = float(req.recovery_sustained_hours)

    recovered = False
    recovery_time: Optional[float] = None
    is_censored = True

    # Check if capacity ever dropped below threshold
    ever_degraded = any(c < threshold_cap for _, c in timeline_changes)

    if not ever_degraded:
        # Never degraded: nominal throughout
        recovered = True
        recovery_time = 0.0
        is_censored = False
    else:
        # Earliest time capacity dropped below threshold
        t_first_degraded = next(t for t, c in timeline_changes if c < threshold_cap)

        # Scan piecewise intervals for the earliest crossing back to >= threshold sustained for sustained_dur
        for idx in range(len(timeline_changes)):
            t_cand, cap_cand = timeline_changes[idx]
            if t_cand >= t_first_degraded and cap_cand >= threshold_cap and (t_cand + sustained_dur) <= req.horizon_hours:
                # Verify that all intervals up to t_cand + sustained_dur remain >= threshold_cap
                sustained = True
                for t_sub, c_sub in timeline_changes:
                    if t_cand <= t_sub < (t_cand + sustained_dur):
                        if c_sub < threshold_cap:
                            sustained = False
                            break
                if sustained:
                    recovered = True
                    recovery_time = round(t_cand, 2)
                    is_censored = False
                    break

    recovery_metrics = RecoveryMetrics(
        recovered=recovered,
        recovery_time_hours=recovery_time,
        threshold_capacity=threshold_cap,
        sustained_duration_hours=sustained_dur,
        is_censored=is_censored,
        censored_reason="Capacity did not sustain threshold before horizon" if is_censored else None,
    )

    # Summary KPIs
    min_observed_cap = min(c for _, c in timeline_changes)
    mean_raw = float(np.mean([n.fmea.raw_rpn for n in req.nodes]))
    mean_adj = float(np.mean([compute_residual_rpn(n) for n in req.nodes]))
    avg_tech = float(np.mean([n.tripartite.technical for n in req.nodes]))
    avg_formal = float(np.mean([n.tripartite.formal for n in req.nodes]))
    avg_informal = float(np.mean([n.tripartite.informal for n in req.nodes]))
    avg_ctrl = round((avg_tech + avg_formal + avg_informal) / 3.0, 1)

    top_chokepoint = max(node_analytics, key=lambda x: x.chokepoint_index) if node_analytics else None

    # EASA Part-IS Exercise Notification Draft
    statutory_regs = [
        "Commission Delegated Regulation (EU) 2022/1645 (Part-IS.D)",
        "Commission Implementing Regulation (EU) 2023/203 (Part-IS.I, including IS.I.OR.230)",
    ]
    voluntary_stds = [
        "EUROCAE ED-202A / ER-040 Information Security Management Guidelines (Voluntary Guidance)",
    ]

    stage1_nodes = [n for n in req.nodes if n.stage == CascadeStage.STAGE_1_TRIGGER]
    stage2_nodes = [n for n in req.nodes if n.stage == CascadeStage.STAGE_2_PROPAGATION]
    stage3_nodes = [n for n in req.nodes if n.stage == CascadeStage.STAGE_3_BLOCKER]

    easa_report = EASAPartISNotification(
        report_id=f"EASA-PART-IS-{req.scenario_id.upper()}-2026-EXERCISE-DRAFT",
        regulation_basis=statutory_regs + voluntary_stds,
        statutory_regulations=statutory_regs,
        voluntary_standards=voluntary_stds,
        reporting_entity="Remote Tower Centre (RTC) Multi-Aerodrome Operations Authority",
        initial_notification_deadline_hours=72,
        incident_classification="Significant Aviation Information Security Incident — Air Navigation Services (ANS)",
        er040_risk_class="Illustrative 5x5 Class II (Hazardous — Model Benchmark)" if mean_adj > 45 else "Illustrative 5x5 Class III (Major — Model Benchmark)",
        affected_assets=[f"{n.code} — {n.label}" for n in req.nodes],
        stage_1_technical_root_cause=stage1_nodes[0].failure_mode if stage1_nodes else "Unauthorized telemetry/sensor injection",
        stage_2_operational_propagation="; ".join(f"{n.code}: {n.failure_mode}" for n in stage2_nodes) if stage2_nodes else "None",
        stage_3_governance_recovery_blocker="; ".join(f"{n.code}: {n.failure_mode}" for n in stage3_nodes) if stage3_nodes else "None",
        psoe_maturity_summary={
            "Technical Controls": to_psoe_maturity(avg_tech),
            "Formal Controls (Part-IS SOPs)": to_psoe_maturity(avg_formal),
            "Informal Controls (ATCO Trust & Culture)": to_psoe_maturity(avg_informal),
        },
        containment_actions=[
            "Proposed Action: Isolate compromised sensor feeds via hardware cryptographic bus arbitration (Technical Control).",
            "Proposed Action: Invoke EASA Part-IS.D.OR.220 contingency reversion SOP with pre-authorized LVP separation buffers (Formal Control).",
            "Proposed Action: Activate cross-team ATCO-engineer out-of-band voice verification protocol (Informal Control).",
        ],
        structural_remediations=[
            "Proposed Action: Transition Stage 3 recovery blockers on the PSOE maturity scale via joint cyber-ATC tabletop exercises.",
            "Proposed Action: Rebalance cybersecurity investment toward Formal SLA handoffs and Informal ATCO cognitive calibration.",
        ],
        is_exercise_draft=True,
        reporting_applicability="Not assessed (Subject to (EU) 2023/203 Art. 2 scope)",
        awareness_time="Not assessed (To be logged by operational incident team)",
        official_guidance_url="https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-information-security?erules-id=ERULES-1963177438-19981",
    )

    run_id = str(uuid.uuid4())
    input_hash = compute_input_hash(req)

    provenance = ResultProvenance(
        engine="fastapi-python",
        engine_label="Python 3.12 (SimPy + NetworkX)",
        model_version="2.0.0-causal",
        schema_version="2.0.0",
        input_revision=req.input_revision,
        generated_at=datetime.now(timezone.utc).isoformat(),
        is_fallback=False,
    )

    return SimulationResponse(
        scenario_id=req.scenario_id,
        model_version="2.0.0-causal",
        schema_version="2.0.0",
        run_id=run_id,
        input_hash=input_hash,
        parameter_set_version="2026.1",
        random_seed=req.random_seed,
        summary_kpis={
            "mean_raw_rpn": round(mean_raw, 1),
            "mean_residual_rpn": round(mean_adj, 1),
            "mean_adjusted_risk": round(mean_adj, 1),
            "min_hourly_capacity": round(min_observed_cap, 1),
            "capacity_retention_pct": round((min_observed_cap / nominal_cap) * 100.0, 1),
            "recovery_window_hours": recovery_time if recovery_time is not None else float(req.horizon_hours),
            "total_disrupted_movements": lost_capacity_integral,
            "estimated_lost_movement_capacity": lost_capacity_integral,
            "average_control_score": avg_ctrl,
            "tripartite_balance_index": avg_ctrl,
            "top_chokepoint_code": top_chokepoint.node_code if top_chokepoint else "N/A",
            "top_chokepoint_score": top_chokepoint.chokepoint_index if top_chokepoint else 0.0,
            "is_censored": is_censored,
        },
        events=events,
        hourly_capacity=hourly_capacity,
        node_analytics=node_analytics,
        easa_notification=easa_report,
        recovery_metrics=recovery_metrics,
        provenance=provenance,
        input_snapshot=req.model_dump(),
    )
