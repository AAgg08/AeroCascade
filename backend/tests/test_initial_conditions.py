"""Regressions for explicit fault inputs and initial operational constraints."""
import unittest

from backend.models import AirportService, InitiatingEvent, SimulationRequest
from backend.simpy_engine import run_cascade_simulation
from backend.tests.test_acceptance_fixtures import make_test_node


class TestInitialConditions(unittest.TestCase):
    def request(self, **changes):
        args = dict(scenario_id="initial-conditions", nodes=[make_test_node("a", "A")],
                    horizon_hours=8, trigger_hour=4, baseline_movements_per_hour=40)
        return SimulationRequest(**(args | changes))

    def test_explicit_empty_events_do_not_trigger_default_faults(self):
        result = run_cascade_simulation(self.request(initiating_events=[]))
        self.assertEqual(result.events, [])
        self.assertEqual(result.summary_kpis["estimated_lost_movement_capacity"], 0)
        self.assertTrue(all(p.tripartite_mitigated_capacity == 40 for p in result.hourly_capacity))

    def test_omitted_events_do_not_trigger_default_faults(self):
        self.assertEqual(run_cascade_simulation(self.request()).events, [])

    def test_explicit_event_at_zero_still_runs(self):
        result = run_cascade_simulation(self.request(
            initiating_events=[InitiatingEvent(node_id="a", event_time_hours=0)]))
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
                run_cascade_simulation(self.request(services=[
                    AirportService(service_id="svc", name="Test", required_node_ids=ids)]))
