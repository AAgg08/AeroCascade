"""
AeroCascade — Acceptance Fixtures Test Suite (Prompt 2)
Verifies all 9 causal simulation and graph invariants:
1. No initiating event: no failure and zero lost capacity.
2. A->B, C disconnected: failure at A can affect B but not C.
3. A->B with propagation delay: delaying it changes B's event time and capacity interval.
4. Primary plus backup redundancy: one failed source does not interrupt service after failover; loss of both does.
5. Repair complete but authorization unavailable: service stays degraded until authorization arrives.
6. Two repairs and one technician: queueing differs from two technicians.
7. Direct A->C bypass with equal-weight A->B->C: B has zero shortest-path betweenness.
8. No event at/after horizon; unrecovered run is censored; lost-capacity integral matches hand-computed fixture.
9. Response contract provenance, run ID, and input snapshot hash consistency.
"""

import sys
from pathlib import Path

# Ensure project root is in sys.path regardless of working directory
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

import unittest
from backend.graph_engine import build_dependency_graph
from backend.models import (
    AirportService,
    CascadeStage,
    ControlCategory,
    DependencyEdgeModel,
    ER040Severity,
    FMEAMetrics,
    InitiatingEvent,
    NodeState,
    PSOELevel,
    RedundancyGroupConfig,
    SimulationRequest,
    SystemNodeModel,
    TripartiteControls,
)
from backend.simpy_engine import compute_input_hash, run_cascade_simulation


def make_test_node(
    node_id: str,
    code: str,
    stage: CascadeStage = CascadeStage.STAGE_1_TRIGGER,
    repair_hours: float = 2.0,
    requires_auth: bool = False,
    auth_delay_hours: float = 0.0,
    redundancy_group: str = None,
    is_primary: bool = True,
    failover_delay_hours: float = 0.05,
    impact: int = 5,
) -> SystemNodeModel:
    return SystemNodeModel(
        id=node_id,
        code=code,
        label=f"Test Node {code}",
        subsystem="Surveillance",
        stage=stage,
        dominant_control=ControlCategory.TECHNICAL,
        description=f"Description for {code}",
        failure_mode=f"Failure mode for {code}",
        tripartite=TripartiteControls(technical=50.0, formal=50.0, informal=50.0),
        fmea=FMEAMetrics(likelihood=3, impact=impact, recovery_complexity=3, policy_investment=50.0),
        psoe_status=PSOELevel.SUITABLE,
        er040_severity=ER040Severity.HAZARDOUS_2,
        base_latency_minutes=15.0,
        repair_duration_hours=repair_hours,
        requires_authorization=requires_auth,
        authorization_delay_hours=auth_delay_hours,
        required_technicians=1,
        redundancy_group=redundancy_group,
        is_primary=is_primary,
    )


class TestAeroCascadeAcceptanceFixtures(unittest.TestCase):

    def test_fixture_1_no_initiating_event(self):
        """Fixture 1: No initiating event yields no failure and zero lost capacity."""
        node_a = make_test_node("n-a", "A")
        node_b = make_test_node("n-b", "B")

        req = SimulationRequest(
            scenario_id="fixture-1",
            horizon_hours=24,
            baseline_movements_per_hour=48,
            trigger_hour=0,
            nodes=[node_a, node_b],
            edges=[],
            initiating_events=[],  # Explicitly empty
        )

        res = run_cascade_simulation(req)
        self.assertEqual(len(res.events), 0, "No events should occur when initiating_events is empty")
        self.assertEqual(
            res.summary_kpis["estimated_lost_movement_capacity"], 0.0,
            "Lost capacity must be exactly 0.0 without initiating events"
        )
        self.assertTrue(res.recovery_metrics.recovered)
        self.assertEqual(res.recovery_metrics.recovery_time_hours, 0.0)
        self.assertFalse(res.recovery_metrics.is_censored)
        for pt in res.hourly_capacity:
            self.assertEqual(pt.tripartite_mitigated_capacity, 48.0)

    def test_fixture_2_disconnected_node_unaffected(self):
        """Fixture 2: A->B, C disconnected: failure at A can affect B but not C."""
        node_a = make_test_node("n-a", "A", CascadeStage.STAGE_1_TRIGGER)
        node_b = make_test_node("n-b", "B", CascadeStage.STAGE_2_PROPAGATION)
        node_c = make_test_node("n-c", "C", CascadeStage.STAGE_2_PROPAGATION)

        edge_ab = DependencyEdgeModel(
            id="e-ab",
            source="n-a",
            target="n-b",
            coupling_weight=0.8,
            propagation_delay_hours=0.5,
            propagation_mechanism="Message queue cascade",
            protocol_layer="Application",
            distance_weight=1.0,
        )

        req = SimulationRequest(
            scenario_id="fixture-2",
            horizon_hours=12,
            baseline_movements_per_hour=48,
            trigger_hour=1,
            nodes=[node_a, node_b, node_c],
            edges=[edge_ab],
            initiating_events=[
                InitiatingEvent(node_id="n-a", event_time_hours=1.0, failure_mode="Sensor spoofing")
            ],
        )

        res = run_cascade_simulation(req)
        failed_node_ids = {e.node_id for e in res.events if e.state_to == NodeState.FAILED.value}

        self.assertIn("n-a", failed_node_ids, "Initiating node A must fail")
        self.assertIn("n-b", failed_node_ids, "Dependent node B must fail via propagation")
        self.assertNotIn("n-c", failed_node_ids, "Disconnected node C must remain completely unaffected")

    def test_fixture_3_propagation_delay_effect(self):
        """Fixture 3: A->B with propagation delay: delaying it changes B's event time and capacity interval."""
        node_a = make_test_node("n-a", "A", CascadeStage.STAGE_1_TRIGGER)
        node_b = make_test_node("n-b", "B", CascadeStage.STAGE_2_PROPAGATION)

        # Run 1: 0.5 hour propagation delay
        edge_fast = DependencyEdgeModel(
            id="e-ab-fast",
            source="n-a",
            target="n-b",
            coupling_weight=0.8,
            propagation_delay_hours=0.5,
            propagation_mechanism="Direct network link",
            protocol_layer="Transport",
            distance_weight=1.0,
        )
        req1 = SimulationRequest(
            scenario_id="fixture-3-fast",
            horizon_hours=12,
            baseline_movements_per_hour=48,
            trigger_hour=1,
            nodes=[node_a, node_b],
            edges=[edge_fast],
            initiating_events=[InitiatingEvent(node_id="n-a", event_time_hours=1.0)],
        )
        res1 = run_cascade_simulation(req1)
        b_fail_evt1 = next(e for e in res1.events if e.node_id == "n-b" and e.state_to == NodeState.FAILED.value)

        # Run 2: 2.5 hour propagation delay
        edge_slow = DependencyEdgeModel(
            id="e-ab-slow",
            source="n-a",
            target="n-b",
            coupling_weight=0.8,
            propagation_delay_hours=2.5,
            propagation_mechanism="Delayed batch sync",
            protocol_layer="Application",
            distance_weight=1.0,
        )
        req2 = SimulationRequest(
            scenario_id="fixture-3-slow",
            horizon_hours=12,
            baseline_movements_per_hour=48,
            trigger_hour=1,
            nodes=[node_a, node_b],
            edges=[edge_slow],
            initiating_events=[InitiatingEvent(node_id="n-a", event_time_hours=1.0)],
        )
        res2 = run_cascade_simulation(req2)
        b_fail_evt2 = next(e for e in res2.events if e.node_id == "n-b" and e.state_to == NodeState.FAILED.value)

        self.assertAlmostEqual(b_fail_evt1.timestamp_hours, 1.5, places=2)
        self.assertAlmostEqual(b_fail_evt2.timestamp_hours, 3.5, places=2)
        self.assertGreater(b_fail_evt2.timestamp_hours, b_fail_evt1.timestamp_hours)

    def test_fixture_4_primary_backup_redundancy(self):
        """Fixture 4: Primary plus backup redundancy: one failed source does not interrupt service after failover; loss of both does."""
        node_pri = make_test_node("n-pri", "PRI", redundancy_group="rg-pwr", is_primary=True, repair_hours=6.0)
        node_bak = make_test_node("n-bak", "BAK", redundancy_group="rg-pwr", is_primary=False, repair_hours=6.0)

        svc = AirportService(
            service_id="svc-pwr",
            name="Power Distribution Service",
            required_node_ids=["n-pri", "n-bak"],
            redundancy_group_id="rg-pwr",
            degraded_availability_factor=0.0,
        )
        rg_config = RedundancyGroupConfig(
            group_id="rg-pwr",
            primary_node_id="n-pri",
            backup_node_ids=["n-bak"],
            failover_delay_hours=0.1,
            degraded_capacity_factor=0.9,
        )

        # Case 4a: Only primary fails at t=1.0
        req_single = SimulationRequest(
            scenario_id="fixture-4-single",
            horizon_hours=12,
            baseline_movements_per_hour=48,
            trigger_hour=1,
            nodes=[node_pri, node_bak],
            edges=[],
            services=[svc],
            redundancy_groups=[rg_config],
            initiating_events=[InitiatingEvent(node_id="n-pri", event_time_hours=1.0)],
        )
        res_single = run_cascade_simulation(req_single)
        # Service should remain available at 90% (43.2 movements) because backup is functional
        min_cap_single = res_single.summary_kpis["min_hourly_capacity"]
        self.assertGreaterEqual(min_cap_single, 43.0, "Service must not collapse when only primary fails")

        # Case 4b: Both primary and backup fail (primary at 1.0, backup at 1.5)
        req_both = SimulationRequest(
            scenario_id="fixture-4-both",
            horizon_hours=12,
            baseline_movements_per_hour=48,
            trigger_hour=1,
            nodes=[node_pri, node_bak],
            edges=[],
            services=[svc],
            redundancy_groups=[rg_config],
            initiating_events=[
                InitiatingEvent(node_id="n-pri", event_time_hours=1.0),
                InitiatingEvent(node_id="n-bak", event_time_hours=1.5),
            ],
        )
        res_both = run_cascade_simulation(req_both)
        min_cap_both = res_both.summary_kpis["min_hourly_capacity"]
        self.assertEqual(min_cap_both, 0.0, "Service must drop to 0.0 when both primary and backup fail")

    def test_fixture_5_repair_complete_authorization_unavailable(self):
        """Fixture 5: Repair complete but authorization unavailable: service stays degraded until authorization arrives."""
        node = make_test_node(
            "n-auth",
            "AUTH",
            repair_hours=1.0,
            requires_auth=True,
            auth_delay_hours=3.0,
        )
        svc = AirportService(
            service_id="svc-auth",
            name="Supervised Service",
            required_node_ids=["n-auth"],
            degraded_availability_factor=0.2,
        )

        req = SimulationRequest(
            scenario_id="fixture-5",
            horizon_hours=12,
            baseline_movements_per_hour=50,
            trigger_hour=1,
            nodes=[node],
            edges=[],
            services=[svc],
            initiating_events=[InitiatingEvent(node_id="n-auth", event_time_hours=1.0)],
        )
        res = run_cascade_simulation(req)

        # Technical repair completes at 1.0 + 1.0 = 2.0h
        # Authorization delay lasts until 2.0 + 3.0 = 5.0h
        auth_evt = next((e for e in res.events if e.state_to == NodeState.AWAITING_AUTHORIZATION.value), None)
        rec_evt = next((e for e in res.events if e.state_to == NodeState.RECOVERED.value), None)

        self.assertIsNotNone(auth_evt, "Node must enter AWAITING_AUTHORIZATION state")
        self.assertAlmostEqual(auth_evt.timestamp_hours, 2.0, places=2)
        self.assertIsNotNone(rec_evt, "Node must eventually enter RECOVERED state")
        self.assertAlmostEqual(rec_evt.timestamp_hours, 5.0, places=2)

        # Check capacity at T+03:00 (between repair complete and authorization): still degraded!
        h3_cap = res.hourly_capacity[3].tripartite_mitigated_capacity
        self.assertLess(h3_cap, 40.0, "Service must remain degraded at T+03:00 while awaiting authorization")
        # Check capacity at T+06:00 (after authorization): restored!
        h6_cap = res.hourly_capacity[6].tripartite_mitigated_capacity
        self.assertEqual(h6_cap, 50.0, "Service must be fully restored at T+06:00")

    def test_fixture_6_technician_queueing_resource_constraint(self):
        """Fixture 6: Two repairs and one technician: queueing differs from two technicians."""
        node_1 = make_test_node("n-1", "N1", repair_hours=2.0)
        node_2 = make_test_node("n-2", "N2", repair_hours=2.0)

        # Case 6a: 1 Technician (sequential repair queueing)
        req_1tech = SimulationRequest(
            scenario_id="fixture-6-1tech",
            horizon_hours=12,
            baseline_movements_per_hour=48,
            trigger_hour=1,
            num_technicians=1,
            nodes=[node_1, node_2],
            edges=[],
            initiating_events=[
                InitiatingEvent(node_id="n-1", event_time_hours=1.0),
                InitiatingEvent(node_id="n-2", event_time_hours=1.0),
            ],
        )
        res_1tech = run_cascade_simulation(req_1tech)
        lost_1tech = res_1tech.summary_kpis["estimated_lost_movement_capacity"]
        rec_1tech_events = [e for e in res_1tech.events if e.state_to == NodeState.RECOVERED.value]
        finish_times_1tech = sorted([e.timestamp_hours for e in rec_1tech_events])

        # Case 6b: 2 Technicians (concurrent repair)
        req_2tech = SimulationRequest(
            scenario_id="fixture-6-2tech",
            horizon_hours=12,
            baseline_movements_per_hour=48,
            trigger_hour=1,
            num_technicians=2,
            nodes=[node_1, node_2],
            edges=[],
            initiating_events=[
                InitiatingEvent(node_id="n-1", event_time_hours=1.0),
                InitiatingEvent(node_id="n-2", event_time_hours=1.0),
            ],
        )
        res_2tech = run_cascade_simulation(req_2tech)
        lost_2tech = res_2tech.summary_kpis["estimated_lost_movement_capacity"]
        rec_2tech_events = [e for e in res_2tech.events if e.state_to == NodeState.RECOVERED.value]
        finish_times_2tech = sorted([e.timestamp_hours for e in rec_2tech_events])

        # With 1 technician: first finishes at 3.0 (1+2), second finishes at 5.0 (3+2)
        self.assertAlmostEqual(finish_times_1tech[0], 3.0, places=2)
        self.assertAlmostEqual(finish_times_1tech[1], 5.0, places=2)

        # With 2 technicians: both finish concurrently at 3.0 (1+2)
        self.assertAlmostEqual(finish_times_2tech[0], 3.0, places=2)
        self.assertAlmostEqual(finish_times_2tech[1], 3.0, places=2)

        # Total lost capacity is strictly greater with 1 technician due to queueing
        self.assertGreater(lost_1tech, lost_2tech)

    def test_fixture_7_direct_bypass_betweenness_zero(self):
        """Fixture 7: Direct A->C bypass with equal-weight A->B->C: B has zero shortest-path betweenness."""
        node_a = make_test_node("n-a", "A")
        node_b = make_test_node("n-b", "B")
        node_c = make_test_node("n-c", "C")

        # Equal distance weight = 1.0 on all edges
        edges = [
            DependencyEdgeModel(id="e-ac", source="n-a", target="n-c", coupling_weight=0.8, distance_weight=1.0, propagation_mechanism="direct", protocol_layer="L3"),
            DependencyEdgeModel(id="e-ab", source="n-a", target="n-b", coupling_weight=0.8, distance_weight=1.0, propagation_mechanism="hop1", protocol_layer="L3"),
            DependencyEdgeModel(id="e-bc", source="n-b", target="n-c", coupling_weight=0.8, distance_weight=1.0, propagation_mechanism="hop2", protocol_layer="L3"),
        ]

        G, analytics = build_dependency_graph([node_a, node_b, node_c], edges)
        b_metric = next(m for m in analytics if m.node_id == "n-b")

        # Because distance(A->C) = 1.0 < distance(A->B->C) = 2.0, the shortest path bypasses B
        self.assertEqual(
            b_metric.betweenness_centrality, 0.0,
            "Node B must have exactly 0.0 betweenness centrality when bypassed by a shorter direct edge"
        )

    def test_fixture_8_horizon_censoring_and_piecewise_integral(self):
        """Fixture 8: No event at/after horizon; unrecovered run is censored; lost-capacity matches piecewise hand calculation."""
        # Hand-computed piecewise fixture:
        # Nominal capacity: 48 mvmt/hr.
        # Node fails at t = 2.0. Service availability drops to 24.0 mvmt/hr.
        # Node repairs at t = 5.0 (duration 3.0h). Service returns to 48.0 mvmt/hr.
        # Horizon = 10.0h.
        # Expected lost capacity = (48 - 24) * (5.0 - 2.0) = 24 * 3.0 = 72.0 movements.
        node = make_test_node("n-piecewise", "PW", repair_hours=3.0)
        svc = AirportService(
            service_id="svc-pw",
            name="Piecewise Service",
            required_node_ids=["n-piecewise"],
            degraded_availability_factor=0.5,
        )
        req = SimulationRequest(
            scenario_id="fixture-8-integral",
            horizon_hours=10,
            baseline_movements_per_hour=48,
            trigger_hour=2,
            nodes=[node],
            edges=[],
            services=[svc],
            initiating_events=[InitiatingEvent(node_id="n-piecewise", event_time_hours=2.0)],
        )
        res = run_cascade_simulation(req)

        self.assertAlmostEqual(
            res.summary_kpis["estimated_lost_movement_capacity"], 72.0, places=1,
            msg="Lost capacity integral must match hand-computed piecewise fixture of 72.0 movements"
        )
        self.assertTrue(res.recovery_metrics.recovered)
        self.assertFalse(res.recovery_metrics.is_censored)
        self.assertAlmostEqual(res.recovery_metrics.recovery_time_hours, 5.0, places=1)

        # Unrecovered and censored run check:
        # Repair requires 15.0h, but horizon is only 10.0h.
        node_unrec = make_test_node("n-unrec", "UNREC", repair_hours=15.0)
        req_unrec = SimulationRequest(
            scenario_id="fixture-8-unrecovered",
            horizon_hours=10,
            baseline_movements_per_hour=48,
            trigger_hour=1,
            nodes=[node_unrec],
            edges=[],
            initiating_events=[InitiatingEvent(node_id="n-unrec", event_time_hours=1.0)],
        )
        res_unrec = run_cascade_simulation(req_unrec)

        self.assertFalse(res_unrec.recovery_metrics.recovered, "Run should be marked unrecovered")
        self.assertTrue(res_unrec.recovery_metrics.is_censored, "Run should be marked censored")
        self.assertIsNone(res_unrec.recovery_metrics.recovery_time_hours, "Recovery time must be None when censored")
        # Ensure no events are logged at or after horizon
        for evt in res_unrec.events:
            self.assertLess(evt.timestamp_hours, 10.0, f"Event {evt.event_id} occurred at/after horizon: {evt.timestamp_hours}")

    def test_fixture_9_response_contract_provenance_and_hash(self):
        """Fixture 9: Response contract includes run ID, deterministic input snapshot hash, and provenance."""
        node = make_test_node("n-meta", "META")
        req = SimulationRequest(
            scenario_id="fixture-9",
            horizon_hours=12,
            baseline_movements_per_hour=48,
            trigger_hour=2,
            nodes=[node],
            edges=[],
            initiating_events=[InitiatingEvent(node_id="n-meta", event_time_hours=2.0)],
        )
        res = run_cascade_simulation(req)

        self.assertTrue(res.run_id, "Result must have a unique run_id")
        self.assertEqual(res.model_version, "2.0.0-causal")
        self.assertEqual(res.schema_version, "2.0.0")
        self.assertEqual(res.provenance.engine, "fastapi-python")
        self.assertFalse(res.provenance.is_fallback)

        expected_hash = compute_input_hash(req)
        self.assertEqual(res.input_hash, expected_hash, "input_hash must match SHA256 of request payload")
        self.assertIsNotNone(res.input_snapshot, "Response must include complete input snapshot")

    def test_validation_rejects_malformed_inputs(self):
        """Input validation rejects empty nodes, duplicate IDs, dangling edges, and invalid horizons."""
        # Empty nodes
        with self.assertRaises(ValueError):
            run_cascade_simulation(SimulationRequest(scenario_id="err", nodes=[]))

        # Duplicate node IDs
        node1 = make_test_node("dup-id", "D1")
        node2 = make_test_node("dup-id", "D2")
        with self.assertRaises(ValueError):
            run_cascade_simulation(SimulationRequest(scenario_id="err", nodes=[node1, node2]))

        # Dangling edge
        node_single = make_test_node("valid-node", "V1")
        dangling_edge = DependencyEdgeModel(
            id="dangling", source="valid-node", target="non-existent",
            coupling_weight=0.5, propagation_mechanism="none", protocol_layer="none"
        )
        with self.assertRaises(ValueError):
            run_cascade_simulation(SimulationRequest(scenario_id="err", nodes=[node_single], edges=[dangling_edge]))

        # Invalid trigger time >= horizon
        with self.assertRaises(ValueError):
            run_cascade_simulation(
                SimulationRequest(scenario_id="err", horizon_hours=10, trigger_hour=10, nodes=[node_single])
            )

    def test_fixture_10_deterministic_replicates_1_matches_baseline(self):
        """Prompt 3 Verification: Deterministic run (replicates=1) matches baseline exactly."""
        node = make_test_node("n-det", "DET", repair_hours=3.0)
        svc = AirportService(
            service_id="svc-det",
            name="Deterministic Service",
            required_node_ids=["n-det"],
            degraded_availability_factor=0.5,
        )
        req_default = SimulationRequest(
            scenario_id="fixture-10-default",
            horizon_hours=10,
            baseline_movements_per_hour=48,
            trigger_hour=2,
            nodes=[node],
            edges=[],
            services=[svc],
            initiating_events=[InitiatingEvent(node_id="n-det", event_time_hours=2.0)],
        )
        req_explicit_1 = SimulationRequest(
            scenario_id="fixture-10-explicit-1",
            horizon_hours=10,
            baseline_movements_per_hour=48,
            trigger_hour=2,
            replicates=1,
            nodes=[node],
            edges=[],
            services=[svc],
            initiating_events=[InitiatingEvent(node_id="n-det", event_time_hours=2.0)],
        )

        res_default = run_cascade_simulation(req_default)
        res_explicit = run_cascade_simulation(req_explicit_1)

        # Baseline metrics match hand-computed piecewise integral (72.0 mvmt)
        self.assertEqual(res_default.replicates, 1)
        self.assertEqual(res_explicit.replicates, 1)
        self.assertAlmostEqual(res_default.summary_kpis["estimated_lost_movement_capacity"], 72.0, places=1)
        self.assertAlmostEqual(res_explicit.summary_kpis["estimated_lost_movement_capacity"], 72.0, places=1)

        # Hourly capacities match identically between default and explicit replicates=1
        for h in range(10):
            self.assertEqual(
                res_default.hourly_capacity[h].tripartite_mitigated_capacity,
                res_explicit.hourly_capacity[h].tripartite_mitigated_capacity,
            )

    def test_fixture_11_stochastic_replicates_30_confidence_bands(self):
        """Prompt 3 Verification: Stochastic run (replicates=30) calculates valid 5th/95th percentile confidence bands."""
        node_a = make_test_node("n-stoch-a", "STA", CascadeStage.STAGE_1_TRIGGER, repair_hours=2.0)
        node_b = make_test_node("n-stoch-b", "STB", CascadeStage.STAGE_2_PROPAGATION, repair_hours=3.0)
        edge = DependencyEdgeModel(
            id="e-sta-stb",
            source="n-stoch-a",
            target="n-stoch-b",
            coupling_weight=0.8,
            propagation_delay_hours=1.0,
            propagation_mechanism="Sensor feed telemetry",
            protocol_layer="Application",
            distance_weight=1.0,
        )
        svc = AirportService(
            service_id="svc-stoch",
            name="Stochastic Multi-Node Service",
            required_node_ids=["n-stoch-a", "n-stoch-b"],
            degraded_availability_factor=0.25,
        )
        req_stoch = SimulationRequest(
            scenario_id="fixture-11-stoch-30",
            horizon_hours=16,
            baseline_movements_per_hour=48,
            trigger_hour=2,
            random_seed=2026,
            replicates=30,
            nodes=[node_a, node_b],
            edges=[edge],
            services=[svc],
            initiating_events=[InitiatingEvent(node_id="n-stoch-a", event_time_hours=2.0)],
        )

        res = run_cascade_simulation(req_stoch)

        # Check response metadata
        self.assertEqual(res.replicates, 30)
        self.assertIsNotNone(res.stochastic_capacity)
        self.assertEqual(len(res.stochastic_capacity), 16)
        self.assertIsNotNone(res.capacity_median)
        self.assertIsNotNone(res.capacity_5th)
        self.assertIsNotNone(res.capacity_95th)
        self.assertEqual(len(res.capacity_median), 16)
        self.assertEqual(len(res.capacity_5th), 16)
        self.assertEqual(len(res.capacity_95th), 16)

        # Invariant checks for each time step
        has_variance = False
        for h in range(16):
            pt = res.stochastic_capacity[h]
            p5 = pt.capacity_5th
            p50 = pt.capacity_median
            p95 = pt.capacity_95th

            # 5th percentile <= Median (50th) <= 95th percentile
            self.assertLessEqual(p5, p50 + 1e-4, f"Hour {h}: 5th percentile ({p5}) exceeds median ({p50})")
            self.assertLessEqual(p50, p95 + 1e-4, f"Hour {h}: Median ({p50}) exceeds 95th percentile ({p95})")

            # All capacity values must be within valid physical limits [0, baseline]
            self.assertGreaterEqual(p5, 0.0)
            self.assertLessEqual(p95, 48.0 + 1e-4)

            # Check hourly_capacity points also contain the percentiles
            self.assertEqual(res.hourly_capacity[h].capacity_5th, p5)
            self.assertEqual(res.hourly_capacity[h].capacity_median, p50)
            self.assertEqual(res.hourly_capacity[h].capacity_95th, p95)

            # Check if there is non-zero variance around recovery hours
            if p95 > p5:
                has_variance = True

        self.assertTrue(has_variance, "Monte Carlo replicates must exhibit variance across recovery timeline")

        # Reproducibility check: same seed produces identical results
        res_reproduced = run_cascade_simulation(req_stoch)
        self.assertEqual(res.capacity_median, res_reproduced.capacity_median)
        self.assertEqual(res.capacity_5th, res_reproduced.capacity_5th)
        self.assertEqual(res.capacity_95th, res_reproduced.capacity_95th)

    def request(self, **changes):
        node = make_test_node("a", "A", stage=CascadeStage.STAGE_1_TRIGGER)
        args = dict(
            scenario_id="initial-conditions",
            nodes=[node],
            edges=[],
            horizon_hours=8,
            trigger_hour=4,
            baseline_movements_per_hour=40,
        )
        args.update(changes)
        return SimulationRequest(**args)

    def test_explicit_empty_events_do_not_trigger_default_faults(self):
        result = run_cascade_simulation(self.request(initiating_events=[]))
        self.assertEqual(result.events, [])
        self.assertEqual(result.summary_kpis["estimated_lost_movement_capacity"], 0)
        self.assertTrue(all(p.tripartite_mitigated_capacity == 40 for p in result.hourly_capacity))

    def test_omitted_events_do_not_trigger_default_faults(self):
        self.assertEqual(run_cascade_simulation(self.request()).events, [])

    def test_explicit_event_at_zero_still_runs(self):
        result = run_cascade_simulation(
            self.request(initiating_events=[InitiatingEvent(node_id="a", event_time_hours=0)])
        )
        self.assertEqual(result.events[0].timestamp_hours, 0)
        self.assertGreater(result.summary_kpis["estimated_lost_movement_capacity"], 0)

    def test_staffing_applies_from_start_without_faults(self):
        result = run_cascade_simulation(self.request(staffed_operation_fraction=0.5))
        self.assertEqual(result.events, [])
        self.assertEqual(result.summary_kpis["estimated_lost_movement_capacity"], 160)
        self.assertEqual(result.hourly_capacity[-1].estimated_lost_capacity_cumulative, 160)
        self.assertTrue(all(p.tripartite_mitigated_capacity == 20 for p in result.hourly_capacity))
        self.assertTrue(result.recovery_metrics.is_censored)
        self.assertIsNone(result.recovery_metrics.recovery_time_hours)

    def test_invalid_service_references_are_rejected(self):
        for ids in ([], ["missing"]):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                run_cascade_simulation(
                    self.request(services=[AirportService(service_id="svc", name="Test", required_node_ids=ids)])
                )

    def test_policy_comparison_identical_before_trigger_and_in_fault_free(self):
        """Bug 3: Policy comparison curves (unmitigated, technical-only) must be identical pre-trigger and in fault-free runs."""
        # 1. Fault-free run
        res_ff = run_cascade_simulation(self.request(initiating_events=[]))
        for p in res_ff.hourly_capacity:
            self.assertEqual(p.tripartite_mitigated_capacity, 40.0)
            self.assertEqual(p.unmitigated_capacity, 40.0)
            self.assertEqual(p.technical_only_capacity, 40.0)

        # 2. Incident starting at hour 4
        res_inc = run_cascade_simulation(
            self.request(initiating_events=[InitiatingEvent(node_id="a", event_time_hours=4.0)])
        )
        # Pre-incident hours (0, 1, 2, 3) must be identical across all curves
        for h in range(4):
            pt = res_inc.hourly_capacity[h]
            self.assertEqual(pt.tripartite_mitigated_capacity, 40.0)
            self.assertEqual(pt.unmitigated_capacity, 40.0)
            self.assertEqual(pt.technical_only_capacity, 40.0)

        # Post-incident hour 4 has capacity drop
        self.assertLess(res_inc.hourly_capacity[4].tripartite_mitigated_capacity, 40.0)


if __name__ == "__main__":
    unittest.main()
