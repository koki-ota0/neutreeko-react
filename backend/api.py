from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Optional, Tuple, Set
import os
import json

app = FastAPI()

# ----------------- Supabase設定 -----------------
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
supabase_client = None

if SUPABASE_URL and SUPABASE_KEY:
    from supabase import create_client
    supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)

from fastapi.middleware.cors import CORSMiddleware

# 環境変数からCORS許可オリジンを取得（カンマ区切りで複数指定可能）
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- 共通定数 -----------------
EMPTY = "."
BLACK = "B"
WHITE = "W"
DIRECTIONS_8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
DIRECTIONS_4 = [(-1, 0), (1, 0), (0, -1), (0, 1)]  # S用


# ----------------- データモデル -----------------
class GraphData(BaseModel):
    nodes: List[dict]
    edges: List[dict]
    nodesMap: dict
    selectedNodeId: str


class NeutreekoMoveRequest(BaseModel):
    board: List[List[str]]  # 5x5
    player: str


class PyrgaMoveRequest(BaseModel):
    board: List[List[List[str]]]  # 4x4, 1セルに複数コマ
    player: str
    last_move: Optional[Tuple[int, int, str]] = None


class MoveResponse(BaseModel):
    moves: List[List[int]]  # Neutreeko: [r1,c1,r2,c2], Pyrga: [r,c,piece_index]


# ----------------- グラフファイル -----------------
GRAPH_FILES = {
    "neutreeko": "data/neutreeko_graph.json",
    "pyrga": "data/pyrga_graph.json",
}


def create_initial_graph(game_type: str):
    if game_type == "neutreeko":
        root_id = "node_0"
        board = [
            [".", "W", ".", "W", "."],
            [".", ".", "B", ".", "."],
            [".", ".", ".", ".", "."],
            [".", ".", "W", ".", "."],
            [".", "B", ".", "B", "."],
        ]
    else:  # pyrga
        root_id = "node_0"
        BOARD_SIZE = 4
        board = [["." for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]

    root_node = {
        "id": root_id,
        "board": board,
        "currentPlayer": "B",
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


# ----------------- API -----------------
@app.get("/load_graph")
def load_graph(game_type: str):
    if game_type not in GRAPH_FILES:
        return {"error": "Unknown game type"}

    # Supabaseがある場合はSupabaseから読み込み
    if supabase_client:
        result = supabase_client.table("graphs").select("data").eq("game_type", game_type).execute()
        if result.data and len(result.data) > 0:
            return result.data[0]["data"]
        return create_initial_graph(game_type)

    # ローカル開発用：ファイルから読み込み
    file = GRAPH_FILES[game_type]
    if os.path.exists(file):
        with open(file, "r") as f:
            return json.load(f)
    return create_initial_graph(game_type)


@app.post("/save_graph")
def save_graph(data: dict, game_type: str):
    if game_type not in GRAPH_FILES:
        return {"error": "Unknown game type"}

    # Supabaseがある場合はSupabaseに保存
    if supabase_client:
        supabase_client.table("graphs").upsert({
            "game_type": game_type,
            "data": data
        }).execute()
        return {"status": "ok"}

    # ローカル開発用：ファイルに保存
    file = GRAPH_FILES[game_type]
    os.makedirs(os.path.dirname(file), exist_ok=True)
    with open(file, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    return {"status": "ok"}


# ----------------- Pyrga用データモデル -----------------
class PyrgaPiece(BaseModel):
    type: str  # "S", "T", "C"
    player: str  # "B" or "W"
    direction: Optional[int] = None  # 三角のみ、0-3など


class PyrgaMoveRequest(BaseModel):
    board: List[List[List[PyrgaPiece]]]  # dict で受け取る
    player: str
    last_move: Optional[Tuple[int, int, PyrgaPiece]] = None


class MoveResponse(BaseModel):
    moves: List[List[int]]  # [r, c, piece_index]


# ----------------- Helper -----------------
def is_inside(r, c):
    return 0 <= r < 4 and 0 <= c < 4


def can_place(cell: List[dict], piece_type: str) -> bool:
    # 同じマスに同じタイプは置けない
    if len(cell) >= 3:
        return False
    return not any(p["type"] == piece_type for p in cell)


def empty_cells(board: List[List[List[dict]]]):
    cells = []
    for r in range(4):
        for c in range(4):
            if board[r][c] is None:
                board[r][c] = []
            if (
                can_place(board[r][c], "S")
                or can_place(board[r][c], "T")
                or can_place(board[r][c], "C")
            ):
                cells.append((r, c))
    return cells


def check_neutreeko_win(board: List[List[str]], player: str) -> bool:
    BOARD_SIZE = len(board)
    DIRECTIONS = DIRECTIONS_8
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
    BOARD_SIZE = len(board)
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if board[r][c] == opponent:
                for dr, dc in DIRECTIONS_8:
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
                        if check_neutreeko_win(new_board, opponent):
                            return True
    return False


def board_move_key(r1, c1, r2, c2):
    return (r1, c1, r2, c2)


# ----------------- Legal Moves -----------------
@app.post("/legal_moves/neutreeko", response_model=MoveResponse)
def legal_moves(req: NeutreekoMoveRequest):
    BOARD_SIZE = len(req.board)
    board = req.board
    player = req.player
    moves = []
    seen: Set[Tuple[int, int, int, int]] = set()

    opponent = "W" if player == "B" else "B"

    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if board[r][c] == player:
                for dr, dc in DIRECTIONS_8:
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


@app.post("/legal_moves/pyrga", response_model=MoveResponse)
def legal_moves_pyrga(req: PyrgaMoveRequest):
    board = req.board
    piece_types = ["S", "T", "C"]
    moves = []

    # board のセルが None や {} だったら空配列に変換
    for r in range(4):
        for c in range(4):
            if not isinstance(board[r][c], list):
                board[r][c] = []
            else:
                # dict のリストを PyrgaPiece に変換
                for i, p in enumerate(board[r][c]):
                    if not isinstance(p, PyrgaPiece):
                        board[r][c][i] = PyrgaPiece(**p)

    last_piece = None
    if req.last_move:
        lr, lc, last_piece_dict = req.last_move
        if isinstance(last_piece_dict, dict):
            last_piece = PyrgaPiece(**last_piece_dict)
        else:
            last_piece = last_piece_dict
    else:
        # 初手: 空きセルにどのコマでも置ける
        for r, c in empty_cells(board):
            for idx, _ in enumerate(piece_types):
                moves.append([r, c, idx])
        return {"moves": moves}

    lr, lc = req.last_move[0], req.last_move[1]

    if last_piece.type == "S":
        # 隣接マス
        for dr, dc in DIRECTIONS_4:
            nr, nc = lr + dr, lc + dc
            if is_inside(nr, nc) and can_place(board[nr][nc], last_piece.type):
                for idx, _ in enumerate(piece_types):
                    moves.append([nr, nc, idx])
    elif last_piece.type == "T":
        # 8方向ライン
        for dr, dc in DIRECTIONS_8:
            nr, nc = lr + dr, lc + dc
            while is_inside(nr, nc) and can_place(board[nr][nc], last_piece.type):
                for idx, _ in enumerate(piece_types):
                    moves.append([nr, nc, idx])
                nr += dr
                nc += dc
    elif last_piece.type == "C":
        # 同じマス
        if can_place(board[lr][lc], last_piece.type):
            for idx, _ in enumerate(piece_types):
                moves.append([lr, lc, idx])

    return {"moves": moves}
