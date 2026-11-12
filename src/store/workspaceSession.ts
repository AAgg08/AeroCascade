import { SCENARIO_PRESETS } from '../domain/scenarios.ts';
import { PSOELevel, type FMEAMetrics, type SystemNodeModel, type TripartiteControls } from '../domain/types.ts';

export const MAX_WORKSPACE_FILE_SIZE = 100_000;
export const WORKSPACE_STORAGE_KEY = 'aerocascade.workspace.v1';

export interface WorkspaceSettings {
  activeScenarioId: string;
  baselineMovementsPerHour: number;
  triggerHour: number;
  costPerDelayedMovement: number;
  disruptionCurrency?: string;
  costPerFlightHour?: number | null;
  implementationCost?: number | null;
  initialQueueBacklog?: number;
  nodes: SystemNodeModel[];
}

interface SavedNode {
  id: string;
  tripartite: TripartiteControls;
  fmea: FMEAMetrics;
  psoe_status: PSOELevel;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function inRange(value: unknown, min: number, max: number, integer = false): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= min && value <= max && (!integer || Number.isInteger(value));
}

export function parseWorkspace(text: string): WorkspaceSettings | null {
  try {
    if (text.length > MAX_WORKSPACE_FILE_SIZE) return null;
    const value: unknown = JSON.parse(text);
    if (!record(value) || value.version !== 1) return null;
    const preset = SCENARIO_PRESETS.find((scenario) => scenario.id === value.activeScenarioId);
    if (!preset || !inRange(value.baselineMovementsPerHour, 12, 120, true)
      || !inRange(value.triggerHour, 0, Math.min(12, preset.horizon_hours - 1), true)
      || !inRange(value.costPerDelayedMovement, 0, Number.MAX_SAFE_INTEGER)
      || !Array.isArray(value.nodes) || value.nodes.length !== preset.nodes.length) return null;

    const settings = new Map<string, SavedNode>();
    for (const node of value.nodes) {
      if (!record(node) || typeof node.id !== 'string' || settings.has(node.id)
        || !preset.nodes.some((candidate) => candidate.id === node.id)
        || !record(node.tripartite) || !record(node.fmea)
        || !Object.values(PSOELevel).includes(node.psoe_status as PSOELevel)) return null;
      const controls = node.tripartite;
      const fmea = node.fmea;
      if (!inRange(controls.technical, 0, 100) || !inRange(controls.formal, 0, 100)
        || !inRange(controls.informal, 0, 100)
        || !inRange(fmea.likelihood, 1, 5, true) || !inRange(fmea.impact, 1, 5, true)
        || !inRange(fmea.recovery_complexity, 1, 5, true)
        || !inRange(fmea.policy_investment, 0, 100)) return null;
      settings.set(node.id, {
        id: node.id,
        tripartite: { technical: controls.technical, formal: controls.formal, informal: controls.informal },
        fmea: { likelihood: fmea.likelihood, impact: fmea.impact, recovery_complexity: fmea.recovery_complexity, policy_investment: fmea.policy_investment },
        psoe_status: node.psoe_status as PSOELevel,
      });
    }
    const res: WorkspaceSettings = {
      activeScenarioId: preset.id,
      baselineMovementsPerHour: value.baselineMovementsPerHour,
      triggerHour: value.triggerHour,
      costPerDelayedMovement: value.costPerDelayedMovement,
      nodes: structuredClone(preset.nodes).map((node) => ({ ...node, ...settings.get(node.id)! })),
    };
    if (typeof value.disruptionCurrency === 'string' && value.disruptionCurrency.trim().length > 0) {
      res.disruptionCurrency = value.disruptionCurrency.trim().toUpperCase();
    }
    if (value.costPerFlightHour !== undefined && (value.costPerFlightHour === null || inRange(value.costPerFlightHour, 0, Number.MAX_SAFE_INTEGER))) {
      res.costPerFlightHour = value.costPerFlightHour;
    }
    if (value.implementationCost !== undefined && (value.implementationCost === null || inRange(value.implementationCost, 0, Number.MAX_SAFE_INTEGER))) {
      res.implementationCost = value.implementationCost;
    }
    if (inRange(value.initialQueueBacklog, 0, 10000)) {
      res.initialQueueBacklog = value.initialQueueBacklog;
    }
    return res;
  } catch {
    return null;
  }
}

export function serializeWorkspace(settings: WorkspaceSettings): string {
  const payload: Record<string, unknown> = {
    version: 1,
    activeScenarioId: settings.activeScenarioId,
    baselineMovementsPerHour: settings.baselineMovementsPerHour,
    triggerHour: settings.triggerHour,
    costPerDelayedMovement: settings.costPerDelayedMovement,
    nodes: settings.nodes.map(({ id, tripartite, fmea, psoe_status }) => ({ id, tripartite, fmea, psoe_status })),
  };
  if (settings.disruptionCurrency !== undefined) payload.disruptionCurrency = settings.disruptionCurrency;
  if (settings.costPerFlightHour !== undefined) payload.costPerFlightHour = settings.costPerFlightHour;
  if (settings.implementationCost !== undefined) payload.implementationCost = settings.implementationCost;
  if (settings.initialQueueBacklog !== undefined) payload.initialQueueBacklog = settings.initialQueueBacklog;
  return JSON.stringify(payload);
}

export function loadWorkspace(storage: Pick<Storage, 'getItem'> | undefined) {
  if (!storage) return { settings: null, status: 'unavailable' as const };
  try {
    const text = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (text === null) return { settings: null, status: 'none' as const };
    const settings = parseWorkspace(text);
    return { settings, status: settings ? 'restored' as const : 'invalid' as const };
  } catch {
    return { settings: null, status: 'unavailable' as const };
  }
}
