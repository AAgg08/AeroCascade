/**
 * AeroCascade — Canonical Topology Domain Specification and Adapters
 *
 * Provides a versioned canonical topology representation with:
 * - Stable node and dependency IDs
 * - Explicit provider-to-dependent edge directions (provider_node_id -> dependent_node_id)
 * - Source provenance metadata
 * - Single adapter converting CanonicalTopology to SimulationInputParams
 * - Full backward compatibility with existing ScenarioPresets and WorkspaceSettings
 */

import {
  CascadeStage,
  ControlCategory,
  ER040Severity,
  PSOELevel,
  type AirportService,
  type DependencyEdgeModel,
  type FMEAMetrics,
  type RedundancyGroupConfig,
  type ScenarioPreset,
  type SystemNodeModel,
  type TripartiteControls,
} from './types.ts';
import type { SimulationInputParams } from './simulationEngine.ts';
import type { WorkspaceSettings } from '../store/workspaceSession.ts';

export interface CanonicalSourceProvenance {
  author: string;
  citation: string;
  source_document: string;
  synthetic_fixture: boolean;
  origin_scenario_id?: string | null;
  cloned_from_id?: string | null;
  cloned_from_version?: number | null;
  created_at: string;
}

export interface CanonicalNode {
  id: string;
  code: string;
  label: string;
  subsystem: string;
  stage: CascadeStage;
  dominant_control: ControlCategory;
  description: string;
  failure_mode: string;
  tripartite: TripartiteControls;
  fmea: FMEAMetrics;
  psoe_status: PSOELevel;
  er040_severity: ER040Severity;
  base_latency_minutes: number;
  repair_duration_hours?: number;
  requires_authorization?: boolean;
  authorization_delay_hours?: number;
  required_technicians?: number;
  redundancy_group?: string | null;
  is_primary?: boolean;
  failover_delay_hours?: number;
  degraded_capacity_factor?: number;
  mitigation_recommendation: string;
}

export interface CanonicalDependency {
  id: string;
  /** Explicit provider / source node supplying signal, power, or operational data */
  provider_node_id: string;
  /** Explicit dependent / target node consuming provider services, impacted on upstream failure */
  dependent_node_id: string;
  coupling_weight: number;
  propagation_mechanism: string;
  protocol_layer: string;
  propagation_delay_hours?: number;
  dependency_type?: string;
  distance_weight?: number;
}

export interface CanonicalTopology {
  schema_version: '1.0.0';
  topology_id: string;
  name: string;
  description: string;
  version: number;
  aerodrome_profile: string;
  baseline_movements_per_hour: number;
  trigger_hour: number;
  horizon_hours: number;
  cost_per_delayed_movement: number;
  source_provenance: CanonicalSourceProvenance;
  nodes: CanonicalNode[];
  dependencies: CanonicalDependency[];
  services?: AirportService[];
  redundancy_groups?: Record<string, RedundancyGroupConfig>;
}

export interface ImportErrorDetail {
  row?: number | null;
  column?: string | null;
  message: string;
  source_ref?: string | null;
  severity: 'ERROR' | 'WARNING';
}

export interface ImportSummary {
  node_count: number;
  edge_count: number;
  error_count: number;
  warning_count: number;
  cycle_count: number;
  provisional_id_count: number;
  deduplicated_edge_count: number;
}

export interface ImportPreviewResponse {
  valid: boolean;
  file_name: string;
  file_type: string;
  summary: ImportSummary;
  errors: ImportErrorDetail[];
  warnings: ImportErrorDetail[];
  cycles: string[];
  cycle_handling_explanation?: string | null;
  preview_topology?: CanonicalTopology | null;
}

/**
 * Single authoritative client adapter:
 * Converts a CanonicalTopology to the SimulationInputParams consumed by the simulation engine.
 * Maps:
 *   dep.provider_node_id -> edge.source
 *   dep.dependent_node_id -> edge.target
 */
export function canonicalTopologyToSimulationInput(
  canonical: CanonicalTopology,
  overrides?: Partial<SimulationInputParams>
): SimulationInputParams {
  const nodes: SystemNodeModel[] = canonical.nodes.map((n) => ({
    id: n.id,
    code: n.code,
    label: n.label,
    subsystem: n.subsystem,
    stage: n.stage,
    dominant_control: n.dominant_control,
    description: n.description,
    failure_mode: n.failure_mode,
    tripartite: { ...n.tripartite },
    fmea: { ...n.fmea },
    psoe_status: n.psoe_status,
    er040_severity: n.er040_severity,
    base_latency_minutes: n.base_latency_minutes,
    mitigation_recommendation: n.mitigation_recommendation,
    repair_duration_hours: n.repair_duration_hours ?? 2.0,
    requires_authorization: n.requires_authorization ?? false,
    authorization_delay_hours: n.authorization_delay_hours ?? 0.0,
    required_technicians: n.required_technicians ?? 1,
    redundancy_group: n.redundancy_group ?? undefined,
    is_primary: n.is_primary ?? true,
    failover_delay_hours: n.failover_delay_hours ?? 0.05,
    degraded_capacity_factor: n.degraded_capacity_factor ?? 0.5,
  }));

  const edges: DependencyEdgeModel[] = canonical.dependencies.map((d) => ({
    id: d.id,
    source: d.provider_node_id,
    target: d.dependent_node_id,
    coupling_weight: d.coupling_weight,
    propagation_mechanism: d.propagation_mechanism,
    protocol_layer: d.protocol_layer,
    propagation_delay_hours: d.propagation_delay_hours ?? 0.25,
    dependency_type: d.dependency_type ?? 'REQUIRED',
    distance_weight: d.distance_weight ?? 1.0,
  }));

  return {
    scenario_id: canonical.topology_id,
    horizon_hours: canonical.horizon_hours,
    baseline_movements_per_hour: canonical.baseline_movements_per_hour,
    trigger_hour: canonical.trigger_hour,
    nodes,
    edges,
    ...overrides,
  };
}

/**
 * Adapter converting existing ScenarioPreset into CanonicalTopology.
 */
export function presetToCanonicalTopology(preset: ScenarioPreset): CanonicalTopology {
  return {
    schema_version: '1.0.0',
    topology_id: preset.id,
    name: preset.title,
    description: preset.abstract || preset.subtitle,
    version: 1,
    aerodrome_profile: preset.aerodrome_profile,
    baseline_movements_per_hour: preset.baseline_movements_per_hour,
    trigger_hour: preset.trigger_hour,
    horizon_hours: preset.horizon_hours,
    cost_per_delayed_movement: 7500,
    source_provenance: {
      author: 'Aryan Aggarwal & Gurpreet Dhillon',
      citation:
        'Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations (AIAA Aviation 2026)',
      source_document: 'AIAA 2026 / EUROCAE ER-040 synthetic case study',
      synthetic_fixture: true,
      origin_scenario_id: preset.id,
      created_at: new Date().toISOString(),
    },
    nodes: preset.nodes.map((n) => ({ ...n })),
    dependencies: preset.edges.map((e) => ({
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
    services: (preset as { services?: AirportService[] }).services ? [...(preset as { services?: AirportService[] }).services!] : [],
    redundancy_groups: (preset as { redundancy_groups?: Record<string, RedundancyGroupConfig> }).redundancy_groups ? { ...(preset as { redundancy_groups?: Record<string, RedundancyGroupConfig> }).redundancy_groups } : {},
  };
}

/**
 * Adapter converting browser WorkspaceSettings into CanonicalTopology.
 */
export function workspaceSettingsToCanonicalTopology(
  settings: WorkspaceSettings,
  preset: ScenarioPreset,
  topologyId = `ws-${settings.activeScenarioId}`,
  version = 1
): CanonicalTopology {
  const baseCanonical = presetToCanonicalTopology(preset);
  return {
    ...baseCanonical,
    topology_id: topologyId,
    name: `${preset.title} (Workspace)`,
    version,
    baseline_movements_per_hour: settings.baselineMovementsPerHour,
    trigger_hour: settings.triggerHour,
    cost_per_delayed_movement: settings.costPerDelayedMovement,
    nodes: settings.nodes.map((n) => ({ ...n })),
  };
}
