from fastapi import FastAPI
from pydantic import BaseModel
from typing import Any, List, Tuple, Set
import os
import json

BOARD_SIZE = 5
EMPTY = "."
BLACK = "B"
WHITE = "W"
DIRECTIONS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

app = FastAPI()

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GRAPH_FILE = "data/graph_data.json"


def create_initial_graph():
    root_id = "node_0"
    root_board = [
        [".", "W", ".", "W", "."],
        [".", ".", "B", ".", "."],
        [".", ".", ".", ".", "."],
        [".", ".", "W", ".", "."],
        [".", "B", ".", "B", "."],
    ]
    root_node = {
        "id": root_id,
        "board": root_board,
        "currentPlayer": BLACK,
        "children": [],
    }
    return {
        "nodes": [
            {"id": root_id, "data": {"label": "root"}, "position": {"x": 100, "y": 100}}
        ],
        "edges": [],
        "nodesMap": {root_id: root_node},
        "selectedNodeId": root_id,
    }


@app.get("/load_graph")
def load_graph():
    if os.path.exists(GRAPH_FILE):
        print("Loading graph from file.")
        with open(GRAPH_FILE, "r") as f:
            return json.load(f)
    else:
        print("Graph file not found. Returning initial graph.")
        # 保存ファイルがない場合は初期グラフを返す
        return create_initial_graph()


@app.post("/save_graph")
def save_graph(data: dict):
    os.makedirs(os.path.dirname(GRAPH_FILE), exist_ok=True)
    with open(GRAPH_FILE, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return {"status": "ok"}


class MoveRequest(BaseModel):
    board: List[List[str]]
    player: str


class MoveResponse(BaseModel):
    moves: List[List[int]]  # r1,c1,r2,c2


def board_move_key(r1: int, c1: int, r2: int, c2: int) -> Tuple[int, int, int, int]:
    """左右対称を考慮したキー生成"""
    # 左右反転後の列は BOARD_SIZE-1-c
    mirror = (r1, BOARD_SIZE - 1 - c1, r2, BOARD_SIZE - 1 - c2)
    normal = (r1, c1, r2, c2)
    # 小さい方をキーとして使う
    return min(normal, mirror)


from typing import List, Set, Tuple


def board_move_key(r1, c1, r2, c2):
    return (r1, c1, r2, c2)


def check_win(board: list[list[str]], player: str) -> bool:
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if board[r][c] == player:
                for dr, dc in DIRECTIONS:
                    rr, cc = r, c
                    count = 0
                    for _ in range(3):
                        if (
                            0 <= rr < BOARD_SIZE
                            and 0 <= cc < BOARD_SIZE
                            and board[rr][cc] == player
                        ):
                            count += 1
                            rr += dr
                            cc += dc
                    if count == 3:
                        return True
    return False


def opponent_moves_lead_to_win(board: list[list[str]], opponent: str) -> bool:
    """相手が次の手で勝利する手があるか"""
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if board[r][c] == opponent:
                for dr, dc in DIRECTIONS:
                    nr, nc = r + dr, c + dc
                    while (
                        0 <= nr < BOARD_SIZE
                        and 0 <= nc < BOARD_SIZE
                        and board[nr][nc] == EMPTY
                    ):
                        nr += dr
                        nc += dc
                    end_r, end_c = nr - dr, nc - dc
                    if (end_r, end_c) != (r, c):
                        # 仮に相手がこの手を打った盤面
                        new_board = [row[:] for row in board]
                        new_board[end_r][end_c] = opponent
                        new_board[r][c] = EMPTY
                        if check_win(new_board, opponent):
                            return True
    return False


@app.post("/legal_moves", response_model=MoveResponse)
def legal_moves(req: MoveRequest):
    board = req.board
    player = req.player
    moves = []
    seen: Set[Tuple[int, int, int, int]] = set()

    opponent = "W" if player == "B" else "B"

    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if board[r][c] == player:
                for dr, dc in DIRECTIONS:
                    nr, nc = r + dr, c + dc
                    while (
                        0 <= nr < BOARD_SIZE
                        and 0 <= nc < BOARD_SIZE
                        and board[nr][nc] == EMPTY
                    ):
                        nr += dr
                        nc += dc
                    end_r, end_c = nr - dr, nc - dc
                    if (end_r, end_c) != (r, c):
                        # 仮にこの手を打った盤面
                        new_board = [row[:] for row in board]
                        new_board[end_r][end_c] = player
                        new_board[r][c] = EMPTY

                        # 相手がこの後最善で勝てるか
                        if not opponent_moves_lead_to_win(new_board, opponent):
                            key = board_move_key(r, c, end_r, end_c)
                            if key not in seen:
                                seen.add(key)
                                moves.append([r, c, end_r, end_c])

    return {"moves": moves}
