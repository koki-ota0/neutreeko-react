"""Request/response schemas shared by the API.

There is exactly one definition per model now.  The old ``api.py`` defined
``PyrgaMoveRequest`` and ``MoveResponse`` twice; the second (shadowing) copy
silently changed the contract and made the frontend's payload invalid.
"""

from __future__ import annotations

from typing import List, Literal, Optional, Tuple

from pydantic import BaseModel, Field, field_validator

try:  # package import (``uvicorn backend.api:app`` from the repo root)
    from . import rules
except ImportError:  # top-level import (``uvicorn api:app`` from backend/)
    import rules  # type: ignore[no-redef]

GameType = Literal["neutreeko", "pyrga"]
Player = Literal["B", "W"]
Cell = Literal[".", "B", "W"]


class PyrgaPiece(BaseModel):
    type: Literal["S", "T", "C"]
    player: Player
    direction: Optional[str] = None


class GraphData(BaseModel):
    """The persisted graph.  Used for real validation on POST /save_graph."""

    nodes: List[dict]
    edges: List[dict]
    nodesMap: dict
    selectedNodeId: Optional[str] = None


class NeutreekoMoveRequest(BaseModel):
    board: List[List[Cell]]
    player: Player

    @field_validator("board")
    @classmethod
    def board_must_be_5x5(cls, value: List[List[str]]) -> List[List[str]]:
        if len(value) != rules.NEUTREEKO_SIZE or any(
            len(row) != rules.NEUTREEKO_SIZE for row in value
        ):
            raise ValueError(
                f"board must be {rules.NEUTREEKO_SIZE}x{rules.NEUTREEKO_SIZE}"
            )
        return value


class PyrgaMoveRequest(BaseModel):
    board: List[List[List[PyrgaPiece]]]
    player: Player
    # [row, col, piece] -- the piece placed by the previous player.
    last_move: Optional[Tuple[int, int, PyrgaPiece]] = None

    @field_validator("board", mode="before")
    @classmethod
    def board_must_be_canonical(cls, value: object) -> object:
        # Accepts legacy shapes ("." / [{}] / None cells) and rejects anything
        # that is not a 4x4 grid with a proper 422 instead of a 500.
        return rules.normalize_pyrga_board(value)

    @field_validator("board")
    @classmethod
    def cells_must_be_valid(cls, value: List[List[List[PyrgaPiece]]]) -> List[List[List[PyrgaPiece]]]:
        for row in value:
            for cell in row:
                types = [piece.type for piece in cell]
                if len(types) > 3 or len(types) != len(set(types)):
                    raise ValueError("a cell may hold at most one piece of each type")
        return value


class MoveResponse(BaseModel):
    """``moves`` is the complete legal move list.

    ``winning_moves`` / ``unsafe_moves`` are annotations for opt-in pruning;
    ``game_over`` / ``winner`` describe terminal positions.
    """

    moves: List[List[int]]
    winning_moves: List[List[int]] = Field(default_factory=list)
    unsafe_moves: List[List[int]] = Field(default_factory=list)
    game_over: bool = False
    winner: Optional[Player] = None
