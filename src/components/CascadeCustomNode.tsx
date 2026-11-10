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
      ? { glyph: '● Stage 1 · Trigger', badge: 'text-rose-600 bg-rose-50 border-rose-100' }
      : nodeModel.stage === CascadeStage.STAGE_2_PROPAGATION
        ? { glyph: '▲ Stage 2 · Propagation', badge: 'text-amber-600 bg-amber-50 border-amber-100' }
        : { glyph: '✖ Stage 3 · Blocker', badge: 'text-purple-600 bg-purple-50 border-purple-100' };

  const borderClass = isSelected
    ? 'border-emerald-500 ring-4 ring-emerald-500/15 shadow-md bg-white'
    : isHighlightedPath
      ? 'border-gray-300 shadow-sm hover:shadow-md bg-white'
      : 'border-gray-100 bg-white shadow-xs hover:border-gray-200 hover:shadow-sm';

  return (
    <div
      className={`w-[310px] rounded-2xl border p-4 transition-all duration-150 ${borderClass}`}
      data-testid={`flow-node-${nodeModel.code}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !rounded-full !border-white !bg-gray-400 shadow-xs"
      />

      {/* Pill Stage Badge & Code */}
      <div className="flex items-center justify-between text-[11px]">
        <span className={`inline-block px-2.5 py-0.5 rounded-full border font-semibold text-[10px] ${stageHeader.badge}`}>
          {stageHeader.glyph}
        </span>
        <span className="font-bold text-gray-500 text-xs">
          {nodeModel.code} <span className="font-normal text-gray-300">·</span> {nodeModel.dominant_control}
        </span>
      </div>

      {/* Primary Node Title */}
      <div className="mt-2 text-sm font-bold leading-snug text-gray-900 line-clamp-2">
        {nodeModel.label}
      </div>

      {/* Subsystem & PSOE Maturity */}
      <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
        <span className="truncate max-w-[185px] font-medium">{nodeModel.subsystem}</span>
        <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full text-[10px] border border-emerald-100">
          PSOE: {psoe}
        </span>
      </div>

      {/* Dhillon & Moores (2001) Tripartite Control Bar Readout */}
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2.5 text-[10px]">
        <div>
          <div className="flex justify-between font-semibold text-gray-600">
            <span>TECH</span>
            <span className="text-teal-600">{nodeModel.tripartite.technical.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-500 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, nodeModel.tripartite.technical))}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between font-semibold text-gray-600">
            <span>FORM</span>
            <span className="text-amber-600">{nodeModel.tripartite.formal.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, nodeModel.tripartite.formal))}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex justify-between font-semibold text-gray-600">
            <span>INFR</span>
            <span className="text-emerald-600">{nodeModel.tripartite.informal.toFixed(0)}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, nodeModel.tripartite.informal))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Telemetry Strip */}
      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2 text-xs">
        <div className="text-gray-600 font-medium">
          <span>RPN: </span>
          <span
            className={
              residualRpn >= 55
                ? 'font-extrabold text-rose-600'
                : residualRpn >= 35
                  ? 'font-extrabold text-amber-600'
                  : 'font-extrabold text-emerald-600'
            }
          >
            {residualRpn.toFixed(1)}
          </span>
          <span className="text-gray-400"> / {rawRpn}</span>
        </div>
        <div className="text-gray-500 text-[11px] font-semibold">
          <span>CHKPT: </span>
          <span className="text-gray-900 font-bold">
            {centrality ? centrality.chokepoint_index.toFixed(1) : '—'}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !rounded-full !border-white !bg-gray-400 shadow-xs"
      />
    </div>
  );
}
