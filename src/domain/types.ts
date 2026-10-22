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
}

export interface DependencyEdgeModel {
  id: string;
  source: string;
  target: string;
  coupling_weight: number;
  propagation_mechanism: string;
  protocol_layer: string;
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
}

export interface HourlyCapacityPoint {
  hour: number;
  time_label: string;
  baseline_capacity: number;
  unmitigated_capacity: number;
  technical_only_capacity: number;
  tripartite_mitigated_capacity: number;
  active_stage: string;
  delayed_flights_cumulative: number;
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
  residual_rpn: number;
  policy_investment: number;
  investment_efficiency_gap: number;
  psoe_status: PSOELevel;
  er040_severity: ER040Severity;
}

export interface EASAPartISNotification {
  report_id: string;
  regulation_basis: string[];
  reporting_entity: string;
  initial_notification_deadline_hours: number;
  incident_classification: string;
  er040_risk_class: string;
  affected_assets: string[];
  stage_1_technical_root_cause: string;
  stage_2_operational_propagation: string;
  stage_3_governance_recovery_blocker: string;
  psoe_maturity_summary: Record<string, PSOELevel>;
  containment_actions: string[];
  structural_remediations: string[];
}

export interface SimulationSummaryKPIs {
  mean_raw_rpn: number;
  mean_residual_rpn: number;
  min_hourly_capacity: number;
  capacity_retention_pct: number;
  recovery_window_hours: number;
  total_disrupted_movements: number;
  tripartite_balance_index: number;
  top_chokepoint_code: string;
  top_chokepoint_score: number;
}

export interface SimulationResponse {
  scenario_id: string;
  summary_kpis: SimulationSummaryKPIs;
  events: DiscreteEventRecord[];
  hourly_capacity: HourlyCapacityPoint[];
  node_analytics: NodeCentralityMetric[];
  easa_notification: EASAPartISNotification;
}
