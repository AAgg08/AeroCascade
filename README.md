# AeroCascade: Remote Tower Cybersecurity & Cascading Failure Simulator

AeroCascade is an interactive research console and discrete-event simulation (DES) testbed for evaluating cybersecurity-induced cascading operational disruptions and airport throughput recovery trajectories in multi-aerodrome Remote Tower Centres (RTC).

The framework models cascading failure propagation across three stages:

$$\text{Stage 1: Cyber/Technical Ingress} \longrightarrow \text{Stage 2: Operational Fragility Propagation} \longrightarrow \text{Stage 3: Governance \& Human Recovery Blockers}$$

The console pairs an interactive browser workspace with an authoritative Python discrete-event causal simulation engine, evaluating technical, formal, and informal policy configurations alongside an illustrative EASA Part-IS exercise dossier.

---

## Architecture Overview

- **Frontend (`/src`)**: Single-page application built with React 19, Vite 8, Tailwind CSS, Lucide icons, React Flow (interactive directed dependency graph), and Recharts (FMEA risk and capacity curves).
- **Backend (`/backend`)**: Python application using FastAPI, Pydantic v2 schemas, NetworkX directed graphs, and a SimPy discrete-event simulation engine supporting deterministic baselines and stochastic Monte Carlo replicates.
- **Analytical & Governance Frameworks**: Dhillon & Moores (2001) Tripartite Governance Controls (Technical, Formal, Informal), failure mode and effects analysis (FMEA) risk priority numbers (RPN), and an illustrative EASA Part-IS (EU 2022/1645 & 2023/203 Art. IS.I.OR.230) incident exercise reporting draft.

---

## Prerequisites

- **Node.js**: v22.12+ LTS or v24 LTS
- **npm**: v10.x or higher
- **Python**: v3.12 or higher

---

## Verified Quickstart Setup

Both servers are launched from the **repository root**.

### 1. Backend Server Setup (FastAPI + SimPy)

In your first terminal, from the repository root:

```bash
# Create and activate Python virtual environment
python3 -m venv .venv
source .venv/bin/activate    # On Windows: .venv\Scripts\activate

# Install dependencies from repository root
python -m pip install -r backend/requirements.txt

# Start the authoritative FastAPI simulation engine
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Verify backend health by checking the `/api/health` endpoint:

```bash
curl -s http://127.0.0.1:8000/api/health
```

Expected response: `{"status":"ok","engine":"AeroCascade FastAPI + SimPy + NetworkX (Authoritative Causal Engine)",...}`.

### 2. Frontend Development Server Setup (React 19 + Vite 8)

In a second terminal, from the repository root:

```bash
# Clean install exact project dependencies
npm ci

# Start the Vite development server (listens on port 3000)
npm run dev
```

Open `http://localhost:3000` in your browser to access the AeroCascade research console.

---

## Automated Verification & Test Suites

Run both test suites from the **repository root**:

```bash
# Frontend static typing check (0 errors)
npx tsc --noEmit

# Frontend unit and store concurrency test suite (20 tests)
npm test

# Backend Python SimPy engine and schema test suite (23 tests)
python -m unittest discover -s backend/tests

# Production asset bundle build
npm run build
```

---

## 3-Minute AIAA Demo Script

This script demonstrates an end-to-end evaluation using **Scenario I: Optical Panorama & A-SMGCS Sensor Desynchronization**.

### Minute 1: Scenario Context & Directed Topology

1. **Load the Workspace**: Open `http://localhost:3000`. The console loads into the **Topology & DES** tab (`#topology`).
2. **Review Selected Scenario**:
   - Ensure **Scenario I: Optical Panorama & A-SMGCS Sensor Desynchronization** is selected in the scenario dropdown.
   - Note the aerodrome profile: Dual-Runway Regional Hub + 2 Satellite Remote Aerodromes (nominal demand: 48 movements/hour; incident trigger: $T+04:00$).
3. **Inspect the Three-Stage Directed Graph**:
   - **Stage 1 (Cyber/Technical Ingress)**: Sensors such as `S1-OPT-01` (PTZ optical camera array) and `S1-SUR-02` (A-SMGCS surveillance).
   - **Stage 2 (Fragility Propagation)**: Hub chokepoints including `S2-OTW-01` (visual panorama/AR fusion) and `S2-RTM-02` (multi-aerodrome sector split).
   - **Stage 3 (Recovery Blockers)**: Organizational and human constraints including `S3-FRM-01` (formal contingency SOP authority) and `S3-INF-02` (controller reversion trust).
4. **Distinguish Client Preview vs. Authoritative Run**:
   - The initial telemetry displayed on load is an instantaneous **Browser Preview** (labeled `Client Preview`), providing rapid local feedback.
   - Click **Run Simulation** to execute the authoritative Python SimPy causal engine. The provenance badge updates to `FastAPI + SimPy (Authoritative)`, and the headline KPI card displays the measured minimum capacity and sustained recovery window for the active inputs.

### Minute 2: FMEA Analysis & Monte Carlo Stochastic Spread

1. **Open Analytics**: Click the **Activity** icon in the sidebar (or navigate to `#fmea-capacity`).
2. **Chart 01 (FMEA RPN vs. Policy Investment)**:
   - Illustrates the governance gap: high technical policy investment in Stage 1 ingress points does not automatically mitigate residual risks associated with Stage 3 organizational recovery blockers.
3. **Chart 02 (Capacity Recovery Trajectory)**:
   - Displays the nominal baseline (48 movements/hr) and the red marker at trigger hour $T+04:00$.
   - Shows the active tripartite trajectory alongside counterfactual policy baselines (`Technical-Only Bias` and `Unmitigated Stress`).
4. **Run Monte Carlo (30 Replicates)**:
   - Click the purple **Run Monte Carlo (30 Reps)** button.
   - The SimPy backend executes 30 stochastic runs, sampling repair durations from log-normal distributions and propagation delays from uniform distributions.
5. **Interpret the Stochastic Spread**:
   - **Shaded 5th–95th Percentile Band**: Illustrates the empirical spread of simulated capacity outcomes resulting from stochastic variance in repair durations and propagation delays across the 30 replicates.
   - **Solid Cyan Curve**: Displays the 50th percentile (median) capacity trajectory across all runs.

### Minute 3: Policy Calibration, Stale State Detection & Exercise Dossier Export

1. **Apply Policy Preset**:
   - In the policy presets bar, select **Tripartite Balanced** (which increases formal and informal governance controls across nodes).
2. **Verify Stale State Retention**:
   - Note the appearance of the amber **Stale Result Banner** and `Stale (Rev #1)` badge.
   - AeroCascade intentionally preserves the previous run's measured outputs and capacity denominator (`/ 48`) so unsubmitted edits cannot be mistaken for completed simulation results.
3. **Rerun Simulation**:
   - Click **Run Simulation to Update** (or **Run Monte Carlo (30 Reps)**).
   - The backend simulates the adjusted policy settings.
   - *Measured Scenario I Example (simulated results)*: Both policies reached 12/48 movements/hour minimum capacity. `Scenario Baseline` reached sustained recovery at $T+21.22\text{ h}$ and lost an estimated 619.92 movements of capacity, versus $T+15.88\text{ h}$ and 427.68 movements under `Tripartite Balanced`.
4. **Inspect the EASA Part-IS Exercise Dossier UI**:
   - Navigate to the **Part-IS Dossier** tab (`#easa-compliance`).
   - Review the exercise draft notification layout (`EASA-PART-IS-RTC-OPTICAL-ASMGCS-SPOOF-2026-EXERCISE-DRAFT`), which presents the three-stage reporting cards (Immediate Notification, 72-Hour Initial Report, and Post-Investigation Follow-Up), an illustrative 5×5 screening matrix, and PSOE (*Present, Suitable, Operational, Effective*) maturity progression chips.
5. **Export Exercise Draft Deliverables**:
   - Click **Export Exercise JSON**: Downloads the structured simulation run artifact, including configuration parameters, KPIs, and risk registers.
   - Click **Print Exercise Dossier**: Opens a clean, print-formatted layout of the exercise draft suitable for archival or offline review.

---

## Simulation Reproducibility

AeroCascade is designed for deterministic and stochastic experiment reproducibility:

- **Deterministic Runs (`replicates: 1`)**: Replaying a simulation requires the same engine version, scenario inputs, baseline demand, and trigger parameters to produce identical discrete-event execution sequences and hourly capacity metrics. Run-specific metadata such as the run ID and timestamp can differ.
- **Monte Carlo Runs (`replicates > 1`)**: Stochastic sampling uses a configurable random seed (`random_seed: int = 2026` by default in `backend/models.py`). Replaying stochastic outcomes requires matching the engine version, scenario inputs, replicate count, and seed. Run-specific metadata such as run IDs can differ while statistical percentile bands and capacity distributions remain identical.

---

## Scenario Catalog

| Scenario ID | Title | Aerodrome Profile | Baseline Demand | Trigger |
| :--- | :--- | :--- | :--- | :--- |
| `rtc-optical-asmgcs-spoof` | **Scenario I: Optical Panorama & A-SMGCS Sensor Desynchronization** | Dual-Runway Hub + 2 Satellite Aerodromes | 48 mvmt/hr | T+04:00 |
| `swim-amhs-flight-object-lockout` | **Scenario II: SWIM Flight Object & AMHS Integrity Cascade** | High-Density Remote Tower Hub | 60 mvmt/hr | T+03:00 |
| `c2-sdwan-agl-plc-blackout` | **Scenario III: SD-WAN C2 Link Hijack & AGL PLC Fault** | Low-Visibility CAT III Remote Aerodrome | 36 mvmt/hr | T+05:00 |

---

## Policy Presets Reference

The console includes four policy presets for comparative analysis:

1. **Scenario Baseline** (`baseline`): The unadjusted default policy distribution defined in the scenario model.
2. **Technical-Only Bias** (`technical-heavy`): High investment in technical detection (88%), while formal procedures (32%) and informal human factors (28%) remain under-resourced.
3. **Tripartite Balanced** (`tripartite-balanced`): Balanced tripartite control allocation (82%–86%) across technical, formal, and informal mechanisms.
4. **Unmitigated Stress** (`unmitigated-stress`): Degraded control posture across all three dimensions (18%–25%) modeling worst-case resilience deficit.

---

## Attribution

This simulator operationalizes the conceptual framework, tripartite governance controls, and qualitative failure models introduced in:

> Aryan Aggarwal and Gurpreet Dhillon, **“Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations,”** AIAA Aviation 2026 Forum.
