"""Exploration pruning rules (colour-independent).

The user's three rules, expressed on a minimax ``outcome`` that is always
viewed from the perspective of the node's ``currentPlayer``:

1. If a node has an immediately winning move, that move wins -- the other
   (still unknown) branches need no exploration and are removed.
2. If any child is ``win`` (the opponent can win from there), this parent is
   ``loss``; the remaining unknown branches are removed.
3. If every child is ``loss``, this parent is ``win`` and is recorded.

Already decided moves (``win`` / ``loss``, seeded from existing data) are NEVER
removed: they are kept for reuse in later exploration (transpositions).

This module deliberately knows nothing about colours. Mapping ``outcome`` onto
node colours is a separate, explicit step (see ``--seed-colors`` in main()).
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    from . import rules, storage
except ImportError:
    import rules  # type: ignore[no-redef]
    import storage  # type: ignore[no-redef]

Outcome = str  # "win" | "loss" | "unknown"
WIN, LOSS, UNKNOWN = "win", "loss", "unknown"


def infer_move(
    parent_board: List[List[str]], child_board: List[List[str]]
) -> Optional[List[int]]:
    """Recover ``[r1,c1,r2,c2]`` from two boards.

    The saved graph has no ``move`` field, so the incoming move must be
    reconstructed from the board difference. Returns None for an inconsistent
    pair (e.g. a transposition edge that is not a single slide).
    """
    size = rules.NEUTREEKO_SIZE
    src: Optional[Tuple[int, int]] = None
    dst: Optional[Tuple[int, int]] = None
    for r in range(size):
        for c in range(size):
            before, after = parent_board[r][c], child_board[r][c]
            if before == after:
                continue
            if before in ("B", "W") and after == rules.EMPTY:
                if src is not None:
                    return None
                src = (r, c)
            elif before == rules.EMPTY and after in ("B", "W"):
                if dst is not None:
                    return None
                dst = (r, c)
            else:
                return None
    if src is None or dst is None:
        return None
    if parent_board[src[0]][src[1]] != child_board[dst[0]][dst[1]]:
        return None
    return [src[0], src[1], dst[0], dst[1]]


def analyse(board: List[List[str]], player: str) -> Dict[str, Any]:
    """Lightweight version of neutreeko_analysis: winner + winning moves only.

    Computing ``unsafe_moves`` for ~8,000 nodes would be needlessly expensive;
    the pruning rules do not need it.
    """
    winner = next(
        (p for p in ("B", "W") if rules.check_neutreeko_win(board, p)), None
    )
    winning_moves: List[List[int]] = []
    if winner is None:
        for move in rules.neutreeko_moves(board, player):
            if rules.check_neutreeko_win(
                rules.apply_neutreeko_move(board, move), player
            ):
                winning_moves.append(move)
    return {"winner": winner, "winning_moves": winning_moves}


def _postorder(nodes_map: Dict[str, Any]) -> List[str]:
    """Children-first order that tolerates DAGs and (defensively) cycles."""
    order: List[str] = []
    done: Set[str] = set()
    visiting: Set[str] = set()

    def visit(node_id: str) -> None:
        if node_id in done or node_id in visiting:
            return
        visiting.add(node_id)
        for child in nodes_map[node_id].get("children", []):
            if child in nodes_map:
                visit(child)
        visiting.discard(node_id)
        done.add(node_id)
        order.append(node_id)

    for node_id in nodes_map:
        visit(node_id)
    return order


def apply_exploration_rules(
    graph: Dict[str, Any], seed: Optional[Dict[str, Outcome]] = None
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Return ``(new_graph, stats)``. The input graph is never mutated."""
    seed = seed or {}
    nodes_map: Dict[str, Any] = {
        node_id: dict(node) for node_id, node in graph.get("nodesMap", {}).items()
    }
    nodes: List[Dict[str, Any]] = [dict(n) for n in graph.get("nodes", [])]
    edges: List[Dict[str, Any]] = [dict(e) for e in graph.get("edges", [])]

    for node in nodes_map.values():
        node["children"] = [c for c in node.get("children", []) if c in nodes_map]

    analyses: Dict[str, Dict[str, Any]] = {}
    child_move: Dict[str, List[int]] = {}
    unrecoverable = 0
    for node_id, node in nodes_map.items():
        analyses[node_id] = analyse(node["board"], node["currentPlayer"])
        for child_id in node["children"]:
            move = infer_move(node["board"], nodes_map[child_id]["board"])
            if move is not None:
                child_move.setdefault(child_id, move)
    for node_id, node in nodes_map.items():
        saved = node.get("move")
        if isinstance(saved, list) and len(saved) == 4:
            child_move[node_id] = list(saved)
        elif node.get("parentId") and child_move.get(node_id) is None:
            unrecoverable += 1

    outcomes: Dict[str, Outcome] = {}
    for node_id, node in nodes_map.items():
        existing = node.get("outcome")
        outcomes[node_id] = (
            seed.get(node_id)
            or (existing if existing in (WIN, LOSS) else None)
            or UNKNOWN
        )
    for node_id, node in nodes_map.items():
        # A decided board means the player who just moved won, so the side to
        # move at this node has already lost.
        if analyses[node_id]["winner"] and outcomes[node_id] == UNKNOWN:
            outcomes[node_id] = LOSS

    hits = {"rule1": 0, "rule2": 0, "rule3": 0}
    winning_children: Dict[str, Set[str]] = {}
    order = _postorder(nodes_map)
    for node_id in order:
        kids = nodes_map[node_id]["children"]
        winning_moves = {
            tuple(move) for move in analyses[node_id]["winning_moves"]
        }
        winning_children[node_id] = {
            child_id
            for child_id in kids
            if tuple(child_move.get(child_id, [])) in winning_moves
        }
        if outcomes[node_id] != UNKNOWN:
            continue
        if winning_moves:
            outcomes[node_id] = WIN
            hits["rule1"] += 1
        elif any(outcomes.get(child_id) == WIN for child_id in kids):
            outcomes[node_id] = LOSS
            hits["rule2"] += 1
        elif kids and all(outcomes.get(child_id) == LOSS for child_id in kids):
            outcomes[node_id] = WIN
            hits["rule3"] += 1

    # Rule 1/2: from a decided parent, drop children that are still unknown.
    # Decided children are always kept ("reuse in later exploration").
    drop_edges: Dict[str, Set[str]] = {}
    for node_id, node in nodes_map.items():
        if outcomes[node_id] not in (WIN, LOSS):
            continue
        for child_id in node["children"]:
            if (
                outcomes.get(child_id) == UNKNOWN
                and child_id not in winning_children[node_id]
            ):
                drop_edges.setdefault(node_id, set()).add(child_id)

    # Propagate the cut down unknown descendants only.
    doomed: Set[str] = set()
    stack = [child for children in drop_edges.values() for child in children]
    while stack:
        current = stack.pop()
        if current in doomed or outcomes.get(current) != UNKNOWN:
            continue
        doomed.add(current)
        stack.extend(nodes_map[current]["children"])

    # A node shared by several parents (transposition) must survive if any
    # surviving parent still references it.
    protected: Set[str] = set()
    for node_id, node in nodes_map.items():
        if node_id in doomed:
            continue
        for child_id in node["children"]:
            if child_id in doomed and child_id not in drop_edges.get(node_id, set()):
                protected.add(child_id)
    doomed -= protected

    new_map: Dict[str, Any] = {}
    for node_id, node in nodes_map.items():
        if node_id in doomed:
            continue
        entry = dict(node)
        entry["children"] = [
            c for c in node["children"] if c not in doomed
        ]
        entry["outcome"] = outcomes[node_id]
        entry["analysis"] = {
            "winningMoves": analyses[node_id]["winning_moves"],
            "unsafeMoves": [],
            "gameOver": bool(analyses[node_id]["winner"]),
            "winner": analyses[node_id]["winner"],
        }
        if child_move.get(node_id) is not None:
            entry["move"] = child_move[node_id]
        parent_id = entry.get("parentId")
        if parent_id and parent_id not in nodes_map:
            entry.pop("parentId", None)
        elif parent_id in doomed:
            entry.pop("parentId", None)
        new_map[node_id] = entry

    new_edges = [
        edge
        for edge in edges
        if edge.get("source") in new_map and edge.get("target") in new_map
    ]
    new_nodes = [node for node in nodes if node.get("id") in new_map]
    selected = graph.get("selectedNodeId")
    new_graph = {
        "nodes": new_nodes,
        "edges": new_edges,
        "nodesMap": new_map,
        "selectedNodeId": selected if selected in new_map else (order[-1] if order else None),
    }

    stats = {
        "nodes_before": len(nodes_map),
        "nodes_after": len(new_map),
        "nodes_removed": len(doomed),
        "edges_before": len(edges),
        "edges_after": len(new_edges),
        "outcome_win": sum(1 for value in outcomes.values() if value == WIN),
        "outcome_loss": sum(1 for value in outcomes.values() if value == LOSS),
        "outcome_unknown": sum(1 for value in outcomes.values() if value == UNKNOWN),
        "rule_hits": hits,
        "decided_children_kept": sum(
            1
            for node_id, children in drop_edges.items()
            for child_id in nodes_map[node_id]["children"]
            if outcomes.get(child_id) != UNKNOWN and child_id not in doomed
        ),
        "unrecoverable_moves": unrecoverable,
    }
    return new_graph, stats


def seed_from_colors(graph: Dict[str, Any], mapping: Dict[str, Outcome]) -> Dict[str, Outcome]:
    """Build an outcome seed from existing node colours (explicit caller choice)."""
    return {
        node_id: mapping[node.get("color")]
        for node_id, node in graph.get("nodesMap", {}).items()
        if node.get("color") in mapping
    }


# Migration mapping agreed with the user. These hex values mirror
# frontend/src/constants/colors.ts (POSITION_COLORS). Keep them in sync.
DEFAULT_SEED_MAPPING: Dict[str, Outcome] = {
    "#285294": WIN,   # old "winning" marker -> certain win
    "#ffff99": LOSS,  # old "must not choose" -> losing
    "#ff99ff": LOSS,  # old "no moves" -> losing
}
OUTCOME_COLOR: Dict[str, str] = {
    WIN: "#0f766e",   # POSITION_COLORS.certainWin (new colour)
    LOSS: "#ffff99",  # POSITION_COLORS.losing
}
DECIDED_COLOR = "#285294"  # POSITION_COLORS.winning (decided board only)


def recolor_from_outcome(graph: Dict[str, Any]) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """Migrate persisted colours to the new semantics.

    * a decided board (three in a row) keeps ``#285294``
    * ``outcome == win``  -> new ``certainWin`` colour
    * ``outcome == loss`` -> ``losing`` colour
    * unknown nodes keep whatever colour they had (white / manual memos)

    The engine itself stays colour-independent; this is an explicit migration
    step so the old marker colours do not clash with the new meaning.
    """
    counts = {"certainWin": 0, "losing": 0, "decided": 0, "unchanged": 0}
    new_map: Dict[str, Any] = {}
    for node_id, node in graph.get("nodesMap", {}).items():
        entry = dict(node)
        analysis = entry.get("analysis") or {}
        outcome = entry.get("outcome")
        if analysis.get("gameOver") and analysis.get("winner"):
            entry["color"] = DECIDED_COLOR
            counts["decided"] += 1
        elif outcome in OUTCOME_COLOR:
            entry["color"] = OUTCOME_COLOR[outcome]
            counts["certainWin" if outcome == WIN else "losing"] += 1
        else:
            counts["unchanged"] += 1
        new_map[node_id] = entry
    return {**graph, "nodesMap": new_map}, counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game-type", default="neutreeko", choices=("neutreeko",))
    parser.add_argument("--apply", action="store_true", help="write the result")
    parser.add_argument(
        "--no-seed", action="store_true",
        help="do not seed outcomes from existing colours (board-only evaluation)",
    )
    parser.add_argument(
        "--no-recolor", action="store_true",
        help="keep the original colours instead of migrating to the new palette",
    )
    args = parser.parse_args()

    graph = storage.load_graph(args.game_type)
    seed = {} if args.no_seed else seed_from_colors(graph, DEFAULT_SEED_MAPPING)
    print(f"seed mapping: {json.dumps(DEFAULT_SEED_MAPPING)} ({len(seed)} seeded)")

    result, stats = apply_exploration_rules(graph, seed)
    print(json.dumps(stats, indent=2))

    if not args.no_recolor:
        result, recolor_stats = recolor_from_outcome(result)
        print(f"recolor: {json.dumps(recolor_stats)}")

    if not args.apply:
        print("\n(dry run: no files written; pass --apply to persist)")
        return

    path = storage.GRAPH_FILES[args.game_type]
    backup = path.with_suffix(path.suffix + ".bak")
    if path.exists():
        Path(backup).write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    storage.save_graph(args.game_type, result)
    print(f"\nwrote {path} (backup: {backup})")


if __name__ == "__main__":
    main()
