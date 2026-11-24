import { NEUTREEKO_SIZE, PIECE_TYPES, PYRGA_SIZE } from "../constants/game";
import {
  GameBoard,
  GameType,
  MoveAnalysis,
  NeutreekoBoardState,
  PyrgaBoardState,
  PyrgaLastMove,
} from "../types/MyNodeData";
import { Player, PyrgaCell, PyrgaPiece } from "../types/pyrga";

export const NEUTREEKO_INITIAL_BOARD: NeutreekoBoardState = [
  [".", "W", ".", "W", "."],
  [".", ".", "B", ".", "."],
  [".", ".", ".", ".", "."],
  [".", ".", "W", ".", "."],
  [".", "B", ".", "B", "."],
];

export const opponent = (player: Player): Player =>
  player === "B" ? "W" : "B";

export const emptyPyrgaBoard = (): PyrgaBoardState =>
  Array.from({ length: PYRGA_SIZE }, () =>
    Array.from({ length: PYRGA_SIZE }, () => [] as PyrgaCell),
  );

const isPiece = (value: unknown): value is PyrgaPiece => {
  if (!value || typeof value !== "object") return false;
  const piece = value as Partial<PyrgaPiece>;
  return (
    PIECE_TYPES.includes(piece.type as PyrgaPiece["type"]) &&
    (piece.player === "B" || piece.player === "W")
  );
};

/** Repair legacy board shapes ("." strings, [{}] placeholders, null cells). */
export function normalizeBoard(gameType: GameType, raw: unknown): GameBoard {
  if (gameType === "pyrga") {
    if (!Array.isArray(raw) || raw.length !== PYRGA_SIZE) return emptyPyrgaBoard();
    const board: PyrgaBoardState = [];
    for (const row of raw) {
      if (!Array.isArray(row) || row.length !== PYRGA_SIZE) return emptyPyrgaBoard();
      const newRow: PyrgaCell[] = [];
      for (const cell of row) {
        const items = Array.isArray(cell)
          ? cell
          : isPiece(cell)
            ? [cell]
            : [];
        const pieces: PyrgaCell = [];
        for (const item of items) {
          if (!isPiece(item) || pieces.some((p) => p.type === item.type)) continue;
          pieces.push({ type: item.type, player: item.player });
          if (pieces.length >= 3) break;
        }
        newRow.push(pieces);
      }
      board.push(newRow);
    }
    return board;
  }

  if (!Array.isArray(raw) || raw.length !== NEUTREEKO_SIZE) {
    return NEUTREEKO_INITIAL_BOARD.map((row) => row.slice());
  }
  const board: NeutreekoBoardState = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length !== NEUTREEKO_SIZE) {
      return NEUTREEKO_INITIAL_BOARD.map((r) => r.slice());
    }
    board.push(
      row.map((cell) =>
        cell === "B" || cell === "W" ? cell : ".",
      ),
    );
  }
  return board;
}

export interface AppliedMove {
  board: GameBoard;
  lastMove: PyrgaLastMove | null;
}

/**
 * Apply one backend move to a board.
 *   Neutreeko: [fromRow, fromCol, toRow, toCol] -- slide a piece.
 *   Pyrga:     [row, col, piece_index]          -- place a new piece.
 * The two encodings used to share one code path, so Pyrga moves silently
 * erased cells instead of placing pieces.
 */
export function applyMove(
  gameType: GameType,
  board: GameBoard,
  move: number[],
  player: Player,
): AppliedMove {
  if (gameType === "pyrga") {
    const [row, col, index] = move;
    const pieceType = PIECE_TYPES[index];
    const pyrgaBoard = board as PyrgaBoardState;
    const rowCells = pyrgaBoard[row];
    if (!pieceType || !rowCells || !Array.isArray(rowCells[col])) {
      throw new Error(`Invalid Pyrga move: ${JSON.stringify(move)}`);
    }
    const cell = rowCells[col];
    if (cell.length >= 3 || cell.some((piece) => piece.type === pieceType)) {
      throw new Error(`Illegal Pyrga placement: ${JSON.stringify(move)}`);
    }
    const piece: PyrgaPiece = { type: pieceType, player };
    const next: PyrgaBoardState = pyrgaBoard.map((cells, r) =>
      cells.map((current, c) =>
        r === row && c === col ? [...current, piece] : current,
      ),
    );
    return { board: next, lastMove: { row, col, piece } };
  }

  const [r1, c1, r2, c2] = move;
  const neutreekoBoard = board as NeutreekoBoardState;
  const movingPiece = neutreekoBoard[r1]?.[c1];
  if (!movingPiece || movingPiece === ".") {
    throw new Error(`Invalid Neutreeko move: ${JSON.stringify(move)}`);
  }
  const next = neutreekoBoard.map((cells, r) =>
    cells.map((current, c) => {
      if (r === r1 && c === c1) return ".";
      if (r === r2 && c === c2) return movingPiece;
      return current;
    }),
  );
  return { board: next, lastMove: null };
}

/** Transposition key. Pyrga must include lastMove: it changes legal replies. */
export function boardKey(
  gameType: GameType,
  board: GameBoard,
  player: Player,
  lastMove: PyrgaLastMove | null = null,
): string {
  return JSON.stringify({
    gameType,
    board,
    player,
    lastMove: gameType === "pyrga" ? lastMove : null,
  });
}

export const moveKey = (move: number[]): string => JSON.stringify(move);

/** Accept both the persisted {row,col,piece} shape and legacy [r,c,piece] tuples. */
export function normalizeLastMove(raw: unknown): PyrgaLastMove | null {
  if (!raw) return null;
  if (Array.isArray(raw) && raw.length === 3 && isPiece(raw[2])) {
    return { row: Number(raw[0]), col: Number(raw[1]), piece: raw[2] };
  }
  if (typeof raw === "object") {
    const value = raw as Partial<PyrgaLastMove>;
    if (
      typeof value.row === "number" &&
      typeof value.col === "number" &&
      isPiece(value.piece)
    ) {
      return { row: value.row, col: value.col, piece: value.piece };
    }
  }
  return null;
}

export function lastMoveToPayload(
  lastMove: PyrgaLastMove | null | undefined,
): [number, number, PyrgaPiece] | null {
  if (!lastMove) return null;
  return [lastMove.row, lastMove.col, lastMove.piece];
}

/** Convert the backend's snake_case analysis into the frontend type. */
export function parseAnalysis(raw: unknown): MoveAnalysis {
  const data = (raw ?? {}) as Record<string, unknown>;
  const asMoves = (value: unknown): number[][] =>
    Array.isArray(value) ? (value as number[][]) : [];
  return {
    winningMoves: asMoves(data.winning_moves),
    unsafeMoves: asMoves(data.unsafe_moves),
    gameOver: Boolean(data.game_over),
    winner: typeof data.winner === "string" ? data.winner : null,
  };
}
