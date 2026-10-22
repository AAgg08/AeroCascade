"""
AeroCascade — NetworkX Directed Dependency Graph & Chokepoint Centrality Engine
Computes topological blast radius, weighted betweenness centrality, and residual FMEA RPN.
"""

from __future__ import annotations
from typing import Dict, List, Tuple
import networkx as nx
from .models import (
    CascadeStage,
    ControlCategory,
    DependencyEdgeModel,
    NodeCentralityMetric,
    SystemNodeModel,
)


def compute_residual_rpn(node: SystemNodeModel) -> float:
    """
    Computes effective/residual FMEA RPN after applying Dhillon & Moores (2001) Tripartite Controls
    and Policy Investment.
    - Stage 1 nodes depend primarily on Technical (60%), Formal (25%), Informal (15%)
    - Stage 2 nodes depend on Technical (40%), Formal (35%), Informal (25%)
    - Stage 3 recovery blocker nodes depend heavily on Formal (45%) and Informal (45%), Technical (10%)
    """
    raw = float(node.fmea.raw_rpn)
    t = node.tripartite.technical / 100.0
    f = node.tripartite.formal / 100.0
    i = node.tripartite.informal / 100.0
    inv = node.fmea.policy_investment / 100.0

    if node.stage == CascadeStage.STAGE_1_TRIGGER:
        mitigation_factor = 0.60 * t + 0.25 * f + 0.15 * i
    elif node.stage == CascadeStage.STAGE_2_PROPAGATION:
        mitigation_factor = 0.40 * t + 0.35 * f + 0.25 * i
    else:
        # Stage 3 Recovery Blocker: Technical controls alone cannot resolve Formal/Informal deficits
        mitigation_factor = 0.10 * t + 0.45 * f + 0.45 * i

    # Combine control maturity with policy investment damping (max 78% reduction to preserve residual safety awareness)
    combined_damping = min(0.78, (0.75 * mitigation_factor + 0.25 * inv) * 0.85)
    return round(max(5.0, raw * (1.0 - combined_damping)), 1)


def build_dependency_graph(
    nodes: List[SystemNodeModel],
    edges: List[DependencyEdgeModel],
) -> Tuple[nx.DiGraph, List[NodeCentralityMetric]]:
    """
    Constructs a directed NetworkX graph from Stage 1 -> Stage 2 -> Stage 3 nodes
    and computes chokepoint centrality metrics.
    """
    G = nx.DiGraph()

    for node in nodes:
        G.add_node(
            node.id,
            code=node.code,
            label=node.label,
            stage=node.stage.value,
            dominant_control=node.dominant_control.value,
            raw_rpn=node.fmea.raw_rpn,
            residual_rpn=compute_residual_rpn(node),
        )

    for edge in edges:
        if G.has_node(edge.source) and G.has_node(edge.target):
            # Distance weight is inverse of coupling_weight for shortest-path betweenness
            distance_weight = max(0.05, 1.05 - edge.coupling_weight)
            G.add_edge(
                edge.source,
                edge.target,
                id=edge.id,
                coupling_weight=edge.coupling_weight,
                weight=distance_weight,
                mechanism=edge.propagation_mechanism,
                protocol_layer=edge.protocol_layer,
            )

    betweenness: Dict[str, float] = nx.betweenness_centrality(G, weight="weight", normalized=True)
    max_deg = max(1, len(nodes) - 1)

    analytics: List[NodeCentralityMetric] = []
    for node in nodes:
        in_deg_weighted = sum(
            data.get("coupling_weight", 0.5) for _, _, data in G.in_edges(node.id, data=True)
        )
        out_deg_weighted = sum(
            data.get("coupling_weight", 0.5) for _, _, data in G.out_edges(node.id, data=True)
        )
        in_vuln = round(min(1.0, in_deg_weighted / max(1.0, max_deg * 0.35)), 3)
        out_blast = round(min(1.0, out_deg_weighted / max(1.0, max_deg * 0.35)), 3)
        b_cent = round(betweenness.get(node.id, 0.0), 3)

        residual = compute_residual_rpn(node)
        chokepoint_idx = round(
            min(100.0, (0.45 * b_cent + 0.30 * out_blast + 0.25 * in_vuln) * 100.0 + (residual / 125.0) * 35.0),
            1,
        )
        # Positive gap means RPN is disproportionately high relative to current policy investment
        normalized_rpn_pct = (residual / 125.0) * 100.0
        efficiency_gap = round(normalized_rpn_pct - node.fmea.policy_investment, 1)

        analytics.append(
            NodeCentralityMetric(
                node_id=node.id,
                node_code=node.code,
                label=node.label,
                stage=node.stage,
                betweenness_centrality=b_cent,
                in_degree_vulnerability=in_vuln,
                out_degree_blast_radius=out_blast,
                chokepoint_index=chokepoint_idx,
                raw_rpn=node.fmea.raw_rpn,
                residual_rpn=residual,
                policy_investment=node.fmea.policy_investment,
                investment_efficiency_gap=efficiency_gap,
            )
        )

    return G, analytics
