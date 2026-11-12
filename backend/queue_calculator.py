"""
AeroCascade — Pure Airport Movement Queue & Flight-Hour Delay Engine
Authoritative fluid-flow FIFO queue integration over documented time steps:
- Tracks cumulative demand, capacity, and carried-forward backlog (movements).
- Continuous-rate piecewise-linear queue drainage within each interval.
- Integrates backlog Q(t) over elapsed time to compute modeled flight-hours of delay.
- Validates time grid, units, finite non-negative inputs, and initial backlog.
- Reports within-horizon modeled delay flight-hours and terminal backlog separately.
"""

from __future__ import annotations
import math
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class QueueCalculatorError(ValueError):
    """Raised when queue inputs violate bounds or validation invariants."""
    pass


class QueueStepDetail(BaseModel):
    step_index: int
    start_hour: float
    end_hour: float
    duration_hours: float
    demand_movements: float
    capacity_movements: float
    start_backlog_movements: float
    served_movements: float
    end_backlog_movements: float
    drain_fraction: float
    step_delay_flight_hours: float
    cumulative_delay_flight_hours: float


class QueueSimulationOutput(BaseModel):
    time_grid_hours: List[float]
    steps: List[QueueStepDetail]
    total_demand_movements: float
    total_capacity_movements: float
    total_served_movements: float
    initial_backlog_movements: float
    terminal_backlog_movements: float
    peak_backlog_movements: float
    total_delay_flight_hours: float
    drain_hour: Optional[float] = None


def validate_queue_input(
    time_grid_hours: List[float],
    demand: List[float],
    capacity: List[float],
    initial_backlog: float = 0.0,
) -> None:
    if not isinstance(time_grid_hours, (list, tuple)) or len(time_grid_hours) < 2:
        raise QueueCalculatorError("time_grid_hours must be a list of at least 2 time points.")

    for i, t in enumerate(time_grid_hours):
        if not isinstance(t, (int, float)) or math.isnan(t) or math.isinf(t):
            raise QueueCalculatorError(f"time_grid_hours[{i}] must be a finite number. Received: {t}")
        if t < 0:
            raise QueueCalculatorError(f"time_grid_hours[{i}] cannot be negative. Received: {t}")
        if i > 0 and t <= time_grid_hours[i - 1]:
            raise QueueCalculatorError(
                f"time_grid_hours must be strictly monotonically increasing. Point {i} ({t}) <= point {i-1} ({time_grid_hours[i-1]})."
            )

    expected_steps = len(time_grid_hours) - 1

    if not isinstance(initial_backlog, (int, float)) or math.isnan(initial_backlog) or math.isinf(initial_backlog) or initial_backlog < 0:
        raise QueueCalculatorError(f"initial_backlog must be a finite non-negative number. Received: {initial_backlog}")

    if not isinstance(demand, (list, tuple)) or len(demand) != expected_steps:
        raise QueueCalculatorError(f"demand length ({len(demand)}) must equal time steps ({expected_steps}).")

    for i, d in enumerate(demand):
        if not isinstance(d, (int, float)) or math.isnan(d) or math.isinf(d) or d < 0:
            raise QueueCalculatorError(f"demand[{i}] must be a finite non-negative number. Received: {d}")

    if not isinstance(capacity, (list, tuple)) or len(capacity) != expected_steps:
        raise QueueCalculatorError(f"capacity length ({len(capacity)}) must equal time steps ({expected_steps}).")

    for i, c in enumerate(capacity):
        if not isinstance(c, (int, float)) or math.isnan(c) or math.isinf(c) or c < 0:
            raise QueueCalculatorError(f"capacity[{i}] must be a finite non-negative number. Received: {c}")


def calculate_queue_delay(
    time_grid_hours: List[float],
    demand: List[float],
    capacity: List[float],
    initial_backlog: float = 0.0,
) -> QueueSimulationOutput:
    validate_queue_input(time_grid_hours, demand, capacity, initial_backlog)

    num_steps = len(time_grid_hours) - 1
    steps: List[QueueStepDetail] = []
    current_backlog = float(initial_backlog)
    cumulative_delay = 0.0
    total_demand = 0.0
    total_capacity = 0.0
    total_served = 0.0
    peak_backlog = float(initial_backlog)
    drain_hour: Optional[float] = None
    had_backlog = initial_backlog > 0

    for i in range(num_steps):
        t_start = float(time_grid_hours[i])
        t_end = float(time_grid_hours[i + 1])
        dt = t_end - t_start
        d = float(demand[i])
        c = float(capacity[i])

        total_demand += d
        total_capacity += c

        start_q = current_backlog
        total_req = start_q + d
        served = min(total_req, c)
        end_q = max(0.0, total_req - served)

        total_served += served
        if start_q > 0 or end_q > 0:
            had_backlog = True
        if end_q > peak_backlog:
            peak_backlog = end_q

        # Exact continuous piecewise-linear integration
        if total_req >= c:
            step_delay = ((start_q + end_q) / 2.0) * dt
            drain_frac = 1.0
        elif start_q > 0:
            drain_rate = (c - d) / dt
            time_to_drain = start_q / drain_rate
            drain_frac = max(0.0, min(1.0, time_to_drain / dt))
            step_delay = 0.5 * start_q * time_to_drain
        else:
            step_delay = 0.0
            drain_frac = 0.0

        cumulative_delay += step_delay

        if had_backlog and end_q == 0.0 and drain_hour is None:
            drain_hour = t_start + dt * drain_frac

        steps.append(
            QueueStepDetail(
                step_index=i,
                start_hour=t_start,
                end_hour=t_end,
                duration_hours=dt,
                demand_movements=d,
                capacity_movements=c,
                start_backlog_movements=start_q,
                served_movements=served,
                end_backlog_movements=end_q,
                drain_fraction=drain_frac,
                step_delay_flight_hours=step_delay,
                cumulative_delay_flight_hours=cumulative_delay,
            )
        )
        current_backlog = end_q

    return QueueSimulationOutput(
        time_grid_hours=[float(t) for t in time_grid_hours],
        steps=steps,
        total_demand_movements=total_demand,
        total_capacity_movements=total_capacity,
        total_served_movements=total_served,
        initial_backlog_movements=float(initial_backlog),
        terminal_backlog_movements=current_backlog,
        peak_backlog_movements=peak_backlog,
        total_delay_flight_hours=cumulative_delay,
        drain_hour=drain_hour,
    )
