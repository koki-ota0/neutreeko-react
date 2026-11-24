// frontend/src/types/pyrga.ts
export type Player = "B" | "W";
export type PyrgaPieceType = "S" | "T" | "C";
export type Direction = "up" | "down" | "left" | "right";

export interface PyrgaPiece {
  type: PyrgaPieceType;
  player: Player;
  direction?: Direction; // T only
}

export type PyrgaCell = PyrgaPiece[]; // max 3 pieces, one per type
