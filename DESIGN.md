# AeroCascade Design System & Console Architecture (`DESIGN.md`)

## 1. Product Identity & Purpose

AeroCascade is an **aviation cyber-physical research console** for modeling multi-stage cascading failures and capacity degradation in Remote Tower Centres (RTC) and Air Navigation Service Provider (ANSP) digital infrastructure. It operationalizes research from Aggarwal & Dhillon (*Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations*, AIAA Aviation 2026).

### The Operator's Core Workflow Loop
1. **Configure Scenario:** Select an operational aerodrome baseline (e.g., optical sensor spoofing, flight strip sync breach, controller trust collapse) and adjust system dependencies or tripartite controls (Technical, Formal, Informal).
2. **Run Authoritative Simulation:** Dispatch either a deterministic baseline run or a 30-replicate Monte Carlo stochastic run.
3. **Identify Where Capacity Fell:** Inspect topological chokepoints, failure propagation timelines, and bottleneck aerodrome movement capacity.
4. **Compare Recovery Across Policies:** Directly contrast the active configuration against counterfactual unmitigated and technical-heavy benchmarks on the capacity recovery curve.
5. **Audit & Export Compliance:** Inspect the generated EASA Part-IS exercise dossier, print the formal draft, or export the verified JSON experiment bundle.

---

## 2. Anti-Slop Visual Philosophy (`antislop-ui` Compliance)

In accordance with `antislop.md` and `antislop-ui`, AeroCascade rejects generic AI design tropes:
- **No decorative blue-purple gradients or ambient neon glows:** Surfaces are solid, purposeful engineering panels.
- **No excessive glassmorphism:** Surfaces use solid neutral backgrounds with clear borders (`#111827`, `#0B0F17`) to establish dependable visual grounding.
- **No uniform pill shapes:** Inputs, cards, buttons, and tables use structured geometric radii (`rounded` / `rounded-md`, 4px–6px) appropriate for data-dense control rooms.
- **No decorative background grids:** No fake blueprint grids or canvas dot-patterns. Contrast is achieved through crisp borders (`border-slate-800`) and tabular typography.
- **Restrained Motion:** Animations are strictly limited to functional interaction feedback (hover state color shifts, disabled state transitions) and active simulation spinners. No bouncing, floating, or idle decorative motion.

---

## 3. Color Architecture & Semantic Coding

Color is strictly functional and reserved for **stage identity**, **risk severity**, and **series distinction**:

### Dark Neutral Foundation
- **Canvas Base:** `#0B0F17` (Deep cockpit night neutral)
- **Panel / Surface:** `#111827` (Matte instrument console)
- **Borders & Dividers:** `#1E293B` and `#334155` (Subtle boundary definition)
- **Muted Text:** `#64748B` (Secondary annotations, units)
- **Body Text:** `#94A3B8` / `#CBD5E1` (High legibility metadata)
- **High Contrast Headers:** `#F8FAFC` (Primary titles, KPI numbers)

### Cascade Stage Taxonomy
- **Stage 1 (Initial Breach / Trigger):** Rose `#F43F5E` / `#E11D48`
- **Stage 2 (Operational Fragility Propagation):** Orange `#F97316` / Amber `#F59E0B`
- **Stage 3 (Recovery Governance Stall / Deficit):** Purple `#A855F7` / Violet `#8B5CF6`
- **Nominal / Restored Operations:** Emerald `#10B981`

### Multi-Series Capacity Curves
- **Nominal Capacity Baseline:** Neutral Slate `#64748B`, dashed step-line (`strokeDasharray="6 4"`).
- **Active Tripartite Configuration:** Emerald `#10B981`, bold solid line (`strokeWidth={2.5}`).
- **Technical-Only Counterfactual:** Amber `#F59E0B`, medium dashed line (`strokeDasharray="6 3"`).
- **Unmitigated Stress Counterfactual:** Rose `#F43F5E`, thin dotted line (`strokeDasharray="2 2"`).
- **Monte Carlo 50th Percentile (Median):** Cyan `#06B6D4`, solid line with data points.
- **Monte Carlo 5th–95th Percentile Band:** Soft purple `#C084FC` with translucent `#A855F7` fill (20% opacity) and dashed bounding stroke.

---

## 4. Hierarchy, Navigation & Run Controls

### Unified Command Header
The top navigation bar acts as the **single authoritative command center**:
1. **Scenario Selection:** Dropdown clearly stating active scenario name and preset identifier.
2. **Workspace Navigation Tabs:** `Topology & DES`, `FMEA & Capacity`, `Part-IS Dossier`, and `SimPy Backend`.
3. **Execution Controls (One Consistent Location):**
   - **Run Simulation (Deterministic):** Solid high-contrast button (`bg-cyan-500 text-slate-950`).
   - **Run Monte Carlo (30 Replicates):** Outlined purple button (`border-purple-500/70 bg-purple-950/70 text-purple-200`).
   - **Progress Feedback:** Loading spinners and text (`Simulating...`, `Simulating (30 Reps)...`) appear *only* on the triggered action.
   - **Accessible Announcements:** Status updates and errors are announced via `aria-live="polite"` and `role="alert"`.

### Stale Result Protection
When the operator modifies any slider, toggle, or input:
- The store bumps `inputRevision`.
- The UI immediately surfaces a **Stale Result Banner**:
  `Inputs modified since last run — displaying prior results from Rev #X. Click Run Simulation to evaluate current configuration.`
- The provenance badge explicitly marks results as `(STALE · REV #X)` until a new simulation completes.

### Engine Provenance Identification
Results explicitly distinguish their provenance:
- **`[Authoritative Python Engine · SimPy Causal DES]`**: Returned from the FastAPI/SimPy backend.
- **`[In-Browser Client Preview · Local Estimator]`**: Initial client seed or explicit fallback.
- **`[Monte Carlo (30 Replicates)]`**: Augmented statistical percentile envelope.

---

## 5. Responsive Design & Ergonomics

- **Desktop (≥ 1280px):** Full two-pane split with graph canvas alongside inspector; dual-column analytics charts.
- **Laptop / Tablet (768px – 1279px):** Responsive collapsible inspector drawer; stacked chart layout.
- **Narrow Mobile (< 768px):** Clean single-column vertical flow; horizontal scrolling tab bar; full-width buttons and sliders with minimum 44px touch targets.
- **Accessibility:** All interactive elements feature visible high-contrast focus rings (`focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900`) and keyboard navigation support.
