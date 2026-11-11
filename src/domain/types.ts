/**
 * AeroCascade — Strict Domain Types
 * Grounded in "Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations"
 * (Aggarwal & Dhillon, AIAA Aviation 2026) and Dhillon & Moores (2001) Tripartite Controls.
 */

export const CascadeStage = {
  STAGE_1_TRIGGER: 'STAGE_1_TRIGGER',
  STAGE_2_PROPAGATION: 'STAGE_2_PROPAGATION',
  STAGE_3_BLOCKER: 'STAGE_3_BLOCKER',
} as const;
export type CascadeStage = (typeof CascadeStage)[keyof typeof CascadeStage];

export const ControlCategory = {
  TECHNICAL: 'TECHNICAL',
  FORMAL: 'FORMAL',
  INFORMAL: 'INFORMAL',
} as const;
export type ControlCategory = (typeof ControlCategory)[keyof typeof ControlCategory];

export const PSOELevel = {
  NOT_ASSESSED: 'NOT_ASSESSED',
  NOT_PRESENT: 'NOT_PRESENT',
  PRESENT: 'PRESENT',
  SUITABLE: 'SUITABLE',
  OPERATIONAL: 'OPERATIONAL',
  EFFECTIVE: 'EFFECTIVE',
} as const;
export type PSOELevel = (typeof PSOELevel)[keyof typeof PSOELevel];

export const ER040Severity = {
  CATASTROPHIC_1: '1_CATASTROPHIC',
  HAZARDOUS_2: '2_HAZARDOUS',
  MAJOR_3: '3_MAJOR',
  MINOR_4: '4_MINOR',
  NO_SAFETY_EFFECT_5: '5_NO_SAFETY_EFFECT',
} as const;
export type ER040Severity = (typeof ER040Severity)[keyof typeof ER040Severity];

export interface TripartiteControls {
  /** Technical Controls (0-100): Encryption, packet inspection, PTP/GNSS authentication, hardware interlocks */
  technical: number;
  /** Formal Controls (0-100): EASA Part-IS SOPs, reversion rules, SLA escalation playbooks, regulatory mandates */
  formal: number;
  /** Informal Controls (0-100): ATCO cognitive trust calibration, tacit team norms, safety culture, out-of-band verification */
  informal: number;
}

export interface FMEAMetrics {
  /** Likelihood of occurrence/exploit (1-5) */
  likelihood: number;
  /** Operational & safety impact severity (1-5) */
  impact: number;
  /** Recovery & synchronization complexity (1-5) */
  recovery_complexity: number;
  /** Policy & capital investment allocation (0-100) */
  policy_investment: number;
}

export interface SystemNodeModel {
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
  mitigation_recommendation: string;
  repair_duration_hours?: number;
  requires_authorization?: boolean;
  authorization_delay_hours?: number;
  required_technicians?: number;
  redundancy_group?: string;
  is_primary?: boolean;
  failover_delay_hours?: number;
}

export interface DependencyEdgeModel {
  id: string;
  source: string;
  target: string;
  coupling_weight: number;
  propagation_mechanism: string;
  protocol_layer: string;
  propagation_delay_hours?: number;
  dependency_type?: string;
  distance_weight?: number;
}

export interface RedundancyGroupConfig {
  group_id: string;
  primary_node_id: string;
  backup_node_ids: string[];
  failover_delay_hours: number;
  degraded_capacity_factor: number;
}

export interface AirportService {
  service_id: string;
  name: string;
  required_node_ids: string[];
  redundancy_group_id?: string;
  criticality_weight: number;
  degraded_availability_factor: number;
}

export interface InitiatingEvent {
  event_id?: string;
  node_id: string;
  event_time_hours: number;
  failure_mode?: string;
  parent_event_id?: string | null;
}

export interface RecoveryMetrics {
  recovered: boolean;
  recovery_time_hours: number | null;
  threshold_capacity: number;
  sustained_duration_hours: number;
  is_censored: boolean;
  censored_reason?: string | null;
}

export interface ScenarioPreset {
  id: string;
  title: string;
  subtitle: string;
  aerodrome_profile: string;
  baseline_movements_per_hour: number;
  trigger_hour: number;
  horizon_hours: number;
  abstract: string;
  nodes: SystemNodeModel[];
  edges: DependencyEdgeModel[];
}

export interface DiscreteEventRecord {
  event_id: string;
  timestamp_hours: number;
  formatted_time: string;
  stage: CascadeStage;
  node_id: string;
  node_code: string;
  node_label: string;
  dominant_control: ControlCategory;
  event_type: string;
  narrative: string;
  capacity_impact_pct: number;
  residual_rpn: number;
  parent_event_id?: string | null;
  causal_reason?: string;
  state_from?: string;
  state_to?: string;
}

export interface HourlyCapacityPoint {
  hour: number;
  time_label: string;
  baseline_capacity: number;
  unmitigated_capacity: number;
  technical_only_capacity: number;
  tripartite_mitigated_capacity: number;
  active_stage: string;
  /** Estimated lost movement capacity (hourly deficit integral), formerly labeled delayed flights */
  estimated_lost_capacity_cumulative: number;
  /** Backward-compatible alias for estimated_lost_capacity_cumulative */
  delayed_flights_cumulative: number;
  /** Monte Carlo 50th percentile (median) capacity when replicates > 1 */
  capacity_median?: number | null;
  /** Monte Carlo 5th percentile capacity when replicates > 1 */
  capacity_5th?: number | null;
  /** Monte Carlo 95th percentile capacity when replicates > 1 */
  capacity_95th?: number | null;
}

export interface HourlyCapacityPercentiles {
  hour: number;
  time_label: string;
  baseline_capacity: number;
  capacity_median: number;
  capacity_5th: number;
  capacity_95th: number;
}

export interface ResultProvenance {
  engine: 'browser-typescript' | 'server-typescript' | 'fastapi-python';
  engine_label: string;
  model_version: string;
  input_revision: number;
  replicates?: number;
  generated_at: string;
  is_fallback: boolean;
  fallback_reason?: string;
}

export interface NodeCentralityMetric {
  node_id: string;
  node_code: string;
  label: string;
  stage: CascadeStage;
  dominant_control: ControlCategory;
  betweenness_centrality: number;
  in_degree_vulnerability: number;
  out_degree_blast_radius: number;
  chokepoint_index: number;
  raw_rpn: number;
  /** Adjusted risk score after tripartite controls damping (0 <= adjusted <= raw) */
  residual_rpn: number;
  /** Alias for residual_rpn */
  adjusted_risk_score?: number;
  policy_investment: number;
  investment_efficiency_gap: number;
  psoe_status: PSOELevel;
  er040_severity: ER040Severity;
  direct_in_degree?: number;
  direct_out_degree?: number;
  downstream_reachable_nodes?: number;
  downstream_reachability_ratio?: number;
}

export interface EASAPartISReportingStage {
  stage_name: string;
  legal_basis: string;
  timing_rule: string;
  status: string;
  notes: string;
}

export interface EASAPartISNotification {
  report_id: string;
  /** Combined regulatory references list */
  regulation_basis: string[];
  /** Statutory binding EU regulations */
  statutory_regulations: string[];
  /** Voluntary industry standards & guidance */
  voluntary_standards: string[];
  reporting_entity: string;
  initial_notification_deadline_hours: number;
  incident_classification: string;
  er040_risk_class: string;
  affected_assets: string[];
  stage_1_technical_root_cause: string;
  stage_2_operational_propagation: string;
  stage_3_governance_recovery_blocker: string;
  psoe_maturity_summary: Record<string, PSOELevel>;
  /** Proposed containment actions (illustrative recommendations, not legal mandates) */
  containment_actions: string[];
  /** Proposed structural remediations (illustrative recommendations, not legal mandates) */
  structural_remediations: string[];
  /** Exercise Draft flag confirming non-submission status */
  is_exercise_draft: boolean;
  reporting_applicability: string;
  awareness_time: string;
  official_guidance_url: string;
  reporting_stages: EASAPartISReportingStage[];
}

export interface SimulationSummaryKPIs {
  mean_raw_rpn: number;
  mean_residual_rpn: number;
  mean_adjusted_risk?: number;
  min_hourly_capacity: number;
  capacity_retention_pct: number;
  recovery_window_hours: number;
  /** Total estimated lost movement capacity across the horizon (deficit integral) */
  total_disrupted_movements: number;
  estimated_lost_movement_capacity?: number;
  /** Average control score across Technical, Formal, and Informal dimensions (0-100) */
  average_control_score: number;
  /** Backward-compatible alias for average_control_score */
  tripartite_balance_index: number;
  top_chokepoint_code: string;
  top_chokepoint_score: number;
}

export interface SimulationResponse {
  scenario_id: string;
  model_version?: string;
  schema_version?: string;
  run_id?: string;
  input_hash?: string;
  parameter_set_version?: string;
  random_seed?: number;
  replicates?: number;
  summary_kpis: SimulationSummaryKPIs;
  events: DiscreteEventRecord[];
  hourly_capacity: HourlyCapacityPoint[];
  stochastic_capacity?: HourlyCapacityPercentiles[];
  capacity_median?: number[];
  capacity_5th?: number[];
  capacity_95th?: number[];
  node_analytics: NodeCentralityMetric[];
  easa_notification: EASAPartISNotification;
  recovery_metrics?: RecoveryMetrics;
  provenance: ResultProvenance;
  input_snapshot?: Record<string, unknown>;
}

export interface SimulationRequestPayload {
  scenario_id: string;
  horizon_hours?: number;
  baseline_movements_per_hour?: number;
  trigger_hour?: number;
  random_seed?: number;
  replicates?: number;
  nodes: SystemNodeModel[];
  edges: DependencyEdgeModel[];
  initiating_events?: InitiatingEvent[];
  services?: AirportService[];
  redundancy_groups?: RedundancyGroupConfig[];
  num_technicians?: number;
  recovery_threshold_pct?: number;
  recovery_sustained_hours?: number;
  staffed_operation_fraction?: number;
  input_revision?: number;
}
