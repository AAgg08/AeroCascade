"""
AeroCascade — NetworkX Directed Dependency Graph & Canonical Centrality Engine
Computes topological reachability, directed shortest-path betweenness centrality, and residual FMEA RPN.

Based on "Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations"
(Aggarwal & Dhillon, AIAA Aviation 2026).
"""

from __future__ import annotations
from typing import Dict, List, Tuple
import networkx as nx
from .models import (
    CascadeStage,
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

    # Mitigation-only adjusted risk score: strictly non-increasing with controls, bounded by [0.0, raw]
    # Note: Fractional adjusted score is an illustrative modeling assumption, not an integer reassessment of FMEA factors.
    combined_damping = min(0.78, (0.75 * mitigation_factor + 0.25 * inv) * 0.85)
    adjusted_score = min(raw, max(0.0, raw * (1.0 - combined_damping)))
    return round(adjusted_score, 1)


def build_dependency_graph(
    nodes: List[SystemNodeModel],
    edges: List[DependencyEdgeModel],
) -> Tuple[nx.DiGraph, List[NodeCentralityMetric]]:
    """
    Constructs a directed NetworkX graph with documented positive edge distances.
    Computes standard directed shortest-path betweenness centrality and separates
    direct degree from downstream topological reachability.
    """
    # Validation: check duplicate node IDs
    seen_ids = set()
    for node in nodes:
        if node.id in seen_ids:
            raise ValueError(f"Duplicate node ID detected: '{node.id}'")
        seen_ids.add(node.id)

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
        if not G.has_node(edge.source) or not G.has_node(edge.target):
            raise ValueError(
                f"Dangling edge '{edge.id}': source '{edge.source}' or target '{edge.target}' does not exist in nodes"
            )
        # Positive distance weight for NetworkX shortest path calculation
        dist = float(edge.distance_weight) if edge.distance_weight > 0 else 1.0
        G.add_edge(
            edge.source,
            edge.target,
            id=edge.id,
            coupling_weight=edge.coupling_weight,
            weight=dist,
            propagation_delay_hours=edge.propagation_delay_hours,
            dependency_type=edge.dependency_type,
            mechanism=edge.propagation_mechanism,
            protocol_layer=edge.protocol_layer,
        )

    # Standard directed shortest-path betweenness centrality (Brandes algorithm)
    # Edge weights represent distance (lower = shorter path)
    betweenness: Dict[str, float] = nx.betweenness_centrality(G, weight="weight", normalized=True)
    max_possible_reachable = max(1, len(nodes) - 1)

    analytics: List[NodeCentralityMetric] = []
    for node in nodes:
        direct_in = G.in_degree(node.id)
        direct_out = G.out_degree(node.id)
        descendants = nx.descendants(G, node.id)
        downstream_reachable = len(descendants)
        reachability_ratio = round(downstream_reachable / max_possible_reachable, 3)

        in_deg_weighted = sum(
            data.get("coupling_weight", 0.5) for _, _, data in G.in_edges(node.id, data=True)
        )
        out_deg_weighted = sum(
            data.get("coupling_weight", 0.5) for _, _, data in G.out_edges(node.id, data=True)
        )
        in_vuln = round(min(1.0, in_deg_weighted / max(1.0, max_possible_reachable * 0.35)), 3)
        out_blast = round(min(1.0, out_deg_weighted / max(1.0, max_possible_reachable * 0.35)), 3)
        b_cent = round(float(betweenness.get(node.id, 0.0)), 4)

        residual = compute_residual_rpn(node)
        # Custom chokepoint index kept distinct from standard betweenness
        chokepoint_idx = round(
            min(100.0, (0.45 * b_cent + 0.30 * out_blast + 0.25 * in_vuln) * 100.0 + (residual / 125.0) * 35.0),
            1,
        )
        normalized_rpn_pct = (residual / 125.0) * 100.0
        efficiency_gap = round(normalized_rpn_pct - node.fmea.policy_investment, 1)

        analytics.append(
            NodeCentralityMetric(
                node_id=node.id,
                node_code=node.code,
                label=node.label,
                stage=node.stage,
                dominant_control=node.dominant_control.value,
                betweenness_centrality=b_cent,
                in_degree_vulnerability=in_vuln,
                out_degree_blast_radius=out_blast,
                chokepoint_index=chokepoint_idx,
                raw_rpn=node.fmea.raw_rpn,
                residual_rpn=residual,
                adjusted_risk_score=residual,
                policy_investment=node.fmea.policy_investment,
                investment_efficiency_gap=efficiency_gap,
                psoe_status=node.psoe_status.value,
                er040_severity=node.er040_severity.value,
                direct_in_degree=direct_in,
                direct_out_degree=direct_out,
                downstream_reachable_nodes=downstream_reachable,
                downstream_reachability_ratio=reachability_ratio,
            )
        )

    return G, analytics
