# AeroCascade — Baseline Architecture & Local Verification Audit

**Project:** AeroCascade — Remote Tower Cybersecurity & Cascading Failure Simulator  
**Paper Reference:** *"Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations"* (Aggarwal & Dhillon, AIAA Aviation 2026)  
**Location:** `/Users/aryanaggarwal/Downloads/aerocascade`  
**Audit Date:** October 2026  
**Auditor:** Antigravity Implementation Engineer  

---

## 1. Executive Summary & Objective

AeroCascade is an interactive discrete-event simulation engine and tripartite cybersecurity risk modeling platform tailored for Remote Tower Operations (RTO / RTC). It models multi-stage cascading failures across technical, formal, and informal operational boundaries, evaluating Failure Mode and Effects Analysis (FMEA) Risk Priority Numbers (RPN), EUROCAE ER-040 safety risk classes, and EASA Part-IS compliance.

The purpose of this baseline audit is to establish and verify a clean, reproducible local development baseline before adding any new features or altering simulation mathematics.

---

## 2. Environment & Runtime Specifications

| Component | Target / Implemented Specification | Notes |
| :--- | :--- | :--- |
| **Operating System** | macOS (Darwin arm64) | Tested on Apple Silicon |
| **Node.js** | `v24.16.0` | Global runtime |
| **npm** | `11.13.0` | Generates `package-lock.json` |
| **Original Lockfile** | `bun.lock` | Present in archive; Bun not installed on host machine |
| **TypeScript** | `7.0.2` (via bun/npm registry) | Strictly checked via `tsc --noEmit` |
| **Vite** | `8.3.5` | Bundler with native ESM |
| **React** | `19.0.1` | Main frontend framework |
| **UI Components** | `@xyflow/react` 12.12.0, `recharts` 3.10.1, `lucide-react` 0.546.0 | DAG visualization & charts |
| **Python** | `3.12.13` (CPython via `uv`) | Isolated in `backend/.venv` (system Python 3.9.6 untouched) |
| **FastAPI / Uvicorn** | `fastapi 0.159.1`, `uvicorn 0.54.0` | Python REST server |
| **Python Sim Libraries**| `networkx 3.7`, `simpy 4.1.2`, `numpy 2.5.4`, `pydantic 2.14.1` | Graph analytics & DES |

---

## 3. Exact Setup & Launch Procedures

### 3.1 Frontend & Express Integration Server

```bash
# Navigate to project root
cd /Users/aryanaggarwal/Downloads/aerocascade

# 1. Align esbuild peer dependency with Vite 8 (pinned ^0.28.0 in package.json)
# 2. Install dependencies
npm install

# 3. Launch dev server (Express server embedding Vite middleware)
npm run dev
# Server listens at http://localhost:3000
```

### 3.2 Python Discrete-Event Simulation Backend

```bash
# Navigate to backend directory
cd /Users/aryanaggarwal/Downloads/aerocascade/backend

# 1. Create Python 3.12 virtual environment
uv venv .venv --python 3.12

# 2. Install required dependencies
uv pip install -r requirements.txt

# 3. Launch FastAPI backend (from project root to maintain module package namespace)
cd /Users/aryanaggarwal/Downloads/aerocascade
backend/.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
# Server listens at http://127.0.0.1:8000 (OpenAPI docs at http://127.0.0.1:8000/docs)
```

---

## 4. Verification Results & Test Suite

### 4.1 Unit Test Execution (`src/domain/simulationEngine.test.ts`)
Executed using Node's native test runner:
```bash
npm test
```
**Results (10 / 10 passed, ~100ms):**
1. `✔ FMEA RPN = Likelihood * Impact * Recovery Complexity`: Verifies formula $RPN = L \times I \times RC$ with bounds $1 \le RPN \le 125$.
2. `✔ Dhillon & Moores Tripartite Controls reduce Stage 3 RPN primarily via Formal & Informal controls`: Verifies that the model's arithmetic damping weighting reduces Stage 3 RPN more under Formal & Informal parameters than Technical parameters alone. *(Note: This reflects an illustrative model assumption, not empirical proof of real-world organizational control effectiveness).*
3. `✔ Chokepoint centrality identifies Stage 2 propagation hubs with positive betweenness`: Verifies that the TypeScript Brandes shortest-path betweenness implementation returns positive betweenness for the central hub (`n-otw-fusion`) in the 9-node illustrative graph. *(Note: This unit test checks basic graph traversal on a static fixture; it does not constitute general mathematical validation of NetworkX algorithms or arbitrary graph topologies).*
4. `✔ Three-Stage Cascading Failure DES emits chronological Stage 1 -> Stage 2 -> Stage 3 events and 24h capacity curves`: Verifies strictly ordered timestamp event generation across configured stages.
5. `✔ Low-RPN invariant: adjusted risk never exceeds raw RPN for any raw score, including raw 1-4`: Validates that mitigation-only adjusted risk score satisfies $0.0 \le \text{adjusted} \le \text{raw}$ across all raw scores $1 \le \text{raw} \le 125$, confirming removal of the old `Math.max(5.0, ...)` floor defect.
6. `✔ Monotonic non-increasing invariant: increasing controls never increases adjusted risk`: Confirms monotonic non-increasing risk scores as control levels increase.
7. `✔ Centralized PSOE maturity evaluation: zero settings yield NOT_PRESENT and thresholds are centralized`: Confirms zero control settings map strictly to `NOT_PRESENT` (zero settings cannot assert evidenced presence) and centralizes threshold mapping.
8. `✔ Result provenance and fallback tracking: responses contain engine metadata and distinguish fallback`: Verifies response provenance tracking (`browser-typescript`, `FastAPI-Python`, `server-typescript-fallback`).
9. `✔ Displayed and exported terminology consistency: lost capacity and average control score`: Verifies aligned terminology (`estimated_lost_movement_capacity`, `average_control_score`, `mean_adjusted_risk`) across summary KPIs, capacity points, and export dossiers.
10. `✔ Stale response protection: responses with mismatched input revisions are identifiable`: Confirms client store revision tracking pattern correctly identifies out-of-order stale async server responses.

### 4.2 TypeScript Typecheck & Production Build
```bash
# Static type checking
npx tsc --noEmit
# Result: 0 errors

# Production bundle build
npm run build
# Result: Built in 1.06s (dist/index.html 1.66 kB, dist/assets/index.js 941 kB)
```

### 4.3 HTTP Service Availability
- **Frontend / Express API (`http://localhost:3000/api/health`)**:
  `HTTP 200 OK` — `{"status":"ok","engine":"AeroCascade Simulation & Graph Centrality Engine", ...}`
- **FastAPI Backend (`http://127.0.0.1:8000/api/health`)**:
  `HTTP 200 OK` — `{"status":"ok","engine":"AeroCascade FastAPI + SimPy + NetworkX", ...}`

---

## 5. Implemented Scenario Inventory

The simulator contains 3 presets defined in [`src/domain/scenarios.ts`](file:///Users/aryanaggarwal/Downloads/aerocascade/src/domain/scenarios.ts):

| ID | Title & Aerodrome Profile | Baseline Mvmt/Hr | Trigger Hr | Nodes | Edges | Core Attack Mechanism |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **`rtc-optical-asmgcs-spoof`** | **Scenario I: Optical Panorama & A-SMGCS Sensor Desynchronization**<br>Dual-Runway Regional Hub + 2 Satellite Aerodromes | 48 | 4 | 9 | 10 | Man-in-the-middle replay & frame freeze on RTP video streams + ASTERIX Cat-021 ghost track injection. Stalls in Stage 3 due to ATCO visual distrust and Part-IS reversion ambiguity. |
| **`swim-amhs-flight-object-lockout`** | **Scenario II: SWIM Flight Object & AMHS Integrity Cascade**<br>En-Route Centre + Terminal Maneuvering Area (TMA) | 64 | 3 | 6 | 5 | Ingestion of malformed FIXM XML flight plan messages causing XML bomb / memory exhaustion in SWIM broker, desynchronizing Electronic Flight Strips (EFS) and Arrival Manager (AMAN). |
| **`c2-sdwan-agl-plc-blackout`** | **Scenario III: SD-WAN C2 Link Hijack & Airfield Ground Lighting (AGL) PLC Fault**<br>Single-Runway Low-Visibility (CAT III) Aerodrome | 32 | 5 | 5 | 4 | Hijack of redundant SD-WAN control tunnel injecting forged Modbus/TCP packets into AGL PLC controllers, causing uncommanded runway stop bar illumination during takeoff roll. |

---

## 6. Frontend-to-Engine Request Flow & Architectural Finding

### 6.1 Call Graph & Execution Path

```
[ User Interaction in Browser ]
        │
        ├── Slide Controls / Toggle Nodes (real-time UI update)
        │       └──> useCascadeStore.ts
        │               └──> client-memory: runDiscreteEventSimulation()
        │                    (src/domain/simulationEngine.ts)
        │
        └── Click "Run Simulation" Button
                └──> executeSimulationOnServer() in useCascadeStore.ts
                        └──> HTTP POST http://localhost:3000/api/simulate
                                └──> server.ts (Express)
                                        └──> Node runtime: runDiscreteEventSimulation()
                                             (src/domain/simulationEngine.ts)
```

### 6.2 Python Integration Status: **CONNECTED VIA PROXY (WITH FALLBACK)**
**Finding:** The Express server on port 3000 implements a reverse-proxy routing layer (`proxyToPythonBackend`) targeting the Python FastAPI backend on port 8000 (`http://127.0.0.1:8000`):
- When the user clicks "Run Simulation" in the web UI, a `POST /api/simulate` request is dispatched to Express on port 3000.
- `server.ts` proxies the request to `http://127.0.0.1:8000/api/simulate`.
- When the Python FastAPI backend is online and the payload conforms to `SimulationRequest` (`nodes` and `edges` provided), FastAPI executes the SimPy & NetworkX engine, returning `HTTP 200 OK` with the response header:
  `X-Backend-Engine: FastAPI-Python`.
- If the Python backend is unreachable, times out (>3500ms), or returns a non-2xx status, Express logs a fallback warning and seamlessly executes the TypeScript `simulationEngine.ts` implementation, returning:
  `X-Backend-Engine: TypeScript-Fallback`.
- For real-time slider updates in the frontend, `useCascadeStore.ts` directly evaluates `simulationEngine.ts` in browser memory to eliminate network round-trip latency during user drags.

### 6.3 Numerical Discrepancies Between Python and TypeScript Engines
**Crucial Finding:** The Python (SimPy + NetworkX) and original TypeScript implementations were **not numerically equivalent**. These differences were **not merely stochastic** (random number seeds): the two engines also used **fundamentally different mathematical equations and structural dynamics**:
- **Equation Differences:** The original TypeScript implementation used fixed, scripted algebraic decay equations (`unmit_factor = 1.0 - 0.38 * (dt + 1)`), whereas the Python engine simulates a continuous SimPy environment with state transitions.
- **Recovery window hours:** TypeScript reported 11 hours, whereas Python reported 10.0 hours.
- **Estimated lost movement capacity (disrupted movements):** TypeScript calculated 145 movements, whereas Python calculated 136.0 movements.
- **First cascade event timestamp:** TypeScript logged T+4.08h, whereas Python logged T+4.04h.
- **Schema alignment:** Previously, Python `NodeCentralityMetric` omitted `dominant_control`, `er040_severity`, and `psoe_status` (remediated in Prompt 1).

**Prompt 2 Resolution (One Authoritative Causal Engine):**
AeroCascade 2.0 establishes the Python FastAPI + SimPy + NetworkX engine as the **single authoritative simulation source**. All normal UI simulation and centrality calls are routed through this engine. Express serves as the proxy gateway, validating payloads and returning explicit HTTP 503 errors if the Python backend is unavailable, rather than silently masquerading as a successful Python run or generating conflicting TypeScript trajectories.

---

## 7. Known Gaps & Reproduction Steps

### Gap 1: Schema Rigidity on Python Simulation Request [RESOLVED in Prompt 2]
- **Status:** Resolved in `backend/simpy_engine.py` and `server.ts`. Simulation requests now support explicit initiating events, services, and redundancy groups, and auto-populate default graph topologies from scenario presets when node lists are omitted by lightweight callers.

### Gap 2: Missing Git Version Control
- **Description:** The folder was unpacked from a ZIP file and has no initialized Git repository.
- **Reproduction:** Run `git status` inside `/Users/aryanaggarwal/Downloads/aerocascade`.
- **Note:** Initializing Git within `/Users/aryanaggarwal/Downloads` must be done specifically inside `aerocascade/` once confirmed by the user.

### Gap 3: Code-Splitting Warning in Vite Build [RESOLVED]
- **Resolution:** Each workspace loads its own JavaScript on demand. React Flow loads with Topology, and Recharts loads with FMEA & Capacity. Opening a direct workspace URL loads that workspace first.
- **Verification:** The production build emits separate workspace chunks and no longer warns about chunks over 500 kB.

### Gap 4: Silent Fallback on Failed API Requests [RESOLVED in Prompt 2]
- **Status:** Resolved. `server.ts` returns an explicit HTTP 503 if the Python backend is offline, and `useCascadeStore.ts` captures `backendError`, rendering an interactive error banner in `App.tsx` with retry and explicitly labeled uncalibrated legacy demo mode options. Older in-flight requests cannot overwrite newer results or clear active loading states.

---

## 8. Verification Checklist Summary

- [x] Working directory confirmed as `/Users/aryanaggarwal/Downloads/aerocascade`
- [x] Initialized dependencies cleanly without modifying global system Python
- [x] Resolved `esbuild` peer dependency conflict with Vite 8
- [x] Resolved TypeScript generic constraint in `<ReactFlow>`
- [x] Verified unit tests pass (10/10 tests, including low-RPN, monotonicity, PSOE, and provenance invariants)
- [x] Verified TypeScript compilation passes (0 errors)
- [x] Verified Vite production build succeeds
- [x] Verified Frontend/Express API responds on port 3000
- [x] Verified Python FastAPI backend responds on port 8000
- [x] Verified interactive scenario loading, FMEA tables, and Part-IS dossier export
- [x] Traced and documented UI-to-engine execution pipeline and Python proxy routing
- [x] Documented numerical non-equivalence between Python SimPy and TypeScript DES engines based on engine-comparison.json
- [x] Created `docs/BASELINE_AUDIT.md`
