"""
Unit tests for AeroCascade Queue Calculator & Flight-Hour Delay Engine (Python Parity Suite)
Verifies:
1. Hand-worked queue fixture
2. Zero delay when demand is fully served
3. Backlog drainage when spare capacity returns
4. Terminal backlog remaining visible
5. Input bounds and validation checks
"""

import math
import unittest
from backend.queue_calculator import (
    calculate_queue_delay,
    QueueCalculatorError,
)


class TestQueueCalculator(unittest.TestCase):
    def test_acceptance_1_hand_worked_fixture(self):
        """Hand-worked queue fixture: [10, 10, 10] demand, [4, 14, 14] capacity yields exactly 7.5 flight-hours."""
        out = calculate_queue_delay(
            time_grid_hours=[0, 1, 2, 3],
            demand=[10, 10, 10],
            capacity=[4, 14, 14],
            initial_backlog=0,
        )

        self.assertEqual(len(out.steps), 3)
        self.assertEqual(out.steps[0].start_backlog_movements, 0)
        self.assertEqual(out.steps[0].end_backlog_movements, 6)
        self.assertEqual(out.steps[0].step_delay_flight_hours, 3.0)

        self.assertEqual(out.steps[1].start_backlog_movements, 6)
        self.assertEqual(out.steps[1].end_backlog_movements, 2)
        self.assertEqual(out.steps[1].step_delay_flight_hours, 4.0)

        self.assertEqual(out.steps[2].start_backlog_movements, 2)
        self.assertEqual(out.steps[2].end_backlog_movements, 0)
        self.assertEqual(out.steps[2].step_delay_flight_hours, 0.5)

        self.assertEqual(out.total_delay_flight_hours, 7.5)
        self.assertEqual(out.terminal_backlog_movements, 0.0)
        self.assertEqual(out.drain_hour, 2.5)
        self.assertEqual(out.peak_backlog_movements, 6.0)

    def test_acceptance_2_zero_delay_when_served(self):
        """Zero delay when capacity matches or exceeds demand."""
        out = calculate_queue_delay(
            time_grid_hours=[0, 1, 2, 3],
            demand=[48, 48, 48],
            capacity=[48, 50, 52],
            initial_backlog=0,
        )

        self.assertEqual(out.total_delay_flight_hours, 0.0)
        self.assertEqual(out.terminal_backlog_movements, 0.0)
        self.assertEqual(out.peak_backlog_movements, 0.0)
        for s in out.steps:
            self.assertEqual(s.step_delay_flight_hours, 0.0)
            self.assertEqual(s.end_backlog_movements, 0.0)

    def test_acceptance_3_backlog_drains(self):
        """Backlog drains when spare capacity returns and delay stops accumulating."""
        out = calculate_queue_delay(
            time_grid_hours=[0, 1, 2, 3, 4],
            demand=[20, 20, 20, 20],
            capacity=[10, 30, 20, 20],
            initial_backlog=0,
        )

        self.assertEqual(out.steps[0].end_backlog_movements, 10.0)
        self.assertEqual(out.steps[1].end_backlog_movements, 0.0)
        self.assertEqual(out.steps[2].end_backlog_movements, 0.0)
        self.assertEqual(out.steps[3].end_backlog_movements, 0.0)

        self.assertEqual(out.steps[0].step_delay_flight_hours, 5.0)
        self.assertEqual(out.steps[1].step_delay_flight_hours, 5.0)
        self.assertEqual(out.steps[2].step_delay_flight_hours, 0.0)
        self.assertEqual(out.steps[3].step_delay_flight_hours, 0.0)
        self.assertEqual(out.total_delay_flight_hours, 10.0)
        self.assertEqual(out.terminal_backlog_movements, 0.0)

    def test_acceptance_4_terminal_backlog_visible(self):
        """Terminal backlog remains visible when capacity deficit persists."""
        out = calculate_queue_delay(
            time_grid_hours=[0, 1, 2, 3],
            demand=[10, 10, 10],
            capacity=[4, 4, 4],
            initial_backlog=0,
        )

        self.assertEqual(out.terminal_backlog_movements, 18.0)
        self.assertEqual(out.total_delay_flight_hours, 27.0)
        self.assertEqual(out.peak_backlog_movements, 18.0)
        self.assertIsNone(out.drain_hour)

    def test_validation_errors(self):
        """Input validation rejects non-monotonic grids, negative values, and non-finite numbers."""
        # Non-monotonic grid
        with self.assertRaises(QueueCalculatorError):
            calculate_queue_delay([0, 2, 1], [1, 1], [1, 1])

        # Negative initial backlog
        with self.assertRaises(QueueCalculatorError):
            calculate_queue_delay([0, 1], [1], [1], initial_backlog=-5)

        # Mismatched length
        with self.assertRaises(QueueCalculatorError):
            calculate_queue_delay([0, 1, 2], [1], [1, 1])

        # Negative demand
        with self.assertRaises(QueueCalculatorError):
            calculate_queue_delay([0, 1], [-1], [1])

        # NaN / Infinity
        with self.assertRaises(QueueCalculatorError):
            calculate_queue_delay([0, float("nan")], [1], [1])


if __name__ == "__main__":
    unittest.main()
