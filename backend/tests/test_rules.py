"""Unit tests for the pure rule functions (no HTTP, no I/O)."""

from backend import rules


def test_initial_position_has_all_14_legal_moves():
    moves = rules.neutreeko_moves(rules.NEUTREEKO_INITIAL_BOARD, "B")
    assert len(moves) == 14
    assert len(set(tuple(m) for m in moves)) == 14


def test_win_detection_horizontal_vertical_and_diagonal():
    horizontal = [
        ["B", "B", "B", ".", "."],
        [".", ".", ".", ".", "."],
        ["W", ".", "W", ".", "W"],
        [".", ".", ".", ".", "."],
        [".", ".", ".", ".", "."],
    ]
    assert rules.check_neutreeko_win(horizontal, "B") is True
    assert rules.check_neutreeko_win(horizontal, "W") is False

    diagonal = [
        ["B", ".", ".", ".", "."],
        [".", "B", ".", ".", "."],
        [".", ".", "B", ".", "."],
        [".", ".", ".", "W", "."],
        [".", ".", ".", ".", "W"],
    ]
    assert rules.check_neutreeko_win(diagonal, "B") is True


def test_winning_move_is_returned_even_with_opponent_threat():
    # (4,1) slides north to (0,1) and completes B's row; W also has a winning
    # reply available.  The old filtered endpoint dropped this winning move.
    board = [
        ["B", ".", "B", ".", "."],
        ["W", ".", "W", ".", "."],
        [".", ".", ".", ".", "."],
        [".", ".", ".", "W", "."],
        [".", "B", ".", ".", "."],
    ]
    analysis = rules.neutreeko_analysis(board, "B")
    assert [4, 1, 0, 1] in analysis["moves"]
    assert [4, 1, 0, 1] in analysis["winning_moves"]
    assert [4, 1, 0, 1] not in analysis["unsafe_moves"]


def test_decided_position_is_terminal():
    board = [
        ["B", "B", "B", ".", "."],
        ["W", ".", "W", ".", "."],
        [".", ".", ".", ".", "."],
        [".", ".", ".", ".", "W"],
        [".", ".", ".", ".", "."],
    ]
    analysis = rules.neutreeko_analysis(board, "W")
    assert analysis["moves"] == []
    assert analysis["game_over"] is True
    assert analysis["winner"] == "B"


def test_unsafe_moves_are_annotations_not_deletions():
    analysis = rules.neutreeko_analysis(rules.NEUTREEKO_INITIAL_BOARD, "B")
    assert len(analysis["moves"]) == 14
    assert len(analysis["unsafe_moves"]) == 4
    assert set(tuple(m) for m in analysis["unsafe_moves"]).issubset(
        set(tuple(m) for m in analysis["moves"])
    )


def test_sliding_stops_before_occupied_cell():
    board = [
        ["B", ".", "W", ".", "."],
        [".", ".", ".", ".", "."],
        [".", ".", ".", ".", "."],
        [".", ".", ".", ".", "."],
        [".", ".", ".", ".", "."],
    ]
    moves = rules.neutreeko_moves(board, "B")
    assert [0, 0, 0, 1] in moves
    assert [0, 0, 0, 2] not in moves


def test_pyrga_first_move_offers_every_cell_and_type():
    moves = rules.pyrga_moves(rules.empty_pyrga_board(), "B")
    assert len(moves) == 48
    assert [0, 0, 0] in moves and [3, 3, 2] in moves


def test_pyrga_never_offers_a_duplicate_type_in_a_cell():
    board = rules.empty_pyrga_board()
    board[0][0] = [{"type": "S", "player": "B"}]
    board[0][1] = [{"type": "T", "player": "W"}]
    moves = rules.pyrga_moves(board, "W", [0, 0, {"type": "S", "player": "B"}])
    # Cell (0,1) already has a T, so index 1 must not be offered there.
    assert [0, 1, 0] in moves
    assert [0, 1, 1] not in moves
    assert [0, 1, 2] in moves
    # This used to raise TypeError ('PyrgaPiece' object is not subscriptable).
    assert [1, 0, 0] in moves


def test_pyrga_s_t_c_placement_constraints():
    board = rules.empty_pyrga_board()

    s_moves = rules.pyrga_moves(board, "W", [1, 1, {"type": "S", "player": "B"}])
    cells = {(r, c) for r, c, _ in s_moves}
    assert cells == {(0, 1), (2, 1), (1, 0), (1, 2)}

    c_moves = rules.pyrga_moves(board, "W", [1, 1, {"type": "C", "player": "B"}])
    assert {(r, c) for r, c, _ in c_moves} == {(1, 1)}

    t_moves = rules.pyrga_moves(board, "W", [1, 1, {"type": "T", "player": "B"}])
    assert (0, 0) in {(r, c) for r, c, _ in t_moves}
    assert (3, 3) in {(r, c) for r, c, _ in t_moves}


def test_pyrga_legacy_board_shapes_are_normalized():
    legacy = [[{} for _ in range(4)] for _ in range(4)]
    legacy[0][0] = [{"type": "S", "player": "B"}]
    legacy[1][2] = "."
    legacy[2][3] = None
    normalized = rules.normalize_pyrga_board(legacy)
    assert normalized[0][0] == [{"type": "S", "player": "B"}]
    assert normalized[1][2] == []
    assert normalized[2][3] == []
    assert normalized[3][3] == []


def test_pyrga_normalization_dedupes_and_caps_at_three():
    raw = [[[{"type": "S", "player": "B"}, {"type": "S", "player": "W"},
             {"type": "T", "player": "W"}, {"type": "C", "player": "B"}]] + [[] for _ in range(3)]] + [
        [[] for _ in range(4)] for _ in range(3)
    ]
    cell = rules.normalize_pyrga_board(raw)[0][0]
    assert len(cell) == 3
    assert sorted(p["type"] for p in cell) == ["C", "S", "T"]


def test_can_place_accepts_both_dicts_and_models():
    from backend.schemas import PyrgaPiece

    cell = [PyrgaPiece(type="S", player="B")]
    assert rules.can_place(cell, "S") is False
    assert rules.can_place(cell, "T") is True
    assert rules.available_piece_indices(cell) == [1, 2]
