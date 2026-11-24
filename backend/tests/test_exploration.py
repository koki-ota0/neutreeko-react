"""Tests for the colour-independent exploration pruning rules."""

import json
import sys

from backend import exploration, rules


def board_with_win_available():
    # (4,1) slides north to (0,1) and completes B's row.
    return [
        ["B", ".", "B", ".", "."],
        ["W", ".", "W", ".", "."],
        [".", ".", ".", ".", "."],
        [".", ".", ".", "W", "."],
        [".", "B", ".", ".", "."],
    ]


def make_graph(root_board, children):
    """children: list of (board, outcome_or_None)."""
    nodes_map = {
        "node_0": {
            "id": "node_0",
            "board": root_board,
            "currentPlayer": "B",
            "children": [f"node_{i + 1}" for i in range(len(children))],
            "color": "#ffffff",
        }
    }
    edges = []
    for i, (board, outcome) in enumerate(children, start=1):
        node_id = f"node_{i}"
        entry = {
            "id": node_id,
            "board": board,
            "currentPlayer": "W",
            "parentId": "node_0",
            "children": [],
            "color": "#ffffff",
        }
        if outcome:
            entry["outcome"] = outcome
        nodes_map[node_id] = entry
        edges.append({"id": f"e_0_{i}", "source": "node_0", "target": node_id})
    return {
        "nodes": [{"id": nid, "position": {"x": 0, "y": 0}} for nid in nodes_map],
        "edges": edges,
        "nodesMap": nodes_map,
        "selectedNodeId": "node_0",
    }


def test_infer_move_recovers_a_single_slide():
    board = board_with_win_available()
    after = rules.apply_neutreeko_move(board, [4, 1, 0, 1])
    assert exploration.infer_move(board, after) == [4, 1, 0, 1]
    assert exploration.infer_move(board, board) is None


def test_rule1_keeps_only_the_winning_move_and_decided_children():
    board = board_with_win_available()
    winning_child = rules.apply_neutreeko_move(board, [4, 1, 0, 1])
    other_child = rules.apply_neutreeko_move(board, [0, 0, 0, 1])
    graph = make_graph(
        board,
        [
            (winning_child, None),
            (other_child, None),
            (other_child, "loss"),  # already decided -> must be reused
        ],
    )
    result, stats = exploration.apply_exploration_rules(graph)
    assert stats["rule_hits"]["rule1"] == 1
    assert result["nodesMap"]["node_0"]["outcome"] == "win"
    assert result["nodesMap"]["node_0"]["children"] == ["node_1", "node_3"]
    assert "node_2" not in result["nodesMap"]
    assert "node_3" in result["nodesMap"]  # decided child kept
    assert stats["decided_children_kept"] >= 1


def test_rule2_marks_parent_as_loss_when_a_child_is_win():
    # Neutral board: rule 1 must not fire, otherwise it wins the tie-break.
    board = rules.NEUTREEKO_INITIAL_BOARD
    # Both resulting boards are quiet for W, so only the explicit seed decides.
    child = rules.apply_neutreeko_move(board, [1, 2, 0, 2])
    other = rules.apply_neutreeko_move(board, [4, 1, 3, 0])
    graph = make_graph(board, [(child, "win"), (other, None)])
    result, stats = exploration.apply_exploration_rules(graph)
    assert stats["rule_hits"]["rule2"] == 1
    assert result["nodesMap"]["node_0"]["outcome"] == "loss"
    assert result["nodesMap"]["node_0"]["children"] == ["node_1"]
    assert "node_2" not in result["nodesMap"]


def test_rule3_marks_parent_as_win_when_all_children_are_loss():
    board = board_with_win_available()
    # Use a board with no winning move so rule 1 does not fire first.
    neutral = rules.NEUTREEKO_INITIAL_BOARD
    child = rules.apply_neutreeko_move(neutral, [1, 2, 2, 2])
    graph = make_graph(neutral, [(child, "loss"), (child, "loss")])
    result, stats = exploration.apply_exploration_rules(graph)
    assert stats["rule_hits"]["rule3"] == 1
    assert result["nodesMap"]["node_0"]["outcome"] == "win"
    assert len(result["nodesMap"]["node_0"]["children"]) == 2


def test_decided_nodes_are_never_removed():
    board = board_with_win_available()
    child = rules.apply_neutreeko_move(board, [0, 0, 0, 1])
    graph = make_graph(board, [(child, "win"), (child, "loss")])
    result, stats = exploration.apply_exploration_rules(graph)
    assert stats["nodes_removed"] == 0
    assert set(result["nodesMap"]) == set(graph["nodesMap"])


def test_rule_results_are_persisted_as_outcome_and_analysis():
    board = board_with_win_available()
    child = rules.apply_neutreeko_move(board, [4, 1, 0, 1])
    graph = make_graph(board, [(child, None)])
    result, _ = exploration.apply_exploration_rules(graph)
    assert result["nodesMap"]["node_0"]["outcome"] == "win"
    assert result["nodesMap"]["node_0"]["analysis"]["winningMoves"]
    assert result["nodesMap"]["node_1"]["move"] == [4, 1, 0, 1]


def test_input_graph_is_not_mutated():
    board = board_with_win_available()
    child = rules.apply_neutreeko_move(board, [4, 1, 0, 1])
    graph = make_graph(board, [(child, None)])
    exploration.apply_exploration_rules(graph)
    assert "outcome" not in graph["nodesMap"]["node_0"]
    assert "analysis" not in graph["nodesMap"]["node_0"]


def test_seed_from_colors_is_explicit():
    graph = {
        "nodesMap": {
            "a": {"color": "#285294"},
            "b": {"color": "#ffffff"},
        }
    }
    assert exploration.seed_from_colors(graph, {"#285294": "win"}) == {"a": "win"}


def test_default_seed_mapping_matches_the_agreed_migration():
    assert exploration.DEFAULT_SEED_MAPPING == {
        "#285294": "win",
        "#ffff99": "loss",
        "#ff99ff": "loss",
    }
    assert exploration.OUTCOME_COLOR["win"] == "#0f766e"
    assert exploration.OUTCOME_COLOR["loss"] == "#ffff99"
    assert exploration.DECIDED_COLOR == "#285294"
    assert exploration.OUTCOME_COLOR["win"] != exploration.DECIDED_COLOR


def test_recolor_migrates_outcomes_to_the_new_palette():
    graph = {
        "nodes": [],
        "edges": [],
        "nodesMap": {
            "old_win": {"id": "old_win", "color": "#285294", "outcome": "win"},
            "old_loss": {"id": "old_loss", "color": "#ffff99", "outcome": "loss"},
            "old_nomoves": {"id": "old_nomoves", "color": "#ff99ff", "outcome": "loss"},
            "decided": {
                "id": "decided", "color": "#285294", "outcome": "loss",
                "analysis": {"gameOver": True, "winner": "B"},
            },
            "white": {"id": "white", "color": "#ffffff", "outcome": "unknown"},
            "memo": {"id": "memo", "color": "#99ff99"},
        },
        "selectedNodeId": "old_win",
    }
    result, counts = exploration.recolor_from_outcome(graph)
    colors = result["nodesMap"]
    assert colors["old_win"]["color"] == "#0f766e"
    assert colors["old_loss"]["color"] == "#ffff99"
    assert colors["old_nomoves"]["color"] == "#ffff99"
    assert colors["decided"]["color"] == "#285294"
    assert colors["white"]["color"] == "#ffffff"
    assert colors["memo"]["color"] == "#99ff99"  # manual memos untouched
    assert counts == {
        "certainWin": 1, "losing": 2, "decided": 1, "unchanged": 2,
    }
    # Input is not mutated.
    assert graph["nodesMap"]["old_win"]["color"] == "#285294"


def test_cli_apply_writes_backup_and_migrated_graph(tmp_path, monkeypatch):
    board = rules.NEUTREEKO_INITIAL_BOARD
    child = rules.apply_neutreeko_move(board, [1, 2, 0, 2])
    graph = make_graph(board, [(child, None)])
    graph["nodesMap"]["node_0"]["color"] = "#285294"  # agreed legacy seed
    original = json.dumps(graph, ensure_ascii=False)
    path = tmp_path / "neutreeko_graph.json"
    path.write_text(original, encoding="utf-8")
    monkeypatch.setattr(
        exploration.storage, "GRAPH_FILES",
        {**exploration.storage.GRAPH_FILES, "neutreeko": path},
    )
    monkeypatch.setattr(exploration.storage, "redis_client", None)
    monkeypatch.setattr(sys, "argv", ["exploration", "--apply"])

    exploration.main()

    backup = path.with_suffix(path.suffix + ".bak")
    assert json.loads(backup.read_text(encoding="utf-8")) == json.loads(original)
    saved = json.loads(path.read_text(encoding="utf-8"))
    assert saved["nodesMap"]["node_0"]["outcome"] == "win"
    assert saved["nodesMap"]["node_0"]["color"] == "#0f766e"
    assert "node_1" not in saved["nodesMap"]  # unknown branch pruned
    assert saved["nodesMap"]["node_0"]["children"] == []
