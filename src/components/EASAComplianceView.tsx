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
    <div className="space-y-8">
      {/* Top Action Bar */}
      <section
        aria-label="Regulatory Dossier Export Actions"
        className="no-print flex flex-col gap-4 rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-0.5 rounded-full border border-indigo-100">
              SIMULATION EXERCISE DRAFT · ILLUSTRATIVE REGULATORY MAPPING
            </span>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 font-medium">
              NOT AN OFFICIAL FILING
            </span>
          </div>
          <h2 className="mt-2 text-lg sm:text-xl font-bold text-gray-900 tracking-tight">
            Aviation Information Security Incident Simulation Exercise Dossier &amp; Risk Register
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            EASA Part-IS (EU) 2022/1645 &amp; (EU) 2023/203 Regulatory Notification Formulation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="export-json-btn"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-xs shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Exercise JSON</span>
          </button>
          <button
            type="button"
            data-testid="print-dossier-btn"
            onClick={() => handlePrint()}
            className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-black transition-all shadow-sm shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print Exercise Dossier</span>
          </button>
        </div>
      </section>

      {/* Printable Regulatory Dossier Container */}
      <div ref={printContainerRef} className="space-y-8">
        {/* Section 1: EASA Part-IS Incident Exercise Header */}
        <section
          aria-label="EASA Part-IS Notification Form"
          className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm space-y-6"
        >
          <div className="flex flex-col gap-4 border-b border-gray-100 pb-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-semibold text-amber-600 bg-amber-50 px-3 py-0.5 rounded-full border border-amber-100 inline-block">
                EXERCISE DRAFT · SUBJECT TO ORGANIZATIONAL IS.I.OR.230 DETERMINATION
              </div>
              <h3 className="mt-2 text-xl font-extrabold text-gray-900">
                {notification.report_id}
              </h3>
              <p className="mt-1 text-xs text-gray-500 font-medium">
                Reporting Entity: {notification.reporting_entity}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>Applicability: <span className="font-semibold text-gray-700">{notification.reporting_applicability}</span></span>
                <span>Awareness Time: <span className="font-semibold text-gray-700">{notification.awareness_time}</span></span>
              </div>
            </div>
            <div className="text-xs text-gray-600 space-y-1.5 lg:text-right">
              <div className="font-semibold text-gray-900">{notification.incident_classification}</div>
              <div className="inline-block rounded-full bg-amber-50 px-3 py-1 font-bold text-amber-700 border border-amber-200">
                {notification.er040_risk_class}
              </div>
              <div className="text-xs text-gray-400">
                Official Guidance:{' '}
                <a
                  href={notification.official_guidance_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 underline hover:text-indigo-800"
                >
                  EASA Easy Access Rules Part-IS
                </a>
              </div>
            </div>
          </div>

          {/* Three-Stage Notification Timeline (EASA IS.I.OR.230) */}
          <div className="border-b border-gray-100 pb-6">
            <div className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">
              EASA PART-IS IS.I.OR.230 MANDATED REPORTING WORKFLOW
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
                <div className="text-xs text-indigo-600 font-bold">STAGE 1: INITIAL NOTIFICATION</div>
                <div className="mt-1 font-semibold text-gray-900">Without Undue Delay</div>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Notify competent authority and relevant stakeholders as soon as the security condition becomes known and represents potential safety impact.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
                <div className="text-xs text-amber-600 font-bold">STAGE 2: INITIAL REPORT</div>
                <div className="mt-1 font-semibold text-gray-900">Within 72 Hours Max</div>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Submit initial report as soon as possible, in any case within 72h of awareness, unless exceptional circumstances prevent it.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
                <div className="text-xs text-emerald-600 font-bold">STAGE 3: FOLLOW-UP REPORT</div>
                <div className="mt-1 font-semibold text-gray-900">Post-Investigation</div>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Detailed technical analysis, root-cause assessment, and structural remediation commitments once investigation concludes.
                </p>
              </div>
            </div>
          </div>

          {/* Statutory Regulations vs Voluntary Standards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 border-b border-gray-100 pb-6 text-xs">
            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
              <div className="text-xs text-indigo-600 font-bold uppercase tracking-wider">
                STATUTORY BINDING EU REGULATIONS
              </div>
              <ul className="mt-2 space-y-1.5 text-gray-600 list-disc list-inside">
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
            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider">
                VOLUNTARY INDUSTRY STANDARDS &amp; GUIDANCE
              </div>
              <ul className="mt-2 space-y-1.5 text-gray-600 list-disc list-inside">
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 text-xs">
            <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-5">
              <div className="font-bold text-rose-700">
                ● STAGE 1: TECHNICAL INGRESS VECTOR
              </div>
              <p className="mt-2 text-gray-700 leading-relaxed">
                {notification.stage_1_technical_root_cause}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5">
              <div className="font-bold text-amber-700">
                ▲ STAGE 2: OPERATIONAL FRAGILITY PROPAGATION
              </div>
              <p className="mt-2 text-gray-700 leading-relaxed">
                {notification.stage_2_operational_propagation}
              </p>
            </div>
            <div className="rounded-2xl border border-purple-100 bg-purple-50/40 p-5">
              <div className="font-bold text-purple-700">
                ✖ STAGE 3: FORMAL &amp; INFORMAL RECOVERY BLOCKER
              </div>
              <p className="mt-2 text-gray-700 leading-relaxed">
                {notification.stage_3_governance_recovery_blocker}
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Illustrative 5x5 Screening Matrix + PSOE Maturity Estimates */}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
          {/* Illustrative 5x5 Matrix (7 cols) */}
          <section
            aria-label="Illustrative 5x5 Screening Matrix"
            className="xl:col-span-7 rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm"
          >
            <div className="border-b border-gray-100 pb-4 mb-5">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                ILLUSTRATIVE 5×5 SCREENING MATRIX · PENDING VERIFIED ER-040 CLAUSE MAPPING
              </div>
              <h3 className="mt-1 text-base font-bold text-gray-900">
                Illustrative 5×5 Likelihood vs. Operational Severity Screening Matrix
              </h3>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                Illustrative screening tool only. Does not assert an authoritative aviation safety classification or regulatory compliance determination under ER-040. Mean score thresholds do not establish regulatory acceptability.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] text-gray-400 font-semibold">
                    <th className="p-2.5 text-left">LIKELIHOOD \ IMPACT</th>
                    <th className="p-2.5 text-center">1 · NEGLIGIBLE</th>
                    <th className="p-2.5 text-center">2 · MINOR</th>
                    <th className="p-2.5 text-center">3 · MAJOR</th>
                    <th className="p-2.5 text-center">4 · HAZARDOUS</th>
                    <th className="p-2.5 text-center">5 · CATASTROPHIC</th>
                  </tr>
                </thead>
                <tbody>
                  {[5, 4, 3, 2, 1].map((likelihoodRow) => (
                    <tr key={likelihoodRow} className="border-b border-gray-100">
                      <td className="p-2.5 font-semibold text-gray-700 whitespace-nowrap bg-gray-50/60 text-xs">
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
                            ? 'bg-rose-50/80 border-rose-100 text-rose-900'
                            : riskScore >= 8
                              ? 'bg-amber-50/80 border-amber-100 text-amber-900'
                              : 'bg-emerald-50/60 border-emerald-100 text-emerald-900';

                        return (
                          <td
                            key={impactCol}
                            className={`border p-2 align-top min-w-[96px] h-16 ${cellBg}`}
                          >
                            <div className="text-[10px] font-medium opacity-60">L{likelihoodRow}×I{impactCol}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {cellNodes.map((cn) => (
                                <span
                                  key={cn.id}
                                  className="inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gray-800 border border-gray-200/80 shadow-xs"
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
            className="xl:col-span-5 rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="border-b border-gray-100 pb-4 mb-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  EASA PART-IS OVERSIGHT · PSOE MATURITY ESTIMATES
                </div>
                <h3 className="mt-1 text-base font-bold text-gray-900">
                  Illustrative PSOE Maturity Progression
                </h3>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Slider-derived illustrative maturity estimates, not verified organizational assessments. Zero control settings indicate NOT_PRESENT.
                </p>
              </div>

              <div className="space-y-4">
                {Object.entries(notification.psoe_maturity_summary).map(([dimension, level]) => {
                  const activeStepIdx = PSOE_STEPS.indexOf(level as PSOELevel);
                  return (
                    <div
                      key={dimension}
                      className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-800">{dimension}</span>
                        <span className="font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100 text-[11px]">
                          {level.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-5 gap-1.5 text-[10px]">
                        {PSOE_STEPS.map((step, idx) => {
                          const achieved = activeStepIdx >= 0 && idx <= activeStepIdx;
                          return (
                            <div
                              key={step}
                              className={`rounded-full py-1 text-center font-medium border ${
                                achieved
                                  ? 'border-indigo-300 bg-indigo-600 text-white font-semibold shadow-xs'
                                  : 'border-gray-200 bg-white text-gray-400'
                              }`}
                              title={step}
                            >
                              {step === PSOELevel.NOT_PRESENT ? 'NONE' : step.slice(0, 4)}
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
            <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 text-xs">
              <div className="font-bold text-emerald-800">
                PROPOSED STRUCTURAL ACTIONS (SIMULATION RECOMMENDATIONS)
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Model-generated recommendations for organizational evaluation; not legally binding authority directives.
              </p>
              <ul className="mt-2.5 space-y-1.5 text-gray-700 list-disc list-inside">
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
          className="rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden"
        >
          <div className="border-b border-gray-100 px-6 sm:px-8 py-5">
            <h3 className="text-base font-bold text-gray-900">
              Illustrative System Asset Compliance Register (Pending Verified Clause Mapping)
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Asset by asset mapping to EUROCAE ER-040 operational severity and residual risk metrics
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-semibold text-gray-500">
                  <th className="py-3 px-6">ASSET CODE</th>
                  <th className="py-3 px-6">SUBSYSTEM</th>
                  <th className="py-3 px-6">ER-040 SEVERITY</th>
                  <th className="py-3 px-6">PSOE STATUS</th>
                  <th className="py-3 px-6 text-right">RAW / ADJUSTED RISK</th>
                  <th className="py-3 px-6">PROPOSED TRIPARTITE ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {nodes.map((n) => (
                  <tr key={n.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-6 font-semibold text-gray-900 whitespace-nowrap">
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-bold text-gray-800">
                        {n.code}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-gray-800">
                      <div className="font-semibold">{n.label}</div>
                      <div className="text-[11px] text-gray-500">{n.subsystem}</div>
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap">
                      <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold">
                        {n.er040_severity}
                      </span>
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap">
                      <span className="rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-0.5 text-xs font-semibold">
                        {evaluateNodePSOE(n)}
                      </span>
                    </td>
                    <td className="py-3 px-6 tabular-nums text-right text-gray-700 whitespace-nowrap">
                      {calculateRawRPN(n.fmea)} → <span className="font-bold text-emerald-600">{computeResidualRPN(n).toFixed(1)}</span>
                    </td>
                    <td className="py-3 px-6 text-gray-600 max-w-md">
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
