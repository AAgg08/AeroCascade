import { create } from 'zustand';
import { loadWorkspace, parseWorkspace, serializeWorkspace, WORKSPACE_STORAGE_KEY, type WorkspaceSettings } from './workspaceSession.ts';

let workspaceStorage: Storage | undefined;
try {
  if (typeof window !== 'undefined') workspaceStorage = window.localStorage;
} catch {
  // Storage can be disabled by the browser.
}
const savedWorkspace = loadWorkspace(workspaceStorage);
import { SCENARIO_PRESETS } from '../domain/scenarios.ts';
import { runDiscreteEventSimulation } from '../domain/simulationEngine.ts';
import {
  presetToCanonicalTopology,
  canonicalTopologyToSimulationInput,
  type CanonicalTopology,
  type ImportPreviewResponse,
} from '../domain/canonical.ts';
import {
  type DependencyEdgeModel,
  type FMEAMetrics,
  type PSOELevel,
  type ScenarioPreset,
  type SimulationResponse,
  type SystemNodeModel,
  type TripartiteControls,
} from '../domain/types.ts';

export interface TopologySummary {
  id: string;
  name: string;
  description: string;
  current_version: number;
  updated_at: string;
  created_at: string;
  cloned_from_id?: string | null;
  cloned_from_version?: number | null;
}

export type WorkspaceTab =
  | 'topology'
  | 'fmea-capacity'
  | 'easa-compliance'
  | 'python-engine';

export function workspaceTabFromHash(hash: string): WorkspaceTab | undefined {
  const tab = hash.slice(1);
  switch (tab) {
    case 'topology':
    case 'fmea-capacity':
    case 'easa-compliance':
    case 'python-engine':
      return tab;
  }
}

function simulationErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const { error, detail } = payload as Record<string, unknown>;
    for (const value of [error, detail]) {
      if (typeof value === 'string' && value.trim()) return value;
      if (Array.isArray(value)) {
        const messages = value.slice(0, 3).flatMap((item) => {
          if (!item || typeof item.msg !== 'string') return [];
          const field = Array.isArray(item.loc) ? item.loc.filter((part: unknown) => part !== 'body').join('.') : '';
          return field ? [`${field}: ${item.msg}`] : [item.msg];
        });
        if (messages.length > 0) return `Check the simulation inputs. ${messages.join(' ')}`;
      }
    }
  }
  return `Simulation request failed (HTTP ${status}). Please try again.`;
}

export interface DossierApprovalRecord {
  run_id: string;
  approval_type: 'enterprise' | 'exercise' | 'legacy';
  approver: string;
  approver_role: string;
  signoff_notes: string;
  run_sha256: string;
  topology_id?: string;
  topology_version?: number;
  authenticated_account?: string | null;
  approved_at: string;
}

export interface UserSessionInfo {
  username: string;
  role: string;
  enterprise: boolean;
}

export interface RunServerState {
  isPersisted: boolean;
  isStale: boolean;
  runSha256: string | null;
  serverTopologyId: string | null;
  serverTopologyVersion: number | null;
  approvalStatus?: string;
  allApprovals?: Record<string, DossierApprovalRecord>;
}

interface CascadeState {
  workspaceSaveStatus: 'none' | 'saved' | 'restored' | 'invalid' | 'unavailable';
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
  activeRunMode: 'deterministic' | 'monte-carlo' | null;
  lastSyncedAt: string;
  inputRevision: number;
  latestRequestedRevision: number;
  latestRequestId: number;
  pendingRequestsCount: number;
  backendError: string | null;
  costPerDelayedMovement: number;
  disruptionCurrency: string;
  costPerFlightHour: number | null;
  implementationCost: number | null;
  initialQueueBacklog: number;
  topologies: TopologySummary[];
  currentTopologyId: string | null;
  currentTopologyVersion: number | null;
  isTopologyModalOpen: boolean;
  topologyLoading: boolean;
  topologyConflictError: string | null;
  topologySuccessMessage: string | null;
  importPreview: ImportPreviewResponse | null;
  importLoading: boolean;
  importError: string | null;
  userSession: UserSessionInfo | null;
  activeDevRole: string;
  runApproval: DossierApprovalRecord | null;
  runServerState: RunServerState | null;
  dossierLoading: boolean;
  dossierError: string | null;
  dossierSuccessMessage: string | null;

  fetchUserSession: () => Promise<void>;
  setActiveDevRole: (role: string) => Promise<void>;
  fetchRunApprovalStatus: (runId?: string) => Promise<void>;
  approveCurrentRun: (signoffNotes: string, approverName?: string) => Promise<boolean>;
  downloadEvidenceJson: () => Promise<boolean>;
  clearDossierMessages: () => void;

  setActiveTab: (tab: WorkspaceTab) => void;
  selectScenario: (scenarioId: string, settings?: WorkspaceSettings) => void;
  importWorkspace: (text: string) => boolean;
  selectNode: (nodeId: string | null) => void;
  updateNodeTripartite: (nodeId: string, partial: Partial<TripartiteControls>) => void;
  updateNodeFMEA: (nodeId: string, partial: Partial<FMEAMetrics>) => void;
  updateNodePSOE: (nodeId: string, psoe: PSOELevel) => void;
  applyGlobalPreset: (mode: 'baseline' | 'technical-heavy' | 'tripartite-balanced' | 'unmitigated-stress') => void;
  setTriggerHour: (hour: number) => void;
  setBaselineMovements: (mvmt: number) => void;
  setCostPerDelayedMovement: (cost: number) => void;
  setDisruptionCurrency: (currency: string) => void;
  setCostPerFlightHour: (rate: number | null) => void;
  setImplementationCost: (cost: number | null) => void;
  setInitialQueueBacklog: (backlog: number) => void;
  executeSimulationOnServer: (opts?: { allowLegacyDemo?: boolean; replicates?: number }) => Promise<void>;
  clearBackendError: () => void;
  setTopologyModalOpen: (open: boolean) => void;
  fetchTopologies: () => Promise<void>;
  openTopology: (id: string, version?: number) => Promise<boolean>;
  saveNewTopologyVersion: (changeSummary: string) => Promise<boolean>;
  cloneTopology: (newName: string, topologyId?: string) => Promise<boolean>;
  clearTopologyConflictError: () => void;
  clearTopologySuccessMessage: () => void;
  uploadImportFile: (file: File) => Promise<boolean>;
  saveImportedTopology: (name: string, confirmCycles?: boolean) => Promise<boolean>;
  clearImportPreview: () => void;
}

const initialScenario = SCENARIO_PRESETS.find((s) => s.id === savedWorkspace.settings?.activeScenarioId) ?? SCENARIO_PRESETS[0];
const initialNodes = savedWorkspace.settings?.nodes ?? structuredClone(initialScenario.nodes);
const initialBaseline = savedWorkspace.settings?.baselineMovementsPerHour ?? initialScenario.baseline_movements_per_hour;
const initialTrigger = savedWorkspace.settings?.triggerHour ?? initialScenario.trigger_hour;
const initialSimulation = runDiscreteEventSimulation({
  scenario_id: initialScenario.id,
  horizon_hours: initialScenario.horizon_hours,
  baseline_movements_per_hour: initialBaseline,
  trigger_hour: initialTrigger,
  nodes: initialNodes,
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

let requestIdCounter = 0;

export const useCascadeStore = create<CascadeState>((set, get) => ({
  workspaceSaveStatus: savedWorkspace.status,
  activeTab: (typeof window !== 'undefined' && workspaceTabFromHash(window.location.hash)) || 'topology',
  scenarios: SCENARIO_PRESETS,
  activeScenarioId: initialScenario.id,
  baselineMovementsPerHour: initialBaseline,
  triggerHour: initialTrigger,
  horizonHours: initialScenario.horizon_hours,
  nodes: initialNodes,
  edges: structuredClone(initialScenario.edges),
  selectedNodeId: initialScenario.nodes[0]?.id ?? null,
  simulationResult: initialSimulation,
  isSimulating: false,
  activeRunMode: null,
  lastSyncedAt: 'In-Browser Client (Initial Seed)',
  inputRevision: 1,
  latestRequestedRevision: 1,
  latestRequestId: 0,
  pendingRequestsCount: 0,
  backendError: null,
  costPerDelayedMovement: savedWorkspace.settings?.costPerDelayedMovement ?? 7500,
  disruptionCurrency: savedWorkspace.settings?.disruptionCurrency ?? 'USD',
  costPerFlightHour: savedWorkspace.settings?.costPerFlightHour ?? null,
  implementationCost: savedWorkspace.settings?.implementationCost ?? null,
  initialQueueBacklog: savedWorkspace.settings?.initialQueueBacklog ?? 0,
  topologies: [],
  currentTopologyId: initialScenario.id,
  currentTopologyVersion: 1,
  isTopologyModalOpen: false,
  topologyLoading: false,
  topologyConflictError: null,
  topologySuccessMessage: null,
  importPreview: null,
  importLoading: false,
  importError: null,
  userSession: null,
  activeDevRole: 'analyst',
  runApproval: null,
  runServerState: null,
  dossierLoading: false,
  dossierError: null,
  dossierSuccessMessage: null,

  setTopologyModalOpen: (open: boolean) => set({ isTopologyModalOpen: open }),
  clearTopologyConflictError: () => set({ topologyConflictError: null }),
  clearTopologySuccessMessage: () => set({ topologySuccessMessage: null }),

  clearBackendError: () => set({ backendError: null }),

  setCostPerDelayedMovement: (cost: number) =>
    set({ costPerDelayedMovement: Math.max(0, Number.isFinite(cost) ? cost : 0) }),

  setDisruptionCurrency: (currency: string) =>
    set({ disruptionCurrency: currency.trim().toUpperCase() || 'USD' }),

  setCostPerFlightHour: (rate: number | null) =>
    set({
      costPerFlightHour:
        rate === null || rate === undefined || !Number.isFinite(rate)
          ? null
          : Math.max(0, rate),
    }),

  setImplementationCost: (cost: number | null) =>
    set({
      implementationCost:
        cost === null || cost === undefined || !Number.isFinite(cost)
          ? null
          : Math.max(0, cost),
    }),

  setInitialQueueBacklog: (backlog: number) =>
    set({ initialQueueBacklog: Math.max(0, Number.isFinite(backlog) ? Math.round(backlog) : 0) }),

  setActiveTab: (tab) => {
    if (typeof window !== 'undefined' && window.location.hash !== `#${tab}`) {
      window.history.pushState(null, '', `#${tab}`);
    }
    set({ activeTab: tab });
  },

  selectScenario: (scenarioId, settings) => {
    const nextRev = get().inputRevision + 1;
    const found = SCENARIO_PRESETS.find((s) => s.id === scenarioId) ?? SCENARIO_PRESETS[0];
    const clonedNodes = structuredClone(settings?.nodes ?? found.nodes);
    const clonedEdges = structuredClone(found.edges);
    const baseline = settings?.baselineMovementsPerHour ?? found.baseline_movements_per_hour;
    const trigger = settings?.triggerHour ?? found.trigger_hour;
    const simResult = runDiscreteEventSimulation({
      scenario_id: found.id,
      horizon_hours: found.horizon_hours,
      baseline_movements_per_hour: baseline,
      trigger_hour: trigger,
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
      currentTopologyId: found.id,
      currentTopologyVersion: 1,
      baselineMovementsPerHour: baseline,
      triggerHour: trigger,
      horizonHours: found.horizon_hours,
      nodes: clonedNodes,
      edges: clonedEdges,
      selectedNodeId: clonedNodes[0]?.id ?? null,
      simulationResult: simResult,
      backendError: null,
      costPerDelayedMovement: settings?.costPerDelayedMovement ?? get().costPerDelayedMovement,
      disruptionCurrency: settings?.disruptionCurrency ?? get().disruptionCurrency,
      costPerFlightHour: settings?.costPerFlightHour !== undefined ? settings.costPerFlightHour : get().costPerFlightHour,
      implementationCost: settings?.implementationCost !== undefined ? settings.implementationCost : get().implementationCost,
      initialQueueBacklog: settings?.initialQueueBacklog !== undefined ? settings.initialQueueBacklog : get().initialQueueBacklog,
      inputRevision: nextRev,
      lastSyncedAt: `Scenario Loaded (${found.id}) · Rev #${nextRev}`,
    });
  },

  importWorkspace: (text) => {
    const settings = parseWorkspace(text);
    if (!settings) return false;
    get().selectScenario(settings.activeScenarioId, settings);
    return true;
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
    set({
      nodes: updatedNodes,
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
    set({
      nodes: updatedNodes,
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

    set({
      nodes: updatedNodes,
      inputRevision: nextRev,
      lastSyncedAt: `Policy Preset Applied (${mode === 'baseline' ? 'Scenario Baseline' : mode}) · Rev #${nextRev}`,
    });
  },

  setTriggerHour: (hour) => {
    const state = get();
    const nextRev = state.inputRevision + 1;
    const clamped = Math.min(12, Math.max(0, Math.round(hour)));
    set({ triggerHour: clamped, inputRevision: nextRev });
  },

  setBaselineMovements: (mvmt) => {
    const state = get();
    const nextRev = state.inputRevision + 1;
    const clamped = Math.min(120, Math.max(12, Math.round(mvmt)));
    set({ baselineMovementsPerHour: clamped, inputRevision: nextRev });
  },

  executeSimulationOnServer: async (opts?: { allowLegacyDemo?: boolean; replicates?: number }) => {
    const state = get();
    const requestRevision = state.inputRevision;
    const requestId = ++requestIdCounter;
    const runMode: 'deterministic' | 'monte-carlo' = opts?.replicates && opts.replicates > 1 ? 'monte-carlo' : 'deterministic';

    // Validate inputs
    if (!state.nodes || state.nodes.length === 0) {
      set({
        backendError: 'Simulation node list cannot be empty.',
        isSimulating: false,
        activeRunMode: null,
      });
      return;
    }

    set((s) => ({
      isSimulating: true,
      activeRunMode: runMode,
      latestRequestedRevision: requestRevision,
      latestRequestId: requestId,
      pendingRequestsCount: s.pendingRequestsCount + 1,
      backendError: null,
    }));

    // Explicit initiating events for preset run: trigger Stage 1 nodes at triggerHour (including hour 0)
    const stage1Nodes = state.nodes.filter((n) => n.stage === 'STAGE_1_TRIGGER');
    const initiatingEvents = stage1Nodes.map((n) => ({
      node_id: n.id,
      event_time_hours: state.triggerHour,
      failure_mode: n.failure_mode,
    }));

    let responseData: SimulationResponse | null = null;
    let errorMessage: string | null = null;

    try {
      const url = opts?.allowLegacyDemo ? '/api/simulate?allow_legacy_demo=true' : '/api/simulate';
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(25_000),
        headers: {
          'Content-Type': 'application/json',
          ...(opts?.allowLegacyDemo ? { 'x-allow-legacy-demo': 'true' } : {}),
        },
        body: JSON.stringify({
          scenario_id: state.activeScenarioId,
          topology_version: state.currentTopologyVersion ?? undefined,
          horizon_hours: state.horizonHours,
          baseline_movements_per_hour: state.baselineMovementsPerHour,
          trigger_hour: state.triggerHour,
          nodes: state.nodes,
          edges: state.edges,
          input_revision: requestRevision,
          replicates: opts?.replicates ?? 1,
          initiating_events: initiatingEvents,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        errorMessage = simulationErrorMessage(errJson, response.status);
      } else {
        const data: SimulationResponse | null = await response.json();
        if (!data?.summary_kpis || !data.easa_notification || !data.provenance
          || !Array.isArray(data.hourly_capacity) || !Array.isArray(data.events) || !Array.isArray(data.node_analytics)) {
          errorMessage = 'The simulation returned incomplete results. Please try again.';
        } else {
          responseData = data;
        }
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      errorMessage = err instanceof Error && err.name === 'TimeoutError'
        ? 'The simulation took too long to respond. Please try again.'
        : `Failed to connect to simulation backend: ${errMessage}`;
    }

    // Decrement counter exactly once per dispatch using current state after body parsing settles:
    const currentState = get();
    const newPendingCount = Math.max(0, currentState.pendingRequestsCount - 1);
    const stillSimulating = newPendingCount > 0;

    // Stale response protection:
    // Only the latest request for the current inputs can publish results or errors:
    const isStillLatest = currentState.latestRequestId === requestId && currentState.inputRevision === requestRevision;

    if (!isStillLatest) {
      set({
        pendingRequestsCount: newPendingCount,
        isSimulating: stillSimulating,
        activeRunMode: stillSimulating ? get().activeRunMode : null,
      });
      return;
    }

    if (errorMessage) {
      set({
        pendingRequestsCount: newPendingCount,
        isSimulating: stillSimulating,
        activeRunMode: stillSimulating ? get().activeRunMode : null,
        backendError: errorMessage,
      });
      return;
    }

    if (responseData) {
      const engineLabel = responseData.provenance?.engine_label ?? 'Authoritative Engine';
      const repCount = responseData.replicates ?? (opts?.replicates ?? 1);
      const repTag = repCount > 1 ? ` · Monte Carlo (${repCount} Reps)` : '';
      set({
        simulationResult: responseData,
        isSimulating: stillSimulating,
        activeRunMode: stillSimulating ? get().activeRunMode : null,
        pendingRequestsCount: newPendingCount,
        backendError: null,
        lastSyncedAt: `${engineLabel}${repTag} (Rev #${requestRevision}) at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
      });
      if (responseData.run_id) {
        get().fetchRunApprovalStatus(responseData.run_id);
      }
    }
  },

  fetchTopologies: async () => {
    set({ topologyLoading: true });
    try {
      const res = await fetch('/api/topologies');
      if (res.ok) {
        const data = await res.json();
        set({ topologies: data.topologies || [], topologyLoading: false });
      } else {
        set({ topologyLoading: false });
      }
    } catch {
      set({ topologyLoading: false });
    }
  },

  openTopology: async (id: string, version?: number) => {
    set({ topologyLoading: true, topologyConflictError: null });
    try {
      const url = version != null
        ? `/api/topologies/${encodeURIComponent(id)}/versions/${version}`
        : `/api/topologies/${encodeURIComponent(id)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Failed to load topology' }));
        set({ topologyConflictError: err.detail || 'Could not load topology', topologyLoading: false });
        return false;
      }
      const data = await res.json();
      const canonical: CanonicalTopology = data.current_version_data ?? data;
      const simInput = canonicalTopologyToSimulationInput(canonical);

      const nextRev = get().inputRevision + 1;
      const simResult = runDiscreteEventSimulation({
        ...simInput,
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
        activeScenarioId: canonical.topology_id,
        currentTopologyId: canonical.topology_id,
        currentTopologyVersion: canonical.version,
        baselineMovementsPerHour: canonical.baseline_movements_per_hour,
        triggerHour: canonical.trigger_hour,
        horizonHours: canonical.horizon_hours,
        costPerDelayedMovement: canonical.cost_per_delayed_movement ?? 7500,
        nodes: simInput.nodes,
        edges: simInput.edges,
        selectedNodeId: simInput.nodes[0]?.id ?? null,
        simulationResult: simResult,
        inputRevision: nextRev,
        lastSyncedAt: `Topology Loaded (${canonical.name} v${canonical.version}) · Rev #${nextRev}`,
        topologyLoading: false,
        topologySuccessMessage: `Opened ${canonical.name} (v${canonical.version})`,
      });
      return true;
    } catch (e) {
      set({
        topologyLoading: false,
        topologyConflictError: e instanceof Error ? e.message : 'Failed to open topology',
      });
      return false;
    }
  },

  saveNewTopologyVersion: async (changeSummary: string) => {
    const state = get();
    const topologyId = state.currentTopologyId || state.activeScenarioId;
    const currentVersion = state.currentTopologyVersion || 1;
    set({ topologyLoading: true, topologyConflictError: null, topologySuccessMessage: null });

    const currentPreset = state.scenarios.find((s) => s.id === state.activeScenarioId) ?? state.scenarios[0];
    const baseCanonical = presetToCanonicalTopology(currentPreset);
    const canonical: CanonicalTopology = {
      ...baseCanonical,
      topology_id: topologyId,
      name: currentPreset.title,
      version: currentVersion + 1,
      baseline_movements_per_hour: state.baselineMovementsPerHour,
      trigger_hour: state.triggerHour,
      horizon_hours: state.horizonHours,
      cost_per_delayed_movement: state.costPerDelayedMovement,
      nodes: state.nodes.map((n) => ({ ...n })),
      dependencies: state.edges.map((e) => ({
        id: e.id,
        provider_node_id: e.source,
        dependent_node_id: e.target,
        coupling_weight: e.coupling_weight,
        propagation_mechanism: e.propagation_mechanism,
        protocol_layer: e.protocol_layer || 'IP/Ethernet',
        propagation_delay_hours: e.propagation_delay_hours ?? 0.25,
        dependency_type: e.dependency_type ?? 'REQUIRED',
        distance_weight: e.distance_weight ?? 1.0,
      })),
    };

    try {
      const res = await fetch(`/api/topologies/${encodeURIComponent(topologyId)}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical,
          change_summary: changeSummary || `Version update to v${currentVersion + 1}`,
          expected_version: currentVersion,
        }),
      });

      if (res.status === 409) {
        const err = await res.json().catch(() => ({ detail: 'Stale version conflict' }));
        set({
          topologyConflictError: `Conflict (HTTP 409): ${err.detail || 'Stale version detected. Another user or session has already updated this topology. Please reload before saving.'}`,
          topologyLoading: false,
        });
        return false;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Save failed' }));
        set({
          topologyConflictError: err.detail || `Save failed with status ${res.status}`,
          topologyLoading: false,
        });
        return false;
      }

      const saved = await res.json();
      const newVersion = saved.version ?? currentVersion + 1;
      set({
        currentTopologyId: topologyId,
        currentTopologyVersion: newVersion,
        topologyLoading: false,
        topologySuccessMessage: `Saved version v${newVersion} successfully: "${changeSummary}"`,
      });
      await get().fetchTopologies();
      return true;
    } catch (e) {
      set({
        topologyLoading: false,
        topologyConflictError: e instanceof Error ? e.message : 'Save request failed',
      });
      return false;
    }
  },

  cloneTopology: async (newName: string, topologyId?: string) => {
    const state = get();
    const targetId = topologyId || state.currentTopologyId || state.activeScenarioId;
    const currentVersion = state.currentTopologyVersion || 1;
    set({ topologyLoading: true, topologyConflictError: null, topologySuccessMessage: null });

    try {
      const res = await fetch(`/api/topologies/${encodeURIComponent(targetId)}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          new_name: newName,
          version: currentVersion,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Clone failed' }));
        set({
          topologyConflictError: err.detail || `Clone failed with status ${res.status}`,
          topologyLoading: false,
        });
        return false;
      }

      const cloned = await res.json();
      set({
        topologyLoading: false,
        topologySuccessMessage: `Successfully cloned "${cloned.summary.name}" (ID: ${cloned.summary.id}, origin: ${cloned.summary.cloned_from_id} v${cloned.summary.cloned_from_version})`,
      });
      await get().fetchTopologies();
      await get().openTopology(cloned.summary.id, 1);
      return true;
    } catch (e) {
      set({
        topologyLoading: false,
        topologyConflictError: e instanceof Error ? e.message : 'Clone request failed',
      });
      return false;
    }
  },

  uploadImportFile: async (file: File) => {
    set({ importLoading: true, importError: null });
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const res = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          content_base64: base64,
        }),
      });
      const data: ImportPreviewResponse = await res.json();
      set({
        importPreview: data,
        importLoading: false,
        importError: data.valid ? null : (data.errors[0]?.message || 'Import preview validation failed'),
      });
      return data.valid;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      set({
        importLoading: false,
        importError: msg,
      });
      return false;
    }
  },

  saveImportedTopology: async (name: string, confirmCycles?: boolean) => {
    const state = get();
    if (!state.importPreview?.preview_topology) {
      set({ importError: 'No valid import preview available to save.' });
      return false;
    }
    set({ importLoading: true, importError: null });
    try {
      const res = await fetch('/api/import/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canonical: state.importPreview.preview_topology,
          name: name || state.importPreview.preview_topology.name,
          confirm_cycles: Boolean(confirmCycles),
          change_summary: `Imported from ${state.importPreview.file_name}`,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Save failed' }));
        set({
          importLoading: false,
          importError: err.detail || `Save failed with status ${res.status}`,
        });
        return false;
      }

      const data = await res.json();
      set({
        importPreview: null,
        importLoading: false,
        importError: null,
        topologySuccessMessage: `Successfully saved and imported "${data.name}" (Version 1)`,
      });
      await get().fetchTopologies();
      await get().openTopology(data.id, 1);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      set({
        importLoading: false,
        importError: msg,
      });
      return false;
    }
  },

  clearImportPreview: () => set({ importPreview: null, importError: null }),

  fetchUserSession: async () => {
    try {
      const devRole = get().activeDevRole;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (devRole) headers['X-AeroCascade-Role'] = devRole;
      const res = await fetch('/api/auth/session', { headers });
      if (res.ok) {
        const data = await res.json();
        set({ userSession: data });
      }
    } catch {
      // Non-fatal if offline
    }
  },

  setActiveDevRole: async (role: string) => {
    set({ activeDevRole: role });
    await get().fetchUserSession();
    await get().fetchRunApprovalStatus();
  },

  fetchRunApprovalStatus: async (targetRunId?: string) => {
    const state = get();
    const runId = targetRunId || state.simulationResult?.run_id;
    if (!runId) {
      set({
        runApproval: null,
        runServerState: null,
      });
      return;
    }
    set({ dossierLoading: true });
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (state.activeDevRole) headers['X-AeroCascade-Role'] = state.activeDevRole;
      const res = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { headers });
      if (res.ok) {
        const data = await res.json();
        const isInputStale = state.inputRevision !== state.simulationResult?.provenance?.input_revision;
        const isVersionMismatch = data.topology_version !== (state.currentTopologyVersion ?? 1);
        set({
          runApproval: data.approval || null,
          runServerState: {
            isPersisted: true,
            isStale: isInputStale || isVersionMismatch,
            runSha256: data.run_sha256 || null,
            serverTopologyId: data.topology_id,
            serverTopologyVersion: data.topology_version,
            approvalStatus: data.approval_status,
            allApprovals: data.all_approvals || {},
          },
          dossierLoading: false,
        });
      } else if (res.status === 404) {
        set({
          runApproval: null,
          runServerState: {
            isPersisted: false,
            isStale: true,
            runSha256: null,
            serverTopologyId: null,
            serverTopologyVersion: null,
          },
          dossierLoading: false,
        });
      } else {
        set({ dossierLoading: false });
      }
    } catch {
      set({ dossierLoading: false });
    }
  },

  approveCurrentRun: async (signoffNotes: string, approverName?: string) => {
    if (!signoffNotes || !signoffNotes.trim()) {
      set({ dossierError: 'Sign-off notes are required for regulatory dossier approval.', dossierSuccessMessage: null });
      return false;
    }
    const state = get();
    const runId = state.simulationResult?.run_id;
    if (!runId) {
      set({
        dossierError: 'No persisted run ID found. Execute a simulation against a saved topology version before approving.',
        dossierSuccessMessage: null,
      });
      return false;
    }

    const isInputStale = state.inputRevision !== state.simulationResult?.provenance?.input_revision;
    if (isInputStale) {
      set({
        dossierError: 'Current workspace inputs have changed since this simulation was run. Re-run simulation against saved topology before sign-off.',
        dossierSuccessMessage: null,
      });
      return false;
    }

    set({ dossierLoading: true, dossierError: null, dossierSuccessMessage: null });
    const topologyId = state.currentTopologyId || state.simulationResult.scenario_id;
    const topologyVersion = state.currentTopologyVersion ?? 1;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (state.activeDevRole) {
        headers['X-AeroCascade-Role'] = state.activeDevRole;
      }

      const payload = {
        topology_id: topologyId,
        topology_version: topologyVersion,
        run_id: runId,
        signoff_notes: signoffNotes.trim(),
        approver_name: approverName?.trim() || state.userSession?.username || 'Designated Approver',
      };

      const res = await fetch('/api/dossier/approve', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (res.status === 403) {
        const currentRole = state.userSession?.role || state.activeDevRole;
        set({
          dossierLoading: false,
          dossierError: `Role denial: Current role '${currentRole}' is not authorized to sign off. Only Designated Approvers or Administrators may approve regulatory dossiers.`,
        });
        return false;
      }

      if (res.status === 409) {
        const errJson = await res.json().catch(() => ({}));
        const detail = errJson.detail || 'This run already has an approval recorded in the immutable audit log.';
        set({
          dossierLoading: false,
          dossierError: detail,
        });
        await state.fetchRunApprovalStatus(runId);
        return false;
      }

      if (res.status === 404) {
        set({
          dossierLoading: false,
          dossierError: 'Simulation run not found on server. Re-run simulation against a saved topology version before sign-off.',
        });
        return false;
      }

      if (res.status === 422) {
        const errJson = await res.json().catch(() => ({}));
        set({
          dossierLoading: false,
          dossierError: errJson.detail || 'A saved topology version and persisted run ID are required for approval.',
        });
        return false;
      }

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        set({
          dossierLoading: false,
          dossierError: errJson.detail || `Approval failed with HTTP ${res.status}.`,
        });
        return false;
      }

      const resData = await res.json();
      set({
        dossierLoading: false,
        dossierSuccessMessage: 'Simulation run successfully approved as an internal compliance record. Run integrity check verified.',
        runApproval: resData.approval || null,
      });
      await get().fetchRunApprovalStatus(runId);
      return true;
    } catch (err) {
      set({
        dossierLoading: false,
        dossierError: `Network error connecting to approval service: ${err instanceof Error ? err.message : String(err)}`,
      });
      return false;
    }
  },

  downloadEvidenceJson: async () => {
    const state = get();
    const runId = state.simulationResult?.run_id;
    if (!runId) {
      set({ dossierError: 'No run ID available for evidence export.' });
      return false;
    }
    const topologyId = state.currentTopologyId || state.simulationResult.scenario_id;
    const topologyVersion = state.currentTopologyVersion ?? 1;

    set({ dossierLoading: true, dossierError: null });
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (state.activeDevRole) {
        headers['X-AeroCascade-Role'] = state.activeDevRole;
      }
      const res = await fetch(
        `/api/export/dossier?topology_id=${encodeURIComponent(topologyId)}&topology_version=${topologyVersion}&run_id=${encodeURIComponent(runId)}`,
        { headers }
      );

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        set({
          dossierLoading: false,
          dossierError: errJson.detail || `Export failed with HTTP ${res.status}.`,
        });
        return false;
      }

      const data = await res.json();
      if (typeof document !== 'undefined' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `aerocascade-evidence-${runId}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      set({ dossierLoading: false });
      return true;
    } catch (err) {
      set({
        dossierLoading: false,
        dossierError: `Network error downloading evidence JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      return false;
    }
  },

  clearDossierMessages: () => set({ dossierError: null, dossierSuccessMessage: null }),
}));

if (typeof window !== 'undefined') {
  useCascadeStore.subscribe((state, previous) => {
    if (state.nodes === previous.nodes && state.activeScenarioId === previous.activeScenarioId
      && state.baselineMovementsPerHour === previous.baselineMovementsPerHour
      && state.triggerHour === previous.triggerHour
      && state.costPerDelayedMovement === previous.costPerDelayedMovement
      && state.disruptionCurrency === previous.disruptionCurrency
      && state.costPerFlightHour === previous.costPerFlightHour
      && state.implementationCost === previous.implementationCost
      && state.initialQueueBacklog === previous.initialQueueBacklog) return;
    try {
      if (!workspaceStorage) throw new Error('Storage unavailable');
      workspaceStorage.setItem(WORKSPACE_STORAGE_KEY, serializeWorkspace(state));
      useCascadeStore.setState({ workspaceSaveStatus: 'saved' });
    } catch {
      useCascadeStore.setState({ workspaceSaveStatus: 'unavailable' });
    }
  });
}
