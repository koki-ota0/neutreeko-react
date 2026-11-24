"""Pure game-rule helpers.

This module has no FastAPI, Redis, or filesystem dependencies so it can be unit
tested directly.  The two games use different, *canonical* board shapes:

* Neutreeko: ``list[list[str]]`` of 5x5 cells (``"."``, ``"B"``, ``"W"``).
* Pyrga: ``list[list[list[dict]]]`` of 4x4 cells; every cell is a list of at
  most three pieces ``{"type": "S"|"T"|"C", "player": "B"|"W"}``.
  A move is ``[row, col, piece_index]`` where piece_index maps to PIECE_TYPES.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

Player = Literal["B", "W"]
PieceType = Literal["S", "T", "C"]

EMPTY = "."
NEUTREEKO_SIZE = 5
PYRGA_SIZE = 4
PIECE_TYPES: Tuple[str, ...] = ("S", "T", "C")

DIRECTIONS_8: Tuple[Tuple[int, int], ...] = (
    (-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)
)
DIRECTIONS_4: Tuple[Tuple[int, int], ...] = ((-1, 0), (1, 0), (0, -1), (0, 1))
# Only these four directions need checking for a three-in-a-row (the other four
# are the same lines traversed backwards).
WIN_DIRECTIONS: Tuple[Tuple[int, int], ...] = ((0, 1), (1, 0), (1, 1), (1, -1))

NEUTREEKO_INITIAL_BOARD: List[List[str]] = [
    [".", "W", ".", "W", "."],
    [".", ".", "B", ".", "."],
    [".", ".", ".", ".", "."],
    [".", ".", "W", ".", "."],
    [".", "B", ".", "B", "."],
]


def opponent(player: str) -> str:
    return "W" if player == "B" else "B"


def empty_pyrga_board() -> List[List[List[Dict[str, str]]]]:
    return [[[] for _ in range(PYRGA_SIZE)] for _ in range(PYRGA_SIZE)]


# --------------------------------------------------------------------------
# Neutreeko
# --------------------------------------------------------------------------
def check_neutreeko_win(board: Sequence[Sequence[str]], player: str) -> bool:
    """True when ``player`` has three consecutive pieces in any direction."""
    size = len(board)
    for r in range(size):
        for c in range(size):
            if board[r][c] != player:
                continue
            for dr, dc in WIN_DIRECTIONS:
                if all(
                    0 <= r + dr * i < size
                    and 0 <= c + dc * i < size
                    and board[r + dr * i][c + dc * i] == player
                    for i in range(3)
                ):
                    return True
    return False


def apply_neutreeko_move(board: Sequence[Sequence[str]], move: Sequence[int]) -> List[List[str]]:
    r1, c1, r2, c2 = move
    new_board = [list(row) for row in board]
    piece = new_board[r1][c1]
    new_board[r1][c1] = EMPTY
    new_board[r2][c2] = piece
    return new_board


def neutreeko_moves(board: Sequence[Sequence[str]], player: str) -> List[List[int]]:
    """Every legal sliding move. No strategic filtering happens here."""
    size = len(board)
    moves: List[List[int]] = []
    for r in range(size):
        for c in range(size):
            if board[r][c] != player:
                continue
            for dr, dc in DIRECTIONS_8:
                nr, nc = r + dr, c + dc
                while 0 <= nr < size and 0 <= nc < size and board[nr][nc] == EMPTY:
                    nr += dr
                    nc += dc
                end_r, end_c = nr - dr, nc - dc
                if (end_r, end_c) != (r, c):
                    moves.append([r, c, end_r, end_c])
    return moves


def opponent_has_winning_reply(board: Sequence[Sequence[str]], opp: str) -> bool:
    """True when ``opp`` can win with a single move from ``board``."""
    for move in neutreeko_moves(board, opp):
        if check_neutreeko_win(apply_neutreeko_move(board, move), opp):
            return True
    return False


def neutreeko_analysis(board: Sequence[Sequence[str]], player: str) -> Dict[str, Any]:
    """Full move generation plus explicit, opt-in analysis fields.

    ``moves`` is *all* legal moves.  ``winning_moves`` / ``unsafe_moves`` are
    annotations the caller may use for pruning; they never remove moves from
    the tree by themselves.  A decided position is terminal (``game_over``).
    """
    winner: Optional[str] = next(
        (p for p in ("B", "W") if check_neutreeko_win(board, p)), None
    )
    if winner is not None:
        return {
            "moves": [],
            "winning_moves": [],
            "unsafe_moves": [],
            "game_over": True,
            "winner": winner,
        }

    opp = opponent(player)
    moves = neutreeko_moves(board, player)
    winning_moves: List[List[int]] = []
    unsafe_moves: List[List[int]] = []
    for move in moves:
        resulting = apply_neutreeko_move(board, move)
        if check_neutreeko_win(resulting, player):
            winning_moves.append(move)
        elif opponent_has_winning_reply(resulting, opp):
            unsafe_moves.append(move)
    return {
        "moves": moves,
        "winning_moves": winning_moves,
        "unsafe_moves": unsafe_moves,
        "game_over": False,
        "winner": None,
    }


# --------------------------------------------------------------------------
# Pyrga
# --------------------------------------------------------------------------
def _piece_type(piece: Any) -> Optional[str]:
    """Read ``type`` from either a dict or a Pydantic model.

    The old code used ``piece["type"]`` and crashed with
    ``TypeError: 'PyrgaPiece' object is not subscriptable`` because Pydantic
    had already turned the dicts into model instances.
    """
    if isinstance(piece, dict):
        return piece.get("type")
    return getattr(piece, "type", None)


def _coerce_piece(raw: Any) -> Optional[Dict[str, Any]]:
    if isinstance(raw, dict):
        piece_type = raw.get("type")
        player = raw.get("player")
        direction = raw.get("direction")
    else:
        piece_type = getattr(raw, "type", None)
        player = getattr(raw, "player", None)
        direction = getattr(raw, "direction", None)
    if piece_type not in PIECE_TYPES or player not in ("B", "W"):
        return None
    piece: Dict[str, Any] = {"type": piece_type, "player": player}
    if direction is not None:
        piece["direction"] = direction
    return piece


def normalize_pyrga_board(raw: Any) -> List[List[List[Dict[str, Any]]]]:
    """Convert any legacy board shape into the canonical 4x4 cell-of-lists form.

    Historically the saved graph contained ``"."`` strings, ``[{}]``
    placeholders and ``None`` cells.  Those shapes made the API return 422 and
    the renderer silently show nothing, so every entry point normalizes first.
    """
    if not isinstance(raw, list) or len(raw) != PYRGA_SIZE:
        raise ValueError(f"board must be a {PYRGA_SIZE}x{PYRGA_SIZE} grid")
    normalized: List[List[List[Dict[str, Any]]]] = []
    for row in raw:
        if not isinstance(row, list) or len(row) != PYRGA_SIZE:
            raise ValueError(f"board must be a {PYRGA_SIZE}x{PYRGA_SIZE} grid")
        new_row: List[List[Dict[str, Any]]] = []
        for cell in row:
            if cell is None or cell == EMPTY or cell == [] or cell == {}:
                new_row.append([])
                continue
            items = cell if isinstance(cell, list) else [cell]
            pieces: List[Dict[str, Any]] = []
            seen = set()
            for item in items:
                piece = _coerce_piece(item)
                if piece is None or piece["type"] in seen:
                    continue
                seen.add(piece["type"])
                pieces.append(piece)
                if len(pieces) >= 3:
                    break
            new_row.append(pieces)
        normalized.append(new_row)
    return normalized


def normalize_neutreeko_board(raw: Any) -> List[List[str]]:
    if not isinstance(raw, list) or len(raw) != NEUTREEKO_SIZE:
        return [row[:] for row in NEUTREEKO_INITIAL_BOARD]
    board: List[List[str]] = []
    for row in raw:
        if not isinstance(row, list) or len(row) != NEUTREEKO_SIZE:
            return [row[:] for row in NEUTREEKO_INITIAL_BOARD]
        board.append([cell if cell in (".", "B", "W") else EMPTY for cell in row])
    return board


def can_place(cell: Sequence[Any], piece_type: str) -> bool:
    """A cell holds at most three pieces and never two of the same type."""
    if len(cell) >= 3:
        return False
    return not any(_piece_type(piece) == piece_type for piece in cell)


def available_piece_indices(cell: Sequence[Any]) -> List[int]:
    return [i for i, piece_type in enumerate(PIECE_TYPES) if can_place(cell, piece_type)]


def _is_inside(r: int, c: int) -> bool:
    return 0 <= r < PYRGA_SIZE and 0 <= c < PYRGA_SIZE


def pyrga_moves(
    board: Sequence[Sequence[Sequence[Any]]],
    player: str,
    last_move: Optional[Sequence[Any]] = None,
) -> List[List[int]]:
    """Legal placements as ``[row, col, piece_index]``.

    The previous piece's type decides *where* a piece may go (S = adjacent,
    T = along an 8-direction line, C = same cell, none = first move/anywhere).
    Only piece types that the destination cell can still accept are emitted.
    """
    moves: List[List[int]] = []
    seen = set()

    def emit(r: int, c: int) -> None:
        for idx in available_piece_indices(board[r][c]):
            key = (r, c, idx)
            if key not in seen:
                seen.add(key)
                moves.append([r, c, idx])

    if last_move is None:
        for r in range(PYRGA_SIZE):
            for c in range(PYRGA_SIZE):
                emit(r, c)
        return moves

    if len(last_move) != 3:
        raise ValueError("last_move must be [row, col, piece]")
    lr, lc, last_piece = last_move
    if not isinstance(lr, int) or not isinstance(lc, int) or not _is_inside(lr, lc):
        raise ValueError("last_move coordinates are outside the board")
    last_type = _piece_type(last_piece)
    if last_type not in PIECE_TYPES:
        raise ValueError("last_move piece has an unknown type")

    if last_type == "S":
        for dr, dc in DIRECTIONS_4:
            r, c = lr + dr, lc + dc
            if _is_inside(r, c):
                emit(r, c)
    elif last_type == "T":
        for dr, dc in DIRECTIONS_8:
            r, c = lr + dr, lc + dc
            # A cell that already holds the blocking type stops the line.
            while _is_inside(r, c) and can_place(board[r][c], last_type):
                emit(r, c)
                r += dr
                c += dc
    elif last_type == "C":
        emit(lr, lc)
    return moves


def pyrga_analysis(
    board: Sequence[Sequence[Sequence[Any]]],
    player: str,
    last_move: Optional[Sequence[Any]] = None,
) -> Dict[str, Any]:
    return {
        "moves": pyrga_moves(board, player, last_move),
        "winning_moves": [],
        "unsafe_moves": [],
        "game_over": False,
        "winner": None,
    }
