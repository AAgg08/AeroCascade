import dagre from '@dagrejs/dagre';
import { type Edge, type Node, Position } from '@xyflow/react';
import {
  CascadeStage,
  type DependencyEdgeModel,
  type NodeCentralityMetric,
  type SystemNodeModel,
} from '../domain/types.ts';

export interface CascadeFlowNodeData extends Record<string, unknown> {
  nodeModel: SystemNodeModel;
  centrality?: NodeCentralityMetric;
  isSelected: boolean;
  isHighlightedPath: boolean;
}

const NODE_WIDTH = 310;
const NODE_HEIGHT = 176;

/**
 * Computes an automatic Left-to-Right (Stage 1 -> Stage 2 -> Stage 3) layout
 * using @dagrejs/dagre and enforces strict stage column separation so nodes never overlap.
 */
export function buildDagreCascadeLayout(
  nodes: SystemNodeModel[],
  edges: DependencyEdgeModel[],
  centralityMap: Record<string, NodeCentralityMetric>,
  selectedNodeId: string | null
): { flowNodes: Node<CascadeFlowNodeData>[]; flowEdges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'LR',
    align: 'UL',
    nodesep: 48,
    ranksep: 140,
    marginx: 36,
    marginy: 36,
  });

  for (const node of nodes) {
    g.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Group nodes by stage to guarantee deterministic Stage 1 -> Stage 2 -> Stage 3 horizontal columns
  // while preserving Dagre's vertical ordering (y-axis) that minimizes edge crossings
  const stageColumns: Record<CascadeStage, SystemNodeModel[]> = {
    [CascadeStage.STAGE_1_TRIGGER]: [],
    [CascadeStage.STAGE_2_PROPAGATION]: [],
    [CascadeStage.STAGE_3_BLOCKER]: [],
  };

  for (const n of nodes) {
    stageColumns[n.stage].push(n);
  }

  const stageX: Record<CascadeStage, number> = {
    [CascadeStage.STAGE_1_TRIGGER]: 24,
    [CascadeStage.STAGE_2_PROPAGATION]: 460,
    [CascadeStage.STAGE_3_BLOCKER]: 896,
  };

  // Determine connected nodes to highlight active propagation paths from/to selectedNodeId
  const connectedNodeIds = new Set<string>();
  if (selectedNodeId) {
    connectedNodeIds.add(selectedNodeId);
    for (const e of edges) {
      if (e.source === selectedNodeId) connectedNodeIds.add(e.target);
      if (e.target === selectedNodeId) connectedNodeIds.add(e.source);
    }
  }

  const flowNodes: Node<CascadeFlowNodeData>[] = [];

  (Object.keys(stageColumns) as CascadeStage[]).forEach((stageKey) => {
    const colNodes = stageColumns[stageKey];
    // Sort vertically by Dagre's computed y coordinate
    colNodes.sort((a, b) => {
      const posA = g.node(a.id)?.y ?? 0;
      const posB = g.node(b.id)?.y ?? 0;
      return posA - posB;
    });

    colNodes.forEach((nodeModel, idx) => {
      const x = stageX[stageKey];
      const y = 20 + idx * (NODE_HEIGHT + 24);
      const centrality = centralityMap[nodeModel.id];

      flowNodes.push({
        id: nodeModel.id,
        type: 'cascadeNode',
        position: { x, y },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          nodeModel,
          centrality,
          isSelected: nodeModel.id === selectedNodeId,
          isHighlightedPath: selectedNodeId ? connectedNodeIds.has(nodeModel.id) : true,
        },
      });
    });
  });

  const flowEdges: Edge[] = edges.map((e) => {
    const isConnectedToSelected =
      !selectedNodeId || e.source === selectedNodeId || e.target === selectedNodeId;
    const isHighCoupling = e.coupling_weight >= 0.88;

    return {
      id: e.id,
      source: e.source,
      target: e.target,
      animated: isConnectedToSelected,
      label: `w=${e.coupling_weight.toFixed(2)}`,
      labelStyle: {
        fill: isConnectedToSelected ? '#E2E8F0' : '#64748B',
        fontSize: 10,
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 500,
      },
      labelBgStyle: {
        fill: '#0F172A',
        fillOpacity: 0.92,
        stroke: '#1E293B',
        strokeWidth: 1,
      },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 4,
      style: {
        stroke: isConnectedToSelected
          ? isHighCoupling
            ? '#F59E0B'
            : '#06B6D4'
          : '#334155',
        strokeWidth: isConnectedToSelected ? (isHighCoupling ? 2.5 : 2) : 1.25,
        opacity: isConnectedToSelected ? 1 : 0.4,
      },
    };
  });

  return { flowNodes, flowEdges };
}
