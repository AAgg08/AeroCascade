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


if __name__ == "__main__":
    unittest.main()
