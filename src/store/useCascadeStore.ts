import { create } from 'zustand';
import { SCENARIO_PRESETS } from '../domain/scenarios.ts';
import { runDiscreteEventSimulation } from '../domain/simulationEngine.ts';
import {
  type DependencyEdgeModel,
  type FMEAMetrics,
  type PSOELevel,
  type ScenarioPreset,
  type SimulationResponse,
  type SystemNodeModel,
  type TripartiteControls,
} from '../domain/types.ts';

export type WorkspaceTab =
  | 'topology'
  | 'fmea-capacity'
  | 'easa-compliance'
  | 'python-engine';

interface CascadeState {
  activeTab: WorkspaceTab;
  scenarios: ScenarioPreset[];
  activeScenarioId: string;
  baselineMovementsPerHour: number;
  triggerHour: number;
  horizonHours: number;
  nodes: SystemNodeModel[];
  edges: DependencyEdgeModel[];
  selectedNodeId: string | null;
  simulationResult: SimulationResponse;
  isSimulating: boolean;
  lastSyncedAt: string;
  inputRevision: number;
  latestRequestedRevision: number;
  pendingRequestsCount: number;
  backendError: string | null;

  setActiveTab: (tab: WorkspaceTab) => void;
  selectScenario: (scenarioId: string) => void;
  selectNode: (nodeId: string | null) => void;
  updateNodeTripartite: (nodeId: string, partial: Partial<TripartiteControls>) => void;
  updateNodeFMEA: (nodeId: string, partial: Partial<FMEAMetrics>) => void;
  updateNodePSOE: (nodeId: string, psoe: PSOELevel) => void;
  applyGlobalPreset: (mode: 'baseline' | 'technical-heavy' | 'tripartite-balanced' | 'unmitigated-stress') => void;
  setTriggerHour: (hour: number) => void;
  setBaselineMovements: (mvmt: number) => void;
  executeSimulationOnServer: (opts?: { allowLegacyDemo?: boolean }) => Promise<void>;
  clearBackendError: () => void;
}

const initialScenario = SCENARIO_PRESETS[0];
const initialSimulation = runDiscreteEventSimulation({
  scenario_id: initialScenario.id,
  horizon_hours: initialScenario.horizon_hours,
  baseline_movements_per_hour: initialScenario.baseline_movements_per_hour,
  trigger_hour: initialScenario.trigger_hour,
  nodes: structuredClone(initialScenario.nodes),
  edges: structuredClone(initialScenario.edges),
  provenance: {
    engine: 'browser-typescript',
    engine_label: 'In-Browser Client (TypeScript Engine)',
    model_version: '1.0.0-illustrative',
    input_revision: 1,
    generated_at: new Date().toISOString(),
    is_fallback: false,
  },
});

export const useCascadeStore = create<CascadeState>((set, get) => ({
  activeTab: 'topology',
  scenarios: SCENARIO_PRESETS,
  activeScenarioId: initialScenario.id,
  baselineMovementsPerHour: initialScenario.baseline_movements_per_hour,
  triggerHour: initialScenario.trigger_hour,
  horizonHours: initialScenario.horizon_hours,
  nodes: structuredClone(initialScenario.nodes),
  edges: structuredClone(initialScenario.edges),
  selectedNodeId: initialScenario.nodes[0]?.id ?? null,
  simulationResult: initialSimulation,
  isSimulating: false,
  lastSyncedAt: 'In-Browser Client (Initial Seed)',
  inputRevision: 1,
  latestRequestedRevision: 1,
  pendingRequestsCount: 0,
  backendError: null,

  clearBackendError: () => set({ backendError: null }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  selectScenario: (scenarioId) => {
    const nextRev = get().inputRevision + 1;
    const found = SCENARIO_PRESETS.find((s) => s.id === scenarioId) ?? SCENARIO_PRESETS[0];
    const clonedNodes = structuredClone(found.nodes);
    const clonedEdges = structuredClone(found.edges);
    const simResult = runDiscreteEventSimulation({
      scenario_id: found.id,
      horizon_hours: found.horizon_hours,
      baseline_movements_per_hour: found.baseline_movements_per_hour,
      trigger_hour: found.trigger_hour,
      nodes: clonedNodes,
      edges: clonedEdges,
      provenance: {
        engine: 'browser-typescript',
        engine_label: 'In-Browser Client (TypeScript Engine)',
        model_version: '1.0.0-illustrative',
        input_revision: nextRev,
        generated_at: new Date().toISOString(),
        is_fallback: false,
      },
    });
    set({
      activeScenarioId: found.id,
      baselineMovementsPerHour: found.baseline_movements_per_hour,
      triggerHour: found.trigger_hour,
      horizonHours: found.horizon_hours,
      nodes: clonedNodes,
      edges: clonedEdges,
      selectedNodeId: clonedNodes[0]?.id ?? null,
      simulationResult: simResult,
      inputRevision: nextRev,
      lastSyncedAt: `Scenario Loaded (${found.id}) · Rev #${nextRev}`,
    });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  updateNodeTripartite: (nodeId, partial) => {
    const state = get();
    const nextRev = state.inputRevision + 1;
    const updatedNodes = state.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            tripartite: {
              ...n.tripartite,
              ...partial,
            },
          }
        : n
    );
    const simResult = runDiscreteEventSimulation({
      scenario_id: state.activeScenarioId,
      horizon_hours: state.horizonHours,
      baseline_movements_per_hour: state.baselineMovementsPerHour,
      trigger_hour: state.triggerHour,
      nodes: updatedNodes,
      edges: state.edges,
      provenance: {
        engine: 'browser-typescript',
        engine_label: 'In-Browser Client (TypeScript Engine)',
        model_version: '1.0.0-illustrative',
        input_revision: nextRev,
        generated_at: new Date().toISOString(),
        is_fallback: false,
      },
    });
    set({
      nodes: updatedNodes,
      simulationResult: simResult,
      inputRevision: nextRev,
      lastSyncedAt: `Control Updated (${nodeId}) · Rev #${nextRev}`,
    });
  },

  updateNodeFMEA: (nodeId, partial) => {
    const state = get();
    const nextRev = state.inputRevision + 1;
    const updatedNodes = state.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            fmea: {
              ...n.fmea,
              ...partial,
            },
          }
        : n
    );
    const simResult = runDiscreteEventSimulation({
      scenario_id: state.activeScenarioId,
      horizon_hours: state.horizonHours,
      baseline_movements_per_hour: state.baselineMovementsPerHour,
      trigger_hour: state.triggerHour,
      nodes: updatedNodes,
      edges: state.edges,
      provenance: {
        engine: 'browser-typescript',
        engine_label: 'In-Browser Client (TypeScript Engine)',
        model_version: '1.0.0-illustrative',
        input_revision: nextRev,
        generated_at: new Date().toISOString(),
        is_fallback: false,
      },
    });
    set({
      nodes: updatedNodes,
      simulationResult: simResult,
      inputRevision: nextRev,
      lastSyncedAt: `FMEA Updated (${nodeId}) · Rev #${nextRev}`,
    });
  },

  updateNodePSOE: (nodeId, psoe) => {
    const state = get();
    const nextRev = state.inputRevision + 1;
    const updatedNodes = state.nodes.map((n) =>
      n.id === nodeId ? { ...n, psoe_status: psoe } : n
    );
    set({ nodes: updatedNodes, inputRevision: nextRev });
  },

  applyGlobalPreset: (mode) => {
    const state = get();
    const nextRev = state.inputRevision + 1;
    const basePreset =
      SCENARIO_PRESETS.find((s) => s.id === state.activeScenarioId) ?? SCENARIO_PRESETS[0];

    const updatedNodes = structuredClone(basePreset.nodes).map((n) => {
      if (mode === 'baseline') {
        return n;
      }
      if (mode === 'technical-heavy') {
        // High Technical controls (88%), but Formal (32%) and Informal (28%) neglected
        return {
          ...n,
          tripartite: { technical: 88, formal: 32, informal: 28 },
          fmea: {
            ...n.fmea,
            policy_investment: n.stage === 'STAGE_1_TRIGGER' ? 88 : 24,
          },
        };
      }
      if (mode === 'tripartite-balanced') {
        // Balanced Dhillon & Moores (2001) Tripartite Controls (82-86%) across all 3 dimensions
        return {
          ...n,
          tripartite: { technical: 84, formal: 85, informal: 82 },
          fmea: {
            ...n.fmea,
            policy_investment: 78,
          },
        };
      }
      // unmitigated-stress
      return {
        ...n,
        tripartite: { technical: 25, formal: 20, informal: 18 },
        fmea: {
          ...n.fmea,
          policy_investment: 15,
        },
      };
    });

    const simResult = runDiscreteEventSimulation({
      scenario_id: state.activeScenarioId,
      horizon_hours: state.horizonHours,
      baseline_movements_per_hour: state.baselineMovementsPerHour,
      trigger_hour: state.triggerHour,
      nodes: updatedNodes,
      edges: state.edges,
      provenance: {
        engine: 'browser-typescript',
        engine_label: 'In-Browser Client (TypeScript Engine)',
        model_version: '1.0.0-illustrative',
        input_revision: nextRev,
        generated_at: new Date().toISOString(),
        is_fallback: false,
      },
    });

    set({
      nodes: updatedNodes,
      simulationResult: simResult,
      inputRevision: nextRev,
      lastSyncedAt: `Policy Preset Applied (${mode === 'baseline' ? 'Scenario Baseline' : mode}) · Rev #${nextRev}`,
    });
  },

  setTriggerHour: (hour) => {
    const state = get();
    const nextRev = state.inputRevision + 1;
    const clamped = Math.min(12, Math.max(1, Math.round(hour)));
    const simResult = runDiscreteEventSimulation({
      scenario_id: state.activeScenarioId,
      horizon_hours: state.horizonHours,
      baseline_movements_per_hour: state.baselineMovementsPerHour,
      trigger_hour: clamped,
      nodes: state.nodes,
      edges: state.edges,
      provenance: {
        engine: 'browser-typescript',
        engine_label: 'In-Browser Client (TypeScript Engine)',
        model_version: '1.0.0-illustrative',
        input_revision: nextRev,
        generated_at: new Date().toISOString(),
        is_fallback: false,
      },
    });
    set({ triggerHour: clamped, simulationResult: simResult, inputRevision: nextRev });
  },

  setBaselineMovements: (mvmt) => {
    const state = get();
    const nextRev = state.inputRevision + 1;
    const clamped = Math.min(120, Math.max(12, Math.round(mvmt)));
    const simResult = runDiscreteEventSimulation({
      scenario_id: state.activeScenarioId,
      horizon_hours: state.horizonHours,
      baseline_movements_per_hour: clamped,
      trigger_hour: state.triggerHour,
      nodes: state.nodes,
      edges: state.edges,
      provenance: {
        engine: 'browser-typescript',
        engine_label: 'In-Browser Client (TypeScript Engine)',
        model_version: '1.0.0-illustrative',
        input_revision: nextRev,
        generated_at: new Date().toISOString(),
        is_fallback: false,
      },
    });
    set({ baselineMovementsPerHour: clamped, simulationResult: simResult, inputRevision: nextRev });
  },

  executeSimulationOnServer: async (opts?: { allowLegacyDemo?: boolean }) => {
    const state = get();
    const requestRevision = state.inputRevision;

    // Validate inputs
    if (!state.nodes || state.nodes.length === 0) {
      set({
        backendError: 'Simulation node list cannot be empty.',
        isSimulating: false,
      });
      return;
    }

    set((s) => ({
      isSimulating: true,
      latestRequestedRevision: requestRevision,
      pendingRequestsCount: s.pendingRequestsCount + 1,
      backendError: null,
    }));

    try {
      const url = opts?.allowLegacyDemo ? '/api/simulate?allow_legacy_demo=true' : '/api/simulate';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(opts?.allowLegacyDemo ? { 'x-allow-legacy-demo': 'true' } : {}),
        },
        body: JSON.stringify({
          scenario_id: state.activeScenarioId,
          horizon_hours: state.horizonHours,
          baseline_movements_per_hour: state.baselineMovementsPerHour,
          trigger_hour: state.triggerHour,
          nodes: state.nodes,
          edges: state.edges,
          input_revision: requestRevision,
        }),
      });

      const pendingLeft = Math.max(0, get().pendingRequestsCount - 1);

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const errMsg = errJson?.error || errJson?.detail || `Simulation server returned HTTP ${response.status}`;
        const isLatest = get().latestRequestedRevision === requestRevision;
        set({
          pendingRequestsCount: pendingLeft,
          // Only clear isSimulating if no newer requests are running
          isSimulating: pendingLeft > 0 ? get().isSimulating : false,
          backendError: isLatest ? errMsg : get().backendError,
        });
        return;
      }

      const data: SimulationResponse = await response.json();

      // Stale response protection:
      // If user edited inputs while this request was in flight, or a newer request was dispatched,
      // this older response must NEITHER overwrite the newer result NOR clear the loading state of the newer request!
      const isStillLatest = get().latestRequestedRevision === requestRevision && get().inputRevision === requestRevision;

      if (!isStillLatest) {
        set({
          pendingRequestsCount: pendingLeft,
          // Do not clear isSimulating if newer requests are in flight!
          isSimulating: pendingLeft > 0 ? get().isSimulating : false,
        });
        return;
      }

      const engineLabel = data.provenance?.engine_label ?? 'Authoritative Engine';
      set({
        simulationResult: data,
        isSimulating: pendingLeft > 0 ? get().isSimulating : false,
        pendingRequestsCount: pendingLeft,
        backendError: null,
        lastSyncedAt: `${engineLabel} (Rev #${requestRevision}) at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
      });
    } catch (err) {
      const pendingLeft = Math.max(0, get().pendingRequestsCount - 1);
      const isLatest = get().latestRequestedRevision === requestRevision;
      const errMessage = err instanceof Error ? err.message : String(err);
      set({
        pendingRequestsCount: pendingLeft,
        isSimulating: pendingLeft > 0 ? get().isSimulating : false,
        backendError: isLatest ? `Failed to connect to simulation backend: ${errMessage}` : get().backendError,
      });
    }
  },
}));
