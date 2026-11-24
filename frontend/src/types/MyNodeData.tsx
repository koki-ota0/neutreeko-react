import { MoveNote, NodeOutcome } from "../constants/colors";
import { Player, PyrgaCell, PyrgaPiece } from "./pyrga";

export type NeutreekoBoardState = string[][];
export type PyrgaBoardState = PyrgaCell[][];
export type GameBoard = NeutreekoBoardState | PyrgaBoardState;
export type GameType = "neutreeko" | "pyrga";

/** The piece placed to reach a Pyrga node. It decides the next placement zone. */
export interface PyrgaLastMove {
  row: number;
  col: number;
  piece: PyrgaPiece;
}

/** Annotations returned by the backend. Pruning is an explicit user action. */
export interface MoveAnalysis {
  winningMoves: number[][];
  unsafeMoves: number[][];
  gameOver: boolean;
  winner: string | null;
}

export interface MyNodeData {
  id: string;
  board: GameBoard;
  currentPlayer: Player;
  parentId?: string;
  children: string[];
  position?: { x: number; y: number };
  color: string;
  hidden: boolean;
  hiddenChildren: boolean;
  /** Pyrga only: the previous placement. */
  lastMove?: PyrgaLastMove | null;
  /** The move (backend encoding) that produced this node from its parent. */
  move?: number[];
  /** Note on the incoming move. The colour itself lives on the PARENT. */
  moveNote?: MoveNote;
  /** Exploration result (minimax value from currentPlayer's perspective). */
  outcome?: NodeOutcome;
  winner?: string | null;
  gameOver?: boolean;
  analysis?: MoveAnalysis;
}

export type NodesMap = Record<string, MyNodeData>;
