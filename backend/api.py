"""FastAPI backend for the Neutreeko / Pyrga game-tree explorer.

Run from the repo root with ``uvicorn backend.api:app --reload`` or from this
directory with ``uvicorn api:app --reload``; both import styles are supported.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

try:
    from . import rules, schemas, storage
except ImportError:  # running as ``uvicorn api:app`` from backend/
    import rules  # type: ignore[no-redef]
    import schemas  # type: ignore[no-redef]
    import storage  # type: ignore[no-redef]

app = FastAPI(
    title="Neutreeko / Pyrga game tree API",
    version="2.0.0",
    description="Legal move generation, position analysis and graph persistence.",
)


def _allowed_origins() -> list[str]:
    raw = os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    )
    origins = [origin.strip().rstrip("/") for origin in raw.split(",")]
    return [origin for origin in origins if origin]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-API-Token"],
)

# Optional shared secret for write endpoints.  Unset by default so local
# development needs no configuration, but deployable without exposing
# /save_graph to the public internet.
API_TOKEN = os.getenv("API_TOKEN")


def require_write_token(x_api_token: Optional[str] = Header(default=None)) -> None:
    if API_TOKEN and x_api_token != API_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid or missing API token")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "storage": "redis" if storage.redis_client else "file"}


@app.get("/load_graph")
def load_graph(game_type: schemas.GameType) -> dict:
    """Load the saved graph, normalizing legacy board shapes on the way in."""
    try:
        return storage.load_graph(game_type)
    except storage.StorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/save_graph", dependencies=[Depends(require_write_token)])
def save_graph(data: schemas.GraphData, game_type: schemas.GameType) -> dict:
    """Validate and atomically persist the whole graph."""
    try:
        storage.save_graph(game_type, data.model_dump())
    except storage.StorageError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"status": "ok"}


@app.post("/legal_moves/neutreeko", response_model=schemas.MoveResponse)
def legal_moves_neutreeko(req: schemas.NeutreekoMoveRequest) -> dict:
    """All legal moves for a 5x5 Neutreeko position.

    Unlike the previous implementation this does NOT silently delete moves that
    let the opponent win.  Those are reported in ``unsafe_moves`` instead, and
    immediate wins / decided positions are reported explicitly.
    """
    return rules.neutreeko_analysis(req.board, req.player)


@app.post("/legal_moves/pyrga", response_model=schemas.MoveResponse)
def legal_moves_pyrga(req: schemas.PyrgaMoveRequest) -> dict:
    """Legal placements for a 4x4 Pyrga position.

    ``last_move`` is ``[row, col, {"type": ..., "player": ...}]`` and decides
    where the next piece may be placed.  Moves are ``[row, col, piece_index]``.
    """
    try:
        return rules.pyrga_analysis(req.board, req.player, req.last_move)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
