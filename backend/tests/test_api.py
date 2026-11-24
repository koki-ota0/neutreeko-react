"""API contract tests: schemas, status codes, normalization and persistence."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import api, rules, storage

client = TestClient(api.app)


@pytest.fixture
def temp_storage(tmp_path, monkeypatch):
    """Redirect graph files to a temp dir so tests never touch real data."""
    monkeypatch.setattr(
        storage,
        "GRAPH_FILES",
        {name: tmp_path / f"{name}.json" for name in ("neutreeko", "pyrga")},
    )
    monkeypatch.setattr(storage, "redis_client", None)
    monkeypatch.setattr(api, "API_TOKEN", None)
    return tmp_path


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_unknown_game_type_returns_422_not_200():
    assert client.get("/load_graph?game_type=bogus").status_code == 422
    assert client.post("/save_graph?game_type=bogus", json={}).status_code == 422


def test_neutreeko_returns_all_moves_with_analysis():
    response = client.post(
        "/legal_moves/neutreeko",
        json={"board": rules.NEUTREEKO_INITIAL_BOARD, "player": "B"},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["moves"]) == 14
    assert len(body["unsafe_moves"]) == 4
    assert body["game_over"] is False


def test_neutreeko_terminal_position_is_reported():
    board = [
        ["B", "B", "B", ".", "."],
        ["W", ".", "W", ".", "."],
        [".", ".", ".", ".", "."],
        [".", ".", ".", ".", "W"],
        [".", ".", ".", ".", "."],
    ]
    body = client.post(
        "/legal_moves/neutreeko", json={"board": board, "player": "W"}
    ).json()
    assert body["moves"] == []
    assert body["game_over"] is True
    assert body["winner"] == "B"


@pytest.mark.parametrize(
    "payload",
    [
        {"board": [["B"]], "player": "B"},                       # not 5x5
        {"board": [["B"]] * 5, "player": "B"},                   # short rows
        {"board": rules.NEUTREEKO_INITIAL_BOARD, "player": "X"},  # bad player
        {"board": [["Z"] * 5] * 5, "player": "B"},               # bad cell
    ],
)
def test_neutreeko_rejects_invalid_input_with_422(payload):
    assert client.post("/legal_moves/neutreeko", json=payload).status_code == 422


def test_pyrga_first_and_second_move(tmp_path):
    board = rules.empty_pyrga_board()
    first = client.post(
        "/legal_moves/pyrga", json={"board": board, "player": "B"}
    )
    assert first.status_code == 200
    assert len(first.json()["moves"]) == 48

    board[0][0] = [{"type": "S", "player": "B"}]
    second = client.post(
        "/legal_moves/pyrga",
        json={
            "board": board,
            "player": "W",
            "last_move": [0, 0, {"type": "S", "player": "B"}],
        },
    )
    # Previously this was a 500: can_place() subscripted a Pydantic model.
    assert second.status_code == 200
    assert [1, 0, 0] in second.json()["moves"]


def test_pyrga_accepts_legacy_saved_board_shape():
    legacy = [[{} for _ in range(4)] for _ in range(4)]
    legacy[0][0] = [{"type": "S", "player": "B"}]
    response = client.post(
        "/legal_moves/pyrga", json={"board": legacy, "player": "W"}
    )
    assert response.status_code == 200
    assert len(response.json()["moves"]) == 47  # 48 minus the duplicate S


def test_pyrga_string_board_from_initial_graph_is_normalized():
    board = [["." for _ in range(4)] for _ in range(4)]
    response = client.post(
        "/legal_moves/pyrga", json={"board": board, "player": "B"}
    )
    assert response.status_code == 200
    assert len(response.json()["moves"]) == 48


def test_pyrga_rejects_bad_last_move_and_board():
    board = rules.empty_pyrga_board()
    bad_coord = client.post(
        "/legal_moves/pyrga",
        json={
            "board": board,
            "player": "W",
            "last_move": [9, 9, {"type": "S", "player": "B"}],
        },
    )
    assert bad_coord.status_code == 422

    bad_string = client.post(
        "/legal_moves/pyrga",
        json={"board": board, "player": "W", "last_move": [0, 0, "S"]},
    )
    assert bad_string.status_code == 422

    assert client.post(
        "/legal_moves/pyrga", json={"board": [[[]]], "player": "B"}
    ).status_code == 422


def test_load_graph_normalizes_legacy_pyrga_data(temp_storage):
    path = storage.GRAPH_FILES["pyrga"]
    path.write_text(
        json.dumps(
            {
                "nodes": [{"id": "node_0", "position": {"x": 0, "y": 0}}],
                "edges": [{"id": "e1", "source": "node_0", "target": "ghost"}],
                "nodesMap": {
                    "node_0": {
                        "id": "node_0",
                        "board": [[{} for _ in range(4)] for _ in range(4)],
                        "currentPlayer": "B",
                        "children": [],
                    }
                },
                "selectedNodeId": "node_0",
            }
        ),
        encoding="utf-8",
    )
    body = client.get("/load_graph?game_type=pyrga").json()
    assert body["nodesMap"]["node_0"]["board"] == rules.empty_pyrga_board()
    assert body["nodesMap"]["node_0"]["hidden"] is False
    assert body["edges"] == []  # dangling edge dropped


def test_save_graph_validates_body_and_writes_atomically(temp_storage):
    assert client.post(
        "/save_graph?game_type=neutreeko", json={"totally": "wrong"}
    ).status_code == 422

    payload = {
        "nodes": [{"id": "node_0", "position": {"x": 1, "y": 2}}],
        "edges": [],
        "nodesMap": {
            "node_0": {
                "id": "node_0",
                "board": rules.NEUTREEKO_INITIAL_BOARD,
                "currentPlayer": "B",
                "children": [],
            }
        },
        "selectedNodeId": "node_0",
    }
    response = client.post("/save_graph?game_type=neutreeko", json=payload)
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert json.loads(storage.GRAPH_FILES["neutreeko"].read_text())["nodesMap"]["node_0"]["hidden"] is False
    assert list(temp_storage.glob(".*.tmp")) == []


def test_save_graph_can_require_a_token(temp_storage, monkeypatch):
    monkeypatch.setattr(api, "API_TOKEN", "secret")
    payload = {"nodes": [], "edges": [], "nodesMap": {}, "selectedNodeId": None}
    assert client.post("/save_graph?game_type=pyrga", json=payload).status_code == 401
    assert (
        client.post(
            "/save_graph?game_type=pyrga",
            json=payload,
            headers={"X-API-Token": "secret"},
        ).status_code
        == 200
    )


def test_initial_pyrga_graph_uses_canonical_board():
    graph = storage.create_initial_graph("pyrga")
    assert graph["nodesMap"]["node_0"]["board"] == rules.empty_pyrga_board()
    assert graph["nodesMap"]["node_0"]["lastMove"] is None
