import { NEUTREEKO_INITIAL_BOARD, emptyPyrgaBoard } from "./moves";
import { analyzeMoves } from "./rules";
import { PyrgaLastMove } from "../types/MyNodeData";

const lastMove = (
  row: number,
  col: number,
  type: "S" | "T" | "C",
): PyrgaLastMove => ({ row, col, piece: { type, player: "B" } });

describe("browser-side move rules", () => {
  it("matches the backend analysis of the initial Neutreeko board", () => {
    const result = analyzeMoves("neutreeko", NEUTREEKO_INITIAL_BOARD, "B");

    expect(result.moves).toHaveLength(14);
    expect(result.moves.slice(0, 3)).toEqual([
      [1, 2, 0, 2],
      [1, 2, 1, 0],
      [1, 2, 1, 4],
    ]);
    expect(result.winning_moves).toEqual([]);
    expect(result.unsafe_moves).toEqual([
      [1, 2, 1, 0],
      [1, 2, 1, 4],
      [1, 2, 3, 0],
      [1, 2, 3, 4],
    ]);
    expect(result.game_over).toBe(false);
    expect(result.winner).toBeNull();
  });

  it("keeps an immediate winning move even when the opponent has a threat", () => {
    const board = [
      ["B", ".", "B", ".", "."],
      ["W", ".", "W", ".", "."],
      [".", ".", ".", ".", "."],
      [".", ".", ".", "W", "."],
      [".", "B", ".", ".", "."],
    ];
    const result = analyzeMoves("neutreeko", board, "B");

    expect(result.moves).toContainEqual([4, 1, 0, 1]);
    expect(result.winning_moves).toContainEqual([4, 1, 0, 1]);
    expect(result.unsafe_moves).not.toContainEqual([4, 1, 0, 1]);
  });

  it("treats three in a row as a decided terminal position", () => {
    const board = [
      ["B", "B", "B", ".", "."],
      [".", ".", ".", ".", "."],
      [".", ".", ".", ".", "."],
      [".", ".", ".", ".", "."],
      [".", ".", ".", ".", "."],
    ];
    expect(analyzeMoves("neutreeko", board, "W")).toEqual({
      moves: [],
      winning_moves: [],
      unsafe_moves: [],
      game_over: true,
      winner: "B",
    });
  });

  it("generates all first Pyrga placements and respects the last-piece zone", () => {
    const board = emptyPyrgaBoard();

    expect(analyzeMoves("pyrga", board, "B").moves).toHaveLength(48);
    expect(analyzeMoves("pyrga", board, "B", lastMove(0, 0, "S")).moves).toEqual(
      [
        [1, 0, 0],
        [1, 0, 1],
        [1, 0, 2],
        [0, 1, 0],
        [0, 1, 1],
        [0, 1, 2],
      ],
    );
    expect(analyzeMoves("pyrga", board, "B", lastMove(1, 1, "C")).moves).toEqual(
      [
        [1, 1, 0],
        [1, 1, 1],
        [1, 1, 2],
      ],
    );
    expect(analyzeMoves("pyrga", board, "B", lastMove(1, 1, "T")).moves).toHaveLength(33);
  });

  it("emits no Pyrga move into a cell that already holds every piece type", () => {
    const board = Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => [
        { type: "S" as const, player: "B" as const },
        { type: "T" as const, player: "B" as const },
        { type: "C" as const, player: "B" as const },
      ]),
    );
    expect(analyzeMoves("pyrga", board, "B").moves).toEqual([]);
  });
});
