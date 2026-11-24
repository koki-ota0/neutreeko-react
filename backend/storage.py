"""Graph persistence.

Paths are anchored to this file (the old relative ``data/...`` paths silently
used a different directory depending on where uvicorn was started).  Writes are
atomic, validated, size-limited and degrade cleanly when Redis is unavailable.
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from . import rules
except ImportError:
    import rules  # type: ignore[no-redef]

DATA_DIR = Path(__file__).resolve().parent / "data"
GRAPH_FILES = {
    "neutreeko": DATA_DIR / "neutreeko_graph.json",
    "pyrga": DATA_DIR / "pyrga_graph.json",
}
MAX_GRAPH_BYTES = int(os.getenv("MAX_GRAPH_BYTES", str(32 * 1024 * 1024)))
REDIS_KEY_PREFIX = "graph:"


class StorageError(RuntimeError):
    """Raised for persistence failures so the API can return a 5xx with a body."""


def _make_redis_client():
    url = os.getenv("REDIS_URL")
    if not url:
        return None
    try:
        import redis  # optional dependency in local development
    except ImportError:
        return None
    return redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)


redis_client = _make_redis_client()


def create_initial_graph(game_type: str) -> Dict[str, Any]:
    """A single root node in the canonical board shape for that game."""
    root_id = "node_0"
    board: Any
    if game_type == "neutreeko":
        board = [row[:] for row in rules.NEUTREEKO_INITIAL_BOARD]
    else:
        board = rules.empty_pyrga_board()
    root_node: Dict[str, Any] = {
        "id": root_id,
        "board": board,
        "currentPlayer": "B",
        "children": [],
        "color": "#ffffff",
        "hidden": False,
        "hiddenChildren": False,
        "position": {"x": 100, "y": 100},
    }
    if game_type == "pyrga":
        root_node["lastMove"] = None
    return {
        "nodes": [{"id": root_id, "position": {"x": 100, "y": 100}}],
        "edges": [],
        "nodesMap": {root_id: root_node},
        "selectedNodeId": root_id,
    }


def normalize_graph(game_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Repair legacy/saved graphs on the way in (and before writing them out)."""
    graph = dict(data)
    nodes_map = graph.get("nodesMap") or {}
    normalized_map: Dict[str, Any] = {}
    for node_id, node in nodes_map.items():
        if not isinstance(node, dict):
            continue
        entry = dict(node)
        entry["id"] = entry.get("id") or node_id
        entry["currentPlayer"] = entry.get("currentPlayer") or "B"
        entry["children"] = list(entry.get("children") or [])
        entry.setdefault("color", "#ffffff")
        entry.setdefault("hidden", False)
        entry.setdefault("hiddenChildren", False)
        if game_type == "pyrga":
            try:
                entry["board"] = rules.normalize_pyrga_board(entry.get("board"))
            except ValueError:
                entry["board"] = rules.empty_pyrga_board()
            entry.setdefault("lastMove", None)
        else:
            entry["board"] = rules.normalize_neutreeko_board(entry.get("board"))
        normalized_map[node_id] = entry
    graph["nodesMap"] = normalized_map
    graph["nodes"] = graph.get("nodes") or []
    graph["edges"] = graph.get("edges") or []
    graph.setdefault("selectedNodeId", None)

    # Drop dangling edges / orphaned parent references left by old delete bugs.
    graph["edges"] = [
        edge
        for edge in graph["edges"]
        if isinstance(edge, dict)
        and edge.get("source") in normalized_map
        and edge.get("target") in normalized_map
    ]
    for entry in normalized_map.values():
        parent_id = entry.get("parentId")
        if parent_id and parent_id not in normalized_map:
            entry.pop("parentId", None)
    return graph


def load_graph(game_type: str) -> Dict[str, Any]:
    if game_type not in GRAPH_FILES:
        raise ValueError(f"Unknown game type: {game_type}")

    if redis_client is not None:
        try:
            raw = redis_client.get(f"{REDIS_KEY_PREFIX}{game_type}")
        except Exception as exc:  # redis.ConnectionError, TimeoutError, ...
            raise StorageError(f"Redis is unavailable: {exc}") from exc
        if raw:
            return normalize_graph(game_type, json.loads(raw))
        return create_initial_graph(game_type)

    path = GRAPH_FILES[game_type]
    if path.exists():
        try:
            with path.open("r", encoding="utf-8") as handle:
                return normalize_graph(game_type, json.load(handle))
        except (OSError, json.JSONDecodeError) as exc:
            raise StorageError(f"Could not read {path.name}: {exc}") from exc
    return create_initial_graph(game_type)


def _atomic_write(path: Path, payload: str) -> None:
    """Write to a temp file in the same directory, then rename.

    A crash or a concurrent save can no longer leave a truncated graph file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_name: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=path.parent,
            prefix=f".{path.name}.", suffix=".tmp", delete=False,
        ) as handle:
            tmp_name = handle.name
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
        # NamedTemporaryFile creates mode 0600; keep the data file readable by
        # the deploy user / other processes (the original file was 0644).
        os.chmod(path, 0o644)
        tmp_name = None
    finally:
        if tmp_name and os.path.exists(tmp_name):
            os.unlink(tmp_name)


def save_graph(game_type: str, data: Dict[str, Any]) -> None:
    if game_type not in GRAPH_FILES:
        raise ValueError(f"Unknown game type: {game_type}")

    graph = normalize_graph(game_type, data)
    payload = json.dumps(graph, ensure_ascii=False, indent=2)
    size = len(payload.encode("utf-8"))
    if size > MAX_GRAPH_BYTES:
        raise StorageError(
            f"graph is too large ({size} bytes > {MAX_GRAPH_BYTES} bytes)"
        )

    if redis_client is not None:
        try:
            redis_client.set(f"{REDIS_KEY_PREFIX}{game_type}", payload)
        except Exception as exc:
            raise StorageError(f"Redis is unavailable: {exc}") from exc
        return

    _atomic_write(GRAPH_FILES[game_type], payload)
