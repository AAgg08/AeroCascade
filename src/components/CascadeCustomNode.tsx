import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import {
  calculateRawRPN,
  computeResidualRPN,
  evaluateNodePSOE,
} from '../domain/simulationEngine.ts';
import { CascadeStage } from '../domain/types.ts';
import { type CascadeFlowNodeData } from '../utils/dagreLayout.ts';

type CustomCascadeNodeType = Node<CascadeFlowNodeData, 'cascadeNode'>;

export function CascadeCustomNode({ data }: NodeProps<CustomCascadeNodeType>) {
  const { nodeModel, centrality, isSelected, isHighlightedPath } = data;
  const rawRpn = calculateRawRPN(nodeModel.fmea);
  const residualRpn = computeResidualRPN(nodeModel);
  const psoe = evaluateNodePSOE(nodeModel);

  const stageHeader =
    nodeModel.stage === CascadeStage.STAGE_1_TRIGGER
      ? { glyph: '● Stage 1 · Trigger', tone: 'text-cyan-400' }
      : nodeModel.stage === CascadeStage.STAGE_2_PROPAGATION
        ? { glyph: '▲ Stage 2 · Propagation', tone: 'text-amber-400' }
        : { glyph: '✖ Stage 3 · Blocker', tone: 'text-rose-400' };

  const borderClass = isSelected
    ? 'border-cyan-400 ring-2 ring-cyan-500/30 bg-[#131C2E]'
    : isHighlightedPath
      ? 'border-slate-700 hover:border-slate-500 bg-[#0F172A]'
      : 'border-slate-800/80 bg-[#0B0F17]/90 opacity-60';

  return (
    <div
      className={`w-[310px] rounded-md border p-3.5 transition-colors duration-150 ${borderClass}`}
      data-testid={`flow-node-${nodeModel.code}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !rounded-xs !border-slate-600 !bg-slate-300"
      />

      {/* Unboxed Metadata Row (Zero-Pill Discipline) */}
      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
        <span className={`font-semibold ${stageHeader.tone}`}>{stageHeader.glyph}</span>
        <span className="text-slate-400">
          {nodeModel.code} <span aria-hidden="true">·</span> {nodeModel.dominant_control}
        </span>
      </div>

      {/* Primary Node Title */}
      <div className="mt-1.5 text-[13px] font-semibold leading-snug text-slate-100 line-clamp-2">
        {nodeModel.label}
      </div>

      {/* Subsystem & PSOE Maturity */}
      <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
        <span className="truncate max-w-[185px]">{nodeModel.subsystem}</span>
        <span className="font-mono text-[10px] text-slate-300">PSOE: {psoe}</span>
      </div>

      {/* Dhillon & Moores (2001) Tripartite Control Bar Readout */}
      <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-slate-800/90 pt-2 text-[10px] font-mono tabular-nums">
        <div>
          <div className="flex justify-between text-slate-400">
            <span>TECH</span>
            <span className="text-cyan-300">{nodeModel.tripartite.technical.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1 w-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-cyan-400"
              style={{ width: `${Math.min(100, Math.max(0, nodeModel.tripartite.technical))}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-slate-400">
            <span>FORM</span>
            <span className="text-amber-300">{nodeModel.tripartite.formal.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1 w-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-amber-400"
              style={{ width: `${Math.min(100, Math.max(0, nodeModel.tripartite.formal))}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-slate-400">
            <span>INFR</span>
            <span className="text-emerald-300">{nodeModel.tripartite.informal.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1 w-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-emerald-400"
              style={{ width: `${Math.min(100, Math.max(0, nodeModel.tripartite.informal))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Telemetry Strip: Residual RPN vs Raw RPN & Chokepoint Score */}
      <div className="mt-2.5 flex items-center justify-between border-t border-slate-800/90 pt-2 text-[11px] font-mono tabular-nums">
        <div className="text-slate-300">
          <span>RPN: </span>
          <span
            className={
              residualRpn >= 55
                ? 'font-bold text-rose-400'
                : residualRpn >= 35
                  ? 'font-semibold text-amber-300'
                  : 'font-semibold text-emerald-400'
            }
          >
            {residualRpn.toFixed(1)}
          </span>
          <span className="text-slate-500"> / {rawRpn}</span>
        </div>
        <div className="text-slate-400">
          <span>CHKPT: </span>
          <span className="text-slate-200 font-semibold">
            {centrality ? centrality.chokepoint_index.toFixed(1) : '—'}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !rounded-xs !border-slate-600 !bg-slate-300"
      />
    </div>
  );
}
