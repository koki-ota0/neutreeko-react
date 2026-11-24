import {
  NEUTREEKO_SIZE,
  PIECE_TYPES,
  PYRGA_SIZE,
} from "../constants/game";
import {
  GameBoard,
  GameType,
  NeutreekoBoardState,
  PyrgaBoardState,
  PyrgaLastMove,
} from "../types/MyNodeData";
import { Player, PyrgaCell, PyrgaPieceType } from "../types/pyrga";
import { normalizeBoard } from "./moves";

/**
 * Browser-side port of `backend/rules.py`. GitHub Pages cannot call
 * `/legal_moves/*`, so static builds use these pure functions instead. The
 * response shape matches the FastAPI `MoveResponse` (snake_case fields) so
 * `parseAnalysis()` and the graph hook need no special case beyond the call.
 */
export interface MoveResponse {
  /** Allows the graph hook to treat API and static responses uniformly. */
  [key: string]: unknown;
  moves: number[][];
  winning_moves: number[][];
  unsafe_moves: number[][];
  game_over: boolean;
  winner: string | null;
}

const DIRECTIONS_8: Array<[number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
const DIRECTIONS_4: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const WIN_DIRECTIONS: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

const inside = (size: number, r: number, c: number): boolean =>
  r >= 0 && r < size && c >= 0 && c < size;

function checkNeutreekoWin(
  board: NeutreekoBoardState,
  player: Player,
): boolean {
  for (let r = 0; r < NEUTREEKO_SIZE; r += 1) {
    for (let c = 0; c < NEUTREEKO_SIZE; c += 1) {
      if (board[r][c] !== player) continue;
      for (const [dr, dc] of WIN_DIRECTIONS) {
        let found = true;
        for (let i = 0; i < 3; i += 1) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (!inside(NEUTREEKO_SIZE, nr, nc) || board[nr][nc] !== player) {
            found = false;
            break;
          }
        }
        if (found) return true;
      }
    }
  }
  return false;
}

function applyNeutreekoMove(
  board: NeutreekoBoardState,
  move: number[],
): NeutreekoBoardState {
  const [r1, c1, r2, c2] = move;
  const next = board.map((row) => row.slice());
  const piece = next[r1][c1];
  next[r1][c1] = ".";
  next[r2][c2] = piece;
  return next;
}

function neutreekoMoves(
  board: NeutreekoBoardState,
  player: Player,
): number[][] {
  const moves: number[][] = [];
  for (let r = 0; r < NEUTREEKO_SIZE; r += 1) {
    for (let c = 0; c < NEUTREEKO_SIZE; c += 1) {
      if (board[r][c] !== player) continue;
      for (const [dr, dc] of DIRECTIONS_8) {
        let nr = r + dr;
        let nc = c + dc;
        while (
          inside(NEUTREEKO_SIZE, nr, nc) &&
          board[nr][nc] === "."
        ) {
          nr += dr;
          nc += dc;
        }
        const endR = nr - dr;
        const endC = nc - dc;
        if (endR !== r || endC !== c) {
          moves.push([r, c, endR, endC]);
        }
      }
    }
  }
  return moves;
}

function opponentHasWinningReply(
  board: NeutreekoBoardState,
  opponent: Player,
): boolean {
  for (const move of neutreekoMoves(board, opponent)) {
    if (checkNeutreekoWin(applyNeutreekoMove(board, move), opponent)) {
      return true;
    }
  }
  return false;
}

function neutreekoAnalysis(
  board: NeutreekoBoardState,
  player: Player,
): MoveResponse {
  const winner = (["B", "W"] as Player[]).find((candidate) =>
    checkNeutreekoWin(board, candidate),
  );
  if (winner) {
    return {
      moves: [],
      winning_moves: [],
      unsafe_moves: [],
      game_over: true,
      winner,
    };
  }

  const moves = neutreekoMoves(board, player);
  const winningMoves: number[][] = [];
  const unsafeMoves: number[][] = [];
  const opponent: Player = player === "B" ? "W" : "B";
  for (const move of moves) {
    const resulting = applyNeutreekoMove(board, move);
    if (checkNeutreekoWin(resulting, player)) {
      winningMoves.push(move);
    } else if (opponentHasWinningReply(resulting, opponent)) {
      unsafeMoves.push(move);
    }
  }
  return {
    moves,
    winning_moves: winningMoves,
    unsafe_moves: unsafeMoves,
    game_over: false,
    winner: null,
  };
}

const canPlace = (cell: PyrgaCell, type: PyrgaPieceType): boolean =>
  cell.length < 3 && !cell.some((piece) => piece.type === type);

function pyrgaMoves(
  board: PyrgaBoardState,
  lastMove: PyrgaLastMove | null,
): number[][] {
  const moves: number[][] = [];
  const seen = new Set<string>();
  const emit = (r: number, c: number): void => {
    if (!inside(PYRGA_SIZE, r, c)) return;
    const cell = board[r][c];
    PIECE_TYPES.forEach((type, index) => {
      if (!canPlace(cell, type)) return;
      const key = `${r},${c},${index}`;
      if (seen.has(key)) return;
      seen.add(key);
      moves.push([r, c, index]);
    });
  };

  if (!lastMove) {
    for (let r = 0; r < PYRGA_SIZE; r += 1) {
      for (let c = 0; c < PYRGA_SIZE; c += 1) emit(r, c);
    }
    return moves;
  }

  const { row, col, piece } = lastMove;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    !inside(PYRGA_SIZE, row, col)
  ) {
    throw new Error("last_move coordinates are outside the board");
  }
  if (!PIECE_TYPES.includes(piece.type)) {
    throw new Error("last_move piece has an unknown type");
  }

  if (piece.type === "S") {
    for (const [dr, dc] of DIRECTIONS_4) emit(row + dr, col + dc);
  } else if (piece.type === "T") {
    for (const [dr, dc] of DIRECTIONS_8) {
      let r = row + dr;
      let c = col + dc;
      while (inside(PYRGA_SIZE, r, c) && canPlace(board[r][c], piece.type)) {
        emit(r, c);
        r += dr;
        c += dc;
      }
    }
  } else {
    emit(row, col);
  }
  return moves;
}

export function analyzeMoves(
  gameType: GameType,
  board: GameBoard,
  player: Player,
  lastMove: PyrgaLastMove | null = null,
): MoveResponse {
  if (gameType === "pyrga") {
    const normalized = normalizeBoard(gameType, board) as PyrgaBoardState;
    return {
      moves: pyrgaMoves(normalized, lastMove),
      winning_moves: [],
      unsafe_moves: [],
      game_over: false,
      winner: null,
    };
  }
  const normalized = normalizeBoard(gameType, board) as NeutreekoBoardState;
  return neutreekoAnalysis(normalized, player);
}
