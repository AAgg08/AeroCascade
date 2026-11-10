import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Download, Printer } from 'lucide-react';
import {
  calculateRawRPN,
  computeResidualRPN,
  evaluateNodePSOE,
} from '../domain/simulationEngine.ts';
import { PSOELevel } from '../domain/types.ts';
import { useCascadeStore } from '../store/useCascadeStore.ts';

const PSOE_STEPS: PSOELevel[] = [
  PSOELevel.NOT_PRESENT,
  PSOELevel.PRESENT,
  PSOELevel.SUITABLE,
  PSOELevel.OPERATIONAL,
  PSOELevel.EFFECTIVE,
];

export function EASAComplianceView() {
  const { nodes, simulationResult } = useCascadeStore();
  const printContainerRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printContainerRef,
    documentTitle: `${simulationResult.easa_notification.report_id}_EXERCISE_DRAFT`,
  });

  const handleDownloadJson = () => {
    const payload = {
      exercise_status: 'SIMULATION_EXERCISE_DRAFT',
      submission_notice:
        'This JSON export is a research simulation draft and does NOT constitute an officially accepted submission format by EASA or any national competent authority.',
      official_reference:
        'https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-information-security?erules-id=ERULES-1963177438-19981',
      generated_at: new Date().toISOString(),
      run_id: simulationResult.run_id,
      input_hash: simulationResult.input_hash,
      model_version: simulationResult.model_version,
      schema_version: simulationResult.schema_version,
      provenance: simulationResult.provenance,
      recovery_metrics: simulationResult.recovery_metrics,
      input_snapshot: simulationResult.input_snapshot,
      reporting_applicability: simulationResult.easa_notification.reporting_applicability,
      awareness_time: simulationResult.easa_notification.awareness_time,
      easa_part_is_notification: simulationResult.easa_notification,
      summary_kpis: simulationResult.summary_kpis,
      risk_register: simulationResult.node_analytics,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${simulationResult.easa_notification.report_id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const notification = simulationResult.easa_notification;

  return (
    <div className="space-y-6">
      {/* Top Action Bar */}
      <section
        aria-label="Regulatory Dossier Export Actions"
        className="no-print flex flex-col gap-4 rounded-md border border-slate-800 bg-[#111827] p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-cyan-400 font-semibold">
              SIMULATION EXERCISE DRAFT · ILLUSTRATIVE REGULATORY MAPPING
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-800/80 bg-amber-950/60 text-amber-300">
              NOT AN OFFICIAL FILING
            </span>
          </div>
          <h2 className="mt-0.5 text-base font-bold text-slate-100">
            Aviation Information Security Incident Simulation Exercise Dossier &amp; Risk Register
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-slate-500 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Exercise JSON</span>
          </button>
          <button
            type="button"
            onClick={() => handlePrint()}
            className="inline-flex items-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print Exercise Dossier</span>
          </button>
        </div>
      </section>

      {/* Printable Regulatory Dossier Container */}
      <div ref={printContainerRef} className="space-y-6">
        {/* Section 1: EASA Part-IS Incident Exercise Header */}
        <section
          aria-label="EASA Part-IS Notification Form"
          className="rounded-md border border-slate-800 bg-[#111827] p-6"
        >
          <div className="flex flex-col gap-4 border-b border-slate-800 pb-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-mono text-amber-400 font-semibold">
                EXERCISE DRAFT · SUBJECT TO ORGANIZATIONAL IS.I.OR.230 DETERMINATION
              </div>
              <h3 className="mt-1 text-lg font-bold text-slate-100">
                {notification.report_id}
              </h3>
              <p className="mt-0.5 text-xs text-slate-400">
                Reporting Entity: {notification.reporting_entity}
              </p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400">
                <span>Applicability: <span className="text-slate-300">{notification.reporting_applicability}</span></span>
                <span>Awareness Time: <span className="text-slate-300">{notification.awareness_time}</span></span>
              </div>
            </div>
            <div className="text-xs font-mono text-slate-300 space-y-1 lg:text-right">
              <div>{notification.incident_classification}</div>
              <div className="text-amber-300 font-semibold">{notification.er040_risk_class}</div>
              <div className="text-[11px] text-slate-400">
                Official Guidance:{' '}
                <a
                  href={notification.official_guidance_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 underline hover:text-cyan-300"
                >
                  EASA Easy Access Rules Part-IS
                </a>
              </div>
            </div>
          </div>

          {/* Three-Stage Notification Timeline (EASA IS.I.OR.230) */}
          <div className="mt-4 border-b border-slate-800 pb-4">
            <div className="font-mono text-[11px] font-semibold text-slate-300 mb-2">
              EASA PART-IS IS.I.OR.230 MANDATED REPORTING WORKFLOW
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
                <div className="font-mono text-[10px] text-cyan-400 font-semibold">STAGE 1: INITIAL NOTIFICATION</div>
                <div className="mt-1 font-medium text-slate-200">Without Undue Delay</div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Notify competent authority and relevant stakeholders as soon as the security condition becomes known and represents potential safety impact.
                </p>
              </div>
              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
                <div className="font-mono text-[10px] text-amber-400 font-semibold">STAGE 2: INITIAL REPORT</div>
                <div className="mt-1 font-medium text-slate-200">Within 72 Hours Max</div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Submit initial report as soon as possible, in any case within 72h of awareness, unless exceptional circumstances prevent it.
                </p>
              </div>
              <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
                <div className="font-mono text-[10px] text-emerald-400 font-semibold">STAGE 3: FOLLOW-UP REPORT</div>
                <div className="mt-1 font-medium text-slate-200">Post-Investigation</div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Detailed technical analysis, root-cause assessment, and structural remediation commitments once investigation concludes.
                </p>
              </div>
            </div>
          </div>

          {/* Statutory Regulations vs Voluntary Standards */}
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 border-b border-slate-800 pb-4 text-xs">
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
              <div className="font-mono text-[10px] text-cyan-400 font-semibold uppercase">
                STATUTORY BINDING EU REGULATIONS
              </div>
              <ul className="mt-1.5 space-y-1 text-slate-300 list-disc list-inside">
                {(notification.statutory_regulations?.length
                  ? notification.statutory_regulations
                  : [
                      'Commission Delegated Regulation (EU) 2022/1645 (Part-IS.D)',
                      'Commission Implementing Regulation (EU) 2023/203 (Part-IS.I, including IS.I.OR.230)',
                    ]
                ).map((reg, idx) => (
                  <li key={idx} className="leading-relaxed font-medium">{reg}</li>
                ))}
              </ul>
            </div>
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-3">
              <div className="font-mono text-[10px] text-slate-400 font-semibold uppercase">
                VOLUNTARY INDUSTRY STANDARDS &amp; GUIDANCE
              </div>
              <ul className="mt-1.5 space-y-1 text-slate-300 list-disc list-inside">
                {(notification.voluntary_standards?.length
                  ? notification.voluntary_standards
                  : [
                      'EUROCAE ED-202A / ER-040 Information Security Management Guidelines (Voluntary Guidance)',
                    ]
                ).map((std, idx) => (
                  <li key={idx} className="leading-relaxed font-medium">{std}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Three-Stage Root Cause & Blocker Breakdown */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3 text-xs">
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-4">
              <div className="font-mono text-[11px] font-semibold text-cyan-400">
                ● STAGE 1: TECHNICAL INGRESS VECTOR
              </div>
              <p className="mt-1.5 text-slate-300 leading-relaxed">
                {notification.stage_1_technical_root_cause}
              </p>
            </div>
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-4">
              <div className="font-mono text-[11px] font-semibold text-amber-400">
                ▲ STAGE 2: OPERATIONAL FRAGILITY PROPAGATION
              </div>
              <p className="mt-1.5 text-slate-300 leading-relaxed">
                {notification.stage_2_operational_propagation}
              </p>
            </div>
            <div className="rounded border border-slate-800 bg-[#0B0F17] p-4">
              <div className="font-mono text-[11px] font-semibold text-rose-400">
                ✖ STAGE 3: FORMAL &amp; INFORMAL RECOVERY BLOCKER
              </div>
              <p className="mt-1.5 text-slate-300 leading-relaxed">
                {notification.stage_3_governance_recovery_blocker}
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Illustrative 5x5 Screening Matrix + PSOE Maturity Estimates */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          {/* Illustrative 5x5 Matrix (7 cols) */}
          <section
            aria-label="Illustrative 5x5 Screening Matrix"
            className="xl:col-span-7 rounded-md border border-slate-800 bg-[#111827] p-5"
          >
            <div className="border-b border-slate-800 pb-3 mb-4">
              <div className="text-xs font-mono text-slate-400">
                ILLUSTRATIVE 5×5 SCREENING MATRIX · PENDING VERIFIED ER-040 CLAUSE MAPPING
              </div>
              <h3 className="mt-0.5 text-sm font-bold text-slate-100">
                Illustrative 5×5 Likelihood vs. Operational Severity Screening Matrix
              </h3>
              <p className="mt-1 text-[11px] text-slate-400">
                Illustrative screening tool only. Does not assert an authoritative aviation safety classification or regulatory compliance determination under ER-040. Mean score thresholds do not establish regulatory acceptability.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs font-mono tabular-nums">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] text-slate-400">
                    <th className="p-2 text-left">LIKELIHOOD \ IMPACT</th>
                    <th className="p-2 text-center">1 · NEGLIGIBLE</th>
                    <th className="p-2 text-center">2 · MINOR</th>
                    <th className="p-2 text-center">3 · MAJOR</th>
                    <th className="p-2 text-center">4 · HAZARDOUS</th>
                    <th className="p-2 text-center">5 · CATASTROPHIC</th>
                  </tr>
                </thead>
                <tbody>
                  {[5, 4, 3, 2, 1].map((likelihoodRow) => (
                    <tr key={likelihoodRow} className="border-b border-slate-800/80">
                      <td className="p-2 font-semibold text-slate-300 whitespace-nowrap bg-[#0B0F17]">
                        L={likelihoodRow} {likelihoodRow === 5 ? '(Frequent)' : likelihoodRow === 4 ? '(Probable)' : likelihoodRow === 3 ? '(Remote)' : likelihoodRow === 2 ? '(Extremely Remote)' : '(Improbable)'}
                      </td>
                      {[1, 2, 3, 4, 5].map((impactCol) => {
                        const cellNodes = nodes.filter(
                          (n) =>
                            n.fmea.likelihood === likelihoodRow &&
                            n.fmea.impact === impactCol
                        );
                        const riskScore = likelihoodRow * impactCol;
                        const cellBg =
                          riskScore >= 15
                            ? 'bg-rose-950/50 border-rose-800/60 text-rose-200'
                            : riskScore >= 8
                              ? 'bg-amber-950/40 border-amber-800/50 text-amber-200'
                              : 'bg-emerald-950/30 border-emerald-800/40 text-emerald-200';

                        return (
                          <td
                            key={impactCol}
                            className={`border p-2 align-top min-w-[96px] h-16 ${cellBg}`}
                          >
                            <div className="text-[10px] opacity-60">L{likelihoodRow}×I{impactCol}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {cellNodes.map((cn) => (
                                <span
                                  key={cn.id}
                                  className="inline-block rounded bg-slate-950/80 px-1.5 py-0.5 text-[10px] font-bold text-white border border-slate-700"
                                >
                                  {cn.code}
                                </span>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* PSOE Maturity Model Assessment (5 cols) */}
          <section
            aria-label="PSOE Maturity Model Estimates"
            className="xl:col-span-5 rounded-md border border-slate-800 bg-[#111827] p-5 flex flex-col justify-between"
          >
            <div>
              <div className="border-b border-slate-800 pb-3 mb-4">
                <div className="text-xs font-mono text-slate-400">
                  EASA PART-IS OVERSIGHT · PSOE MATURITY ESTIMATES
                </div>
                <h3 className="mt-0.5 text-sm font-bold text-slate-100">
                  Illustrative PSOE Maturity Progression
                </h3>
                <p className="mt-1 text-[11px] text-slate-400">
                  Slider-derived illustrative maturity estimates, not verified organizational assessments. Zero control settings indicate NOT_PRESENT.
                </p>
              </div>

              <div className="space-y-4">
                {Object.entries(notification.psoe_maturity_summary).map(([dimension, level]) => {
                  const activeStepIdx = PSOE_STEPS.indexOf(level as PSOELevel);
                  return (
                    <div
                      key={dimension}
                      className="rounded border border-slate-800 bg-[#0B0F17] p-3.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-200">{dimension}</span>
                        <span className="font-mono font-bold text-cyan-300">{level.replace('_', ' ')}</span>
                      </div>
                      <div className="mt-2.5 grid grid-cols-5 gap-1 font-mono text-[9px]">
                        {PSOE_STEPS.map((step, idx) => {
                          const achieved = activeStepIdx >= 0 && idx <= activeStepIdx;
                          return (
                            <div
                              key={step}
                              className={`rounded py-1 text-center border ${
                                achieved
                                  ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200 font-semibold'
                                  : 'border-slate-800 bg-slate-900/50 text-slate-500'
                              }`}
                              title={step}
                            >
                              {step === PSOELevel.NOT_PRESENT ? 'NOT PRES' : step}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Proposed Structural Remediation Actions */}
            <div className="mt-4 rounded border border-slate-800 bg-[#0B0F17] p-3.5 text-xs">
              <div className="font-mono text-[11px] font-semibold text-emerald-400">
                PROPOSED STRUCTURAL ACTIONS (SIMULATION RECOMMENDATIONS)
              </div>
              <p className="mt-1 text-[10px] text-slate-400">
                Model-generated recommendations for organizational evaluation; not legally binding authority directives.
              </p>
              <ul className="mt-2 space-y-1.5 text-slate-300 list-disc list-inside">
                {notification.structural_remediations.map((rem, i) => (
                  <li key={i} className="leading-relaxed">
                    {rem}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        {/* Section 3: Node-Level Regulatory Risk & PSOE Register */}
        <section
          aria-label="Node-Level Regulatory Risk Register"
          className="rounded-md border border-slate-800 bg-[#111827] overflow-hidden"
        >
          <div className="border-b border-slate-800 bg-[#0F172A] px-5 py-3">
            <h3 className="text-sm font-bold text-slate-100">
              Illustrative System Asset Compliance Register (Pending Verified Clause Mapping)
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-[#0B0F17] font-mono text-[11px] text-slate-400">
                  <th className="py-2.5 px-4">ASSET CODE</th>
                  <th className="py-2.5 px-4">SUBSYSTEM</th>
                  <th className="py-2.5 px-4">ER-040 SEVERITY</th>
                  <th className="py-2.5 px-4">PSOE STATUS</th>
                  <th className="py-2.5 px-4 text-right">RAW / ADJUSTED RISK</th>
                  <th className="py-2.5 px-4">PROPOSED TRIPARTITE ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {nodes.map((n) => (
                  <tr key={n.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-100 whitespace-nowrap">
                      {n.code}
                    </td>
                    <td className="py-2.5 px-4 text-slate-200">
                      <div className="font-medium">{n.label}</div>
                      <div className="text-[11px] text-slate-400">{n.subsystem}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-amber-300 whitespace-nowrap">
                      {n.er040_severity}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-cyan-300 whitespace-nowrap">
                      {evaluateNodePSOE(n)}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-slate-200 whitespace-nowrap">
                      {calculateRawRPN(n.fmea)} → <span className="font-bold text-emerald-300">{computeResidualRPN(n).toFixed(1)}</span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-300 max-w-md">
                      {n.mitigation_recommendation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
