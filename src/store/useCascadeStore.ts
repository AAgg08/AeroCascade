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

  setActiveTab: (tab: WorkspaceTab) => void;
  selectScenario: (scenarioId: string) => void;
  selectNode: (nodeId: string | null) => void;
  updateNodeTripartite: (nodeId: string, partial: Partial<TripartiteControls>) => void;
  updateNodeFMEA: (nodeId: string, partial: Partial<FMEAMetrics>) => void;
  updateNodePSOE: (nodeId: string, psoe: PSOELevel) => void;
  applyGlobalPreset: (mode: 'baseline' | 'technical-heavy' | 'tripartite-balanced' | 'unmitigated-stress') => void;
  setTriggerHour: (hour: number) => void;
  setBaselineMovements: (mvmt: number) => void;
  executeSimulationOnServer: () => Promise<void>;
}

const initialScenario = SCENARIO_PRESETS[0];
const initialSimulation = runDiscreteEventSimulation({
  scenario_id: initialScenario.id,
  horizon_hours: initialScenario.horizon_hours,
  baseline_movements_per_hour: initialScenario.baseline_movements_per_hour,
  trigger_hour: initialScenario.trigger_hour,
  nodes: structuredClone(initialScenario.nodes),
  edges: structuredClone(initialScenario.edges),
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
  lastSyncedAt: 'T+00:00Z (Initial Seed)',

  setActiveTab: (tab) => set({ activeTab: tab }),

  selectScenario: (scenarioId) => {
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
      lastSyncedAt: `Scenario Loaded (${found.id})`,
    });
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  updateNodeTripartite: (nodeId, partial) => {
    const state = get();
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
    });
    set({
      nodes: updatedNodes,
      simulationResult: simResult,
    });
  },

  updateNodeFMEA: (nodeId, partial) => {
    const state = get();
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
    });
    set({
      nodes: updatedNodes,
      simulationResult: simResult,
    });
  },

  updateNodePSOE: (nodeId, psoe) => {
    const state = get();
    const updatedNodes = state.nodes.map((n) =>
      n.id === nodeId ? { ...n, psoe_status: psoe } : n
    );
    set({ nodes: updatedNodes });
  },

  applyGlobalPreset: (mode) => {
    const state = get();
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
    });

    set({
      nodes: updatedNodes,
      simulationResult: simResult,
      lastSyncedAt: `Policy Preset Applied (${mode})`,
    });
  },

  setTriggerHour: (hour) => {
    const state = get();
    const clamped = Math.min(12, Math.max(1, Math.round(hour)));
    const simResult = runDiscreteEventSimulation({
      scenario_id: state.activeScenarioId,
      horizon_hours: state.horizonHours,
      baseline_movements_per_hour: state.baselineMovementsPerHour,
      trigger_hour: clamped,
      nodes: state.nodes,
      edges: state.edges,
    });
    set({ triggerHour: clamped, simulationResult: simResult });
  },

  setBaselineMovements: (mvmt) => {
    const state = get();
    const clamped = Math.min(120, Math.max(12, Math.round(mvmt)));
    const simResult = runDiscreteEventSimulation({
      scenario_id: state.activeScenarioId,
      horizon_hours: state.horizonHours,
      baseline_movements_per_hour: clamped,
      trigger_hour: state.triggerHour,
      nodes: state.nodes,
      edges: state.edges,
    });
    set({ baselineMovementsPerHour: clamped, simulationResult: simResult });
  },

  executeSimulationOnServer: async () => {
    const state = get();
    set({ isSimulating: true });
    try {
      const response = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenario_id: state.activeScenarioId,
          horizon_hours: state.horizonHours,
          baseline_movements_per_hour: state.baselineMovementsPerHour,
          trigger_hour: state.triggerHour,
          nodes: state.nodes,
          edges: state.edges,
        }),
      });
      if (response.ok) {
        const data: SimulationResponse = await response.json();
        set({
          simulationResult: data,
          isSimulating: false,
          lastSyncedAt: `DES Engine Executed (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`,
        });
        return;
      }
    } catch {
      // Fallback to deterministic local execution if offline
    }
    const fallback = runDiscreteEventSimulation({
      scenario_id: state.activeScenarioId,
      horizon_hours: state.horizonHours,
      baseline_movements_per_hour: state.baselineMovementsPerHour,
      trigger_hour: state.triggerHour,
      nodes: state.nodes,
      edges: state.edges,
    });
    set({
      simulationResult: fallback,
      isSimulating: false,
      lastSyncedAt: 'DES Engine Executed (Deterministic Local)',
    });
  },
}));
