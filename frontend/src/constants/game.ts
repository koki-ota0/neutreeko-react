import { PyrgaPieceType } from "../types/pyrga";

/** Index used by the backend's [row, col, piece_index] move encoding. */
export const PIECE_TYPES: PyrgaPieceType[] = ["S", "T", "C"];

export const NEUTREEKO_SIZE = 5;
export const PYRGA_SIZE = 4;

/** Cap for the "Add 2 Legal Moves" bulk expansion (avoids thousands of requests). */
export const MAX_AUTO_EXPAND_NODES = 60;
