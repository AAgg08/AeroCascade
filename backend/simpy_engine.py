"""
AeroCascade — SimPy Discrete-Event Simulation (DES) & NumPy Capacity Degradation Engine
Models Three-Stage Cascading Failures in Remote Tower Operations (Aggarwal & Dhillon, AIAA Aviation 2026):
  Stage 1 (Trigger) -> Stage 2 (Operational Fragility Propagation) -> Stage 3 (Recovery Blocker: Formal/Informal Deficit)
"""

from __future__ import annotations
from typing import List
import numpy as np
import simpy
from .graph_engine import build_dependency_graph, compute_residual_rpn
from .models import (
    CascadeStage,
    DiscreteEventRecord,
    EASAPartISNotification,
    HourlyCapacityPoint,
    SimulationRequest,
    SimulationResponse,
    SystemNodeModel,
)


def format_sim_time(hours_float: float) -> str:
    total_minutes = int(round(hours_float * 60))
    hh = (total_minutes // 60) % 24
    mm = total_minutes % 60
    return f"T+{hh:02d}:{mm:02d}Z"


def run_cascade_simulation(req: SimulationRequest) -> SimulationResponse:
    rng = np.random.default_rng(req.random_seed)
    G, node_analytics = build_dependency_graph(req.nodes, req.edges)
    node_map = {n.id: n for n in req.nodes}

    env = simpy.Environment()
    events: List[DiscreteEventRecord] = []

    stage1_nodes = [n for n in req.nodes if n.stage == CascadeStage.STAGE_1_TRIGGER]
    stage2_nodes = [n for n in req.nodes if n.stage == CascadeStage.STAGE_2_PROPAGATION]
    stage3_nodes = [n for n in req.nodes if n.stage == CascadeStage.STAGE_3_BLOCKER]

    def cascade_process(env: simpy.Environment):
        # Wait until initial trigger hour
        yield env.timeout(float(req.trigger_hour))

        # Stage 1: Cyber-Physical Trigger Activation
        for idx, s1 in enumerate(stage1_nodes):
            res_rpn = compute_residual_rpn(s1)
            tech_damping = s1.tripartite.technical / 100.0
            delay_offset = round(0.15 * idx + float(rng.uniform(0.02, 0.12)), 2)
            yield env.timeout(delay_offset)

            cap_drop = round(max(8.0, (res_rpn / 125.0) * 32.0 * (1.0 - 0.45 * tech_damping)), 1)
            events.append(
                DiscreteEventRecord(
                    event_id=f"EVT-S1-{idx+1:02d}",
                    timestamp_hours=round(env.now, 2),
                    formatted_time=format_sim_time(env.now),
                    stage=CascadeStage.STAGE_1_TRIGGER,
                    node_id=s1.id,
                    node_code=s1.code,
                    node_label=s1.label,
                    dominant_control=s1.dominant_control,
                    event_type="INITIAL_VECTOR_BREACH",
                    narrative=f"{s1.failure_mode} breached technical perimeter (Tech Control={s1.tripartite.technical:.0f}%).",
                    capacity_impact_pct=cap_drop,
                    residual_rpn=res_rpn,
                )
            )

        # Stage 2: Operational Fragility Propagation Domain
        for idx, s2 in enumerate(stage2_nodes):
            res_rpn = compute_residual_rpn(s2)
            prop_delay = round((s2.base_latency_minutes / 60.0) * (0.7 + 0.3 * (s2.tripartite.technical / 100.0)), 2)
            yield env.timeout(prop_delay)

            cap_drop = round(max(14.0, (res_rpn / 125.0) * 58.0), 1)
            events.append(
                DiscreteEventRecord(
                    event_id=f"EVT-S2-{idx+1:02d}",
                    timestamp_hours=round(env.now, 2),
                    formatted_time=format_sim_time(env.now),
                    stage=CascadeStage.STAGE_2_PROPAGATION,
                    node_id=s2.id,
                    node_code=s2.code,
                    node_label=s2.label,
                    dominant_control=s2.dominant_control,
                    event_type="OPERATIONAL_CASCADE_PROPAGATION",
                    narrative=f"Cascade propagated to {s2.label}: {s2.failure_mode}. Separation buffers widened.",
                    capacity_impact_pct=cap_drop,
                    residual_rpn=res_rpn,
                )
            )

        # Stage 3: Formal & Informal Control Deficit (Recovery Blockers)
        for idx, s3 in enumerate(stage3_nodes):
            res_rpn = compute_residual_rpn(s3)
            formal_informal_avg = 0.5 * (s3.tripartite.formal + s3.tripartite.informal)
            stall_duration_hrs = round(max(0.45, (100.0 - formal_informal_avg) / 28.0), 2)
            yield env.timeout(stall_duration_hrs)

            cap_drop = round(max(18.0, (res_rpn / 125.0) * 72.0 * (1.0 - formal_informal_avg / 140.0)), 1)
            events.append(
                DiscreteEventRecord(
                    event_id=f"EVT-S3-{idx+1:02d}",
                    timestamp_hours=round(env.now, 2),
                    formatted_time=format_sim_time(env.now),
                    stage=CascadeStage.STAGE_3_BLOCKER,
                    node_id=s3.id,
                    node_code=s3.code,
                    node_label=s3.label,
                    dominant_control=s3.dominant_control,
                    event_type="RECOVERY_GOVERNANCE_STALL",
                    narrative=(
                        f"Recovery stalled by {s3.dominant_control.value} deficit at {s3.label}: "
                        f"{s3.failure_mode} (Formal={s3.tripartite.formal:.0f}%, Informal={s3.tripartite.informal:.0f}%)."
                    ),
                    capacity_impact_pct=cap_drop,
                    residual_rpn=res_rpn,
                )
            )

    env.process(cascade_process(env))
    env.run(until=float(req.horizon_hours))

    # Compute aggregate Tripartite scores across stages
    avg_tech = float(np.mean([n.tripartite.technical for n in req.nodes]))
    avg_formal = float(np.mean([n.tripartite.formal for n in req.nodes]))
    avg_informal = float(np.mean([n.tripartite.informal for n in req.nodes]))
    mean_residual_rpn = float(np.mean([compute_residual_rpn(n) for n in req.nodes]))

    # Generate 24-hour capacity curves comparing:
    # 1. Unmitigated Cascade (Low controls, protracted Stage 3 stall)
    # 2. Technical-Only Mitigation (High Technical=85%, but weak Formal/Informal=35% -> still suffers Stage 3 recovery plateau)
    # 3. Current Tripartite Configuration (Reflects live user sliders across Technical, Formal, Informal)
    hourly_capacity: List[HourlyCapacityPoint] = []
    cumulative_delayed = 0
    t0 = req.trigger_hour

    # Recovery rate is strongly governed by Stage 3 Formal + Informal controls
    tripartite_recovery_rate = 0.08 + 0.24 * ((0.5 * avg_formal + 0.5 * avg_informal) / 100.0)
    shock_depth_tripartite = min(0.82, max(0.18, (mean_residual_rpn / 100.0) * (1.0 - 0.35 * (avg_tech / 100.0))))

    for h in range(req.horizon_hours):
        base = float(req.baseline_movements_per_hour)
        if h < t0:
            unmit = base
            tech_only = base
            tripartite_cap = base
            stage_label = "NOMINAL_OPS"
        else:
            dt = h - t0
            # Unmitigated: steep drop to 22% capacity, sluggish recovery due to Stage 3 governance paralysis
            if dt <= 2:
                unmit_factor = 1.0 - 0.38 * (dt + 1)
            elif dt <= 9:
                unmit_factor = 0.22 + 0.02 * (dt - 2)
            else:
                unmit_factor = min(0.88, 0.36 + 0.045 * (dt - 9))

            # Technical-Only: smaller initial drop (to 48%), but plateaus for hours 3..10 because Formal/Informal controls are unaddressed
            if dt <= 2:
                tech_factor = 1.0 - 0.25 * (dt + 1)
            elif dt <= 8:
                tech_factor = 0.48 + 0.015 * (dt - 2)
            else:
                tech_factor = min(0.94, 0.57 + 0.045 * (dt - 8))

            # Tripartite user-configured trajectory
            if dt == 0:
                tri_factor = 1.0 - shock_depth_tripartite * 0.45
                stage_label = "STAGE_1_TRIGGER"
            elif dt <= 2:
                tri_factor = 1.0 - shock_depth_tripartite * (0.75 + 0.12 * dt)
                stage_label = "STAGE_2_PROPAGATION"
            else:
                recovery_progress = 1.0 - float(np.exp(-tripartite_recovery_rate * (dt - 2)))
                tri_factor = (1.0 - shock_depth_tripartite) + shock_depth_tripartite * recovery_progress
                stage_label = "STAGE_3_RECOVERY" if tri_factor < 0.92 else "RESTORED_OPS"

            unmit = round(max(4.0, base * unmit_factor), 1)
            tech_only = round(max(8.0, base * tech_factor), 1)
            tripartite_cap = round(min(base, max(6.0, base * tri_factor)), 1)
            cumulative_delayed += max(0, int(round(base - tripartite_cap)))

        hourly_capacity.append(
            HourlyCapacityPoint(
                hour=h,
                time_label=f"{h:02d}:00Z",
                baseline_capacity=base,
                unmitigated_capacity=unmit,
                technical_only_capacity=tech_only,
                tripartite_mitigated_capacity=tripartite_cap,
                active_stage=stage_label,
                delayed_flights_cumulative=cumulative_delayed,
            )
        )

    min_cap = min(p.tripartite_mitigated_capacity for p in hourly_capacity)
    recovery_hours = sum(
        1 for p in hourly_capacity if p.hour >= t0 and p.tripartite_mitigated_capacity < 0.90 * req.baseline_movements_per_hour
    )

    easa_report = EASAPartISNotification(
        report_id=f"EASA-PART-IS-{req.scenario_id.upper()}-2026",
        regulation_basis=[
            "Commission Delegated Regulation (EU) 2022/1645 (Part-IS.D.OR.230)",
            "Commission Implementing Regulation (EU) 2023/203 (Part-IS.I.OR.230)",
            "EUROCAE ED-202A / ER-040 Airworthiness & Operational Safety-Risk Process",
        ],
        reporting_entity="Remote Tower Centre (RTC) Multi-Aerodrome Operations Authority",
        initial_notification_deadline_hours=72,
        incident_classification="Significant Aviation Information Security Incident — Air Navigation Services (ANS)",
        er040_risk_class="Class II Hazardous / Conditional Operational Degradation" if mean_residual_rpn > 42 else "Class III Major / Contained Operational Perturbation",
        affected_assets=[f"{n.code} — {n.label}" for n in req.nodes],
        stage_1_technical_root_cause=(
            stage1_nodes[0].failure_mode if stage1_nodes else "Unauthorized telemetry/sensor injection on RTC ingress link"
        ),
        stage_2_operational_propagation=(
            "; ".join(f"{n.code}: {n.failure_mode}" for n in stage2_nodes)
        ),
        stage_3_governance_recovery_blocker=(
            "; ".join(f"{n.code} ({n.dominant_control.value}): {n.failure_mode}" for n in stage3_nodes)
        ),
        psoe_maturity_summary={
            "Technical Controls": "EFFECTIVE" if avg_tech >= 75 else ("OPERATIONAL" if avg_tech >= 55 else "SUITABLE"),
            "Formal Controls (Part-IS SOPs)": "EFFECTIVE" if avg_formal >= 75 else ("OPERATIONAL" if avg_formal >= 55 else "PRESENT"),
            "Informal Controls (ATCO Trust & Culture)": "EFFECTIVE" if avg_informal >= 75 else ("OPERATIONAL" if avg_informal >= 55 else "PRESENT"),
        },
        containment_actions=[
            "Isolate compromised optical/C2 sensor feeds via hardware cryptographic bus arbitration (Technical Control).",
            "Invoke EASA Part-IS.D.OR.220 contingency reversion SOP with pre-authorized LVP separation buffers (Formal Control).",
            "Activate cross-team ATCO-engineer out-of-band voice verification protocol to eliminate alert-fatigue hesitation (Informal Control).",
        ],
        structural_remediations=[
            "Transition Stage 3 recovery blockers from PRESENT/SUITABLE to EFFECTIVE on the PSOE maturity scale via joint cyber-ATC tabletop exercises.",
            "Rebalance cybersecurity capital expenditure from pure Technical perimeter tools toward Formal SLA handoffs and Informal ATCO cognitive calibration.",
        ],
    )

    return SimulationResponse(
        scenario_id=req.scenario_id,
        summary_kpis={
            "mean_raw_rpn": round(float(np.mean([n.fmea.raw_rpn for n in req.nodes])), 1),
            "mean_residual_rpn": round(mean_residual_rpn, 1),
            "min_hourly_capacity": round(min_cap, 1),
            "capacity_retention_pct": round((min_cap / req.baseline_movements_per_hour) * 100.0, 1),
            "recovery_window_hours": float(recovery_hours),
            "total_disrupted_movements": float(cumulative_delayed),
            "tripartite_balance_index": round((avg_tech + avg_formal + avg_informal) / 3.0, 1),
        },
        events=events,
        hourly_capacity=hourly_capacity,
        node_analytics=node_analytics,
        easa_notification=easa_report,
    )
