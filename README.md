# AeroCascade: Remote Tower Cybersecurity & Cascading Failure Simulator

[![AIAA Aviation 2026](https://img.shields.io/badge/AIAA%20Aviation-2026-blue.svg)](https://www.aiaa.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python: 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/)
[![React: 18](https://img.shields.io/badge/react-18-cyan.svg)](https://react.dev/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)

AeroCascade is an interactive research console and discrete-event simulation (DES) testbed for modeling cybersecurity-induced cascading operational failure and capacity collapse in multi-aerodrome Remote Tower Centres (RTC).

The framework accompanies the paper **"Modernizing Aviation Infrastructure: Cybersecurity Challenges in the Era of Remote Tower Operations"** (Aggarwal & Dhillon, AIAA Aviation 2026 Forum). It operationalizes the paper's three-stage failure propagation taxonomy:

$$\text{Stage 1: Cyber/Technical Ingress} \longrightarrow \text{Stage 2: Operational Fragility Propagation} \longrightarrow \text{Stage 3: Governance & Human Recovery Blockers}$$

---

## Architecture Overview

- **Frontend (`/src`)**: React 18, TypeScript, Tailwind CSS, Lucide icons, React Flow (topological directed dependency graph), Recharts (FMEA RPN and capacity degradation curves), and react-to-print.
- **Backend (`/backend`)**: Python 3.12+ FastAPI application with Pydantic v2 schemas, NetworkX directed graphs, and a SimPy discrete-event simulation engine with stochastic Monte Carlo replicates.
- **Regulatory Mapping**: EASA Part-IS (Commission Delegated Regulation (EU) 2022/1645 & Implementing Regulation (EU) 2023/203 Art. IS.I.OR.230), EUROCAE ER-040 / ED-202A, and Dhillon & Moores (2001) Tripartite Governance Controls (Technical, Formal, Informal).

---

## Prerequisites

- **Node.js**: v20.x or higher
- **npm**: v10.x or higher
- **Python**: v3.12 or higher (Python 3.11 is also supported)

---

## Verified Quickstart Setup

Both the FastAPI backend and Express frontend development servers run concurrently.

### 1. Backend Server Setup (FastAPI + SimPy)

```bash
# Navigate to backend directory
cd backend

# Create and activate Python virtual environment
python3 -m venv .venv
source .venv/bin/activate    # On Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server (listens on port 8000)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Verify backend health by opening `http://localhost:8000/docs` in your browser.

### 2. Frontend Development Server Setup (React + Vite)

In a separate terminal window:

```bash
# From project root
npm install

# Start the Vite development server (listens on port 3000)
npm run dev
```

Open `http://localhost:3000` to access the AeroCascade research console.

---

## Verification & Automated Test Suites

Both the frontend and backend test suites can be verified independently:

```bash
# Run TypeScript compilation check (must report 0 errors)
npx tsc --noEmit

# Run Frontend unit & store concurrency tests (20 tests)
npm test

# Run Backend SimPy engine & Pydantic schema tests (23 tests)
cd backend && python -m unittest discover -s tests

# Verify production bundle build
npm run build
```

---

## 3-Minute AIAA Demo Script

This script walks an evaluator or conference attendee through a complete end-to-end simulation using **Scenario I: Optical Panorama & A-SMGCS Sensor Desynchronization**.

### Minute 1: Scenario Context & Topology Inspection

1. **Open the Console**: Navigate to `http://localhost:3000`. The console defaults to the **Topology & DES** tab (`#topology`).
2. **Review the Scenario Selector**: Confirm that **Scenario I: Optical Panorama & A-SMGCS Sensor Desynchronization** is active.
   - *Scenario Profile*: Dual-Runway Regional Hub + 2 Satellite Remote Aerodromes (48 movements/hour nominal demand).
   - *Trigger Timing*: Stage 1 cyber incident begins at elapsed time $T+04:00$.
3. **Inspect the Three-Stage Directed Graph**:
   - **Stage 1 (Red Pills)**: Cyber ingress vectors (`S1-OPT-01` PTZ optical cameras, `S1-SUR-02` A-SMGCS sensor drift, `S1-TIM-03` IEEE 1588 PTP grandmaster clock skew).
   - **Stage 2 (Amber Pills)**: Operational fragility propagation (`S2-OTW-01` visual overlay desynchronization, `S2-RTM-02` multi-aerodrome sector split overload).
   - **Stage 3 (Purple Pills)**: Recovery blockers (`S3-FRM-01` ambiguous EASA Part-IS contingency authority, `S3-INF-02` air traffic controller reversion hesitation and cognitive distrust).
4. **Read the Hero KPI Banner**:
   - Point out the headline throughput retention floor: **29 / 48 movements/hr** (60.2% nominal capacity retained).
   - Review the smooth gradient progress track and the three tripartite sub-metrics (mean adjusted risk, recovery time window, and primary graph chokepoint index).

### Minute 2: FMEA Analysis & Monte Carlo Stochastic Outcomes

1. **Switch to Analytics**: Click the **Activity** icon in the left vertical sidebar (or navigate to `#fmea-capacity`).
2. **Chart 01 (FMEA RPN vs. Policy Investment)**:
   - Highlight the paper's core finding: high technical investment in Stage 1 cyber sensors (green bars) does *not* prevent severe residual risk (pink bars) in Stage 3 recovery blockers.
3. **Chart 02 (Capacity Recovery Trajectory)**:
   - Observe the step-dashed nominal demand baseline (48 mvmt/hr) and the red trigger line at $T+04:00$.
   - Note the deterministic trajectories: the dark dotted unmitigated collapse line versus the solid green active tripartite recovery line.
4. **Trigger Monte Carlo (30 Replicates)**:
   - Click the purple **Run Monte Carlo (30 Reps)** button in the header.
   - The authoritative FastAPI backend executes 30 stochastic runs in SimPy, sampling repair durations from a log-normal distribution and propagation delays from a uniform distribution.
5. **Interpret the Visualizations**:
   - **Browser Preview**: Represents an instantaneous deterministic client-side calculation for rapid parameter exploration before running the authoritative server.
   - **5th–95th Percentile Band (Light Purple Area)**: Shows the empirical spread of simulated capacity outcomes due to stochastic real-world variances (e.g. technician mobilization delays, key re-synchronization latencies, and controller workload spikes).
   - **Solid Cyan Line**: Represents the 50th percentile (median) capacity trajectory across all 30 replicates.

### Minute 3: Policy Calibration, Stale State Detection & Regulatory Dossier Export

1. **Adjust Tripartite Controls**:
   - In the policy preset bar, click **Tripartite Balanced** (or return to `#topology` and adjust the Formal control slider on `S3-FRM-01` upward).
   - Notice the amber **Stale Result Banner**: AeroCascade explicitly flags that inputs have changed (`Rev #2`), while retaining the previous run's results and denominator (`/ 48`) so unsubmitted edits cannot be mistaken for new results.
2. **Rerun with Same Inputs**:
   - Click **Run Simulation to Update**. The backend executes the new policy parameters, clearing the stale banner and showing faster capacity recovery.
3. **Generate the Regulatory Dossier**:
   - Click the **Shield** icon in the sidebar (or navigate to `#easa-compliance`).
   - Review the **EASA Part-IS Mandated Workflow** (IS.I.OR.230): Immediate notification without undue delay, 72-hour initial report, and post-investigation technical follow-up.
   - Review the **Illustrative 5×5 Screening Matrix** and the **PSOE Maturity Progression** levels (*Present, Suitable, Operational, Effective*).
4. **Export Deliverables**:
   - Click **Export Exercise JSON** (`export-json-btn`): Downloads the complete machine-readable simulation snapshot containing run provenance, summary KPIs, graph topology, and risk register.
   - Click **Print Exercise Dossier** (`print-dossier-btn`): Launches the print-ready CSS layout, formatting the incident notification and compliance register into an executive regulatory filing draft.

---

## Scenario Catalog

| ID | Title | Profile | Baseline Demand | Trigger |
| :--- | :--- | :--- | :--- | :--- |
| `rtc-optical-asmgcs-spoof` | **Scenario I: Optical Panorama & A-SMGCS Desync** | Dual-Runway Hub + 2 Satellite Aerodromes | 48 mvmt/hr | T+04:00 |
| `swim-amhs-flight-object-lockout` | **Scenario II: SWIM Flight Object & AMHS Cascade** | High-Density Remote Tower Hub | 60 mvmt/hr | T+03:00 |
| `c2-sdwan-agl-plc-blackout` | **Scenario III: SD-WAN C2 Link & AGL PLC Blackout** | Low-Visibility CAT III Remote Aerodrome | 36 mvmt/hr | T+05:00 |

---

## Citation & Reference

If utilizing this simulation framework or methodology in academic research, please cite:

```bibtex
@inproceedings{aggarwal_dhillon_aiaa2026,
  author    = {Aryan Aggarwal and Balbir S. Dhillon},
  title     = {Modernizing Aviation Infrastructure: Cybersecurity Challenges in the Era of Remote Tower Operations},
  booktitle = {AIAA Aviation 2026 Forum},
  year      = {2026},
  publisher = {American Institute of Aeronautics and Astronautics}
}
```
