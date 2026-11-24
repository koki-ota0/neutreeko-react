import {
  applyMove,
  boardKey,
  emptyPyrgaBoard,
  lastMoveToPayload,
  NEUTREEKO_INITIAL_BOARD,
  normalizeBoard,
  normalizeLastMove,
  opponent,
  parseAnalysis,
} from "./moves";

describe("applyMove", () => {
  it("applies a Neutreeko slide", () => {
    const { board, lastMove } = applyMove(
      "neutreeko",
      NEUTREEKO_INITIAL_BOARD,
      [1, 2, 2, 2],
      "B",
    );
    expect((board as string[][])[1][2]).toBe(".");
    expect((board as string[][])[2][2]).toBe("B");
    expect(NEUTREEKO_INITIAL_BOARD[1][2]).toBe("B"); // input not mutated
    expect(lastMove).toBeNull();
  });

  it("places a Pyrga piece and records lastMove", () => {
    const { board, lastMove } = applyMove(
      "pyrga",
      emptyPyrgaBoard(),
      [2, 1, 1],
      "B",
    );
    expect((board as never[][][])[2][1]).toEqual([
      { type: "T", player: "B" },
    ]);
    expect(lastMove).toEqual({
      row: 2,
      col: 1,
      piece: { type: "T", player: "B" },
    });
    expect(lastMoveToPayload(lastMove)).toEqual([
      2,
      1,
      { type: "T", player: "B" },
    ]);
  });

  it("rejects a duplicate Pyrga piece type in a cell", () => {
    const board = emptyPyrgaBoard();
    board[0][0] = [{ type: "S", player: "B" }];
    expect(() => applyMove("pyrga", board, [0, 0, 0], "W")).toThrow(
      /Illegal Pyrga placement/,
    );
  });

  it("never mutates the source Pyrga cell", () => {
    const board = emptyPyrgaBoard();
    const { board: next } = applyMove("pyrga", board, [0, 0, 0], "B");
    expect(board[0][0]).toEqual([]);
    expect(next).not.toBe(board);
  });
});

describe("boardKey", () => {
  it("includes lastMove for Pyrga but not for Neutreeko", () => {
    const board = emptyPyrgaBoard();
    const lastMove = {
      row: 0,
      col: 0,
      piece: { type: "S" as const, player: "B" as const },
    };
    expect(boardKey("pyrga", board, "W", lastMove)).not.toBe(
      boardKey("pyrga", board, "W", null),
    );
    expect(boardKey("neutreeko", NEUTREEKO_INITIAL_BOARD, "B", lastMove)).toBe(
      boardKey("neutreeko", NEUTREEKO_INITIAL_BOARD, "B", null),
    );
  });
});

describe("normalization", () => {
  it("turns legacy Pyrga placeholders into empty cells", () => {
    const legacy = [
      [[{ type: "S", player: "B" }], [{}], ".", null],
      [[], [], [], []],
      [[], [], [], []],
      [[], [], [], []],
    ];
    const board = normalizeBoard("pyrga", legacy) as never[][][];
    expect(board[0][0]).toEqual([{ type: "S", player: "B" }]);
    expect(board[0][1]).toEqual([]);
    expect(board[0][2]).toEqual([]);
    expect(board[0][3]).toEqual([]);
  });

  it("falls back to the initial Neutreeko board for invalid shapes", () => {
    expect(normalizeBoard("neutreeko", [["B"]])).toEqual(
      NEUTREEKO_INITIAL_BOARD,
    );
  });

  it("accepts both shapes of lastMove", () => {
    const piece = { type: "C" as const, player: "W" as const };
    expect(normalizeLastMove([1, 2, piece])).toEqual({
      row: 1,
      col: 2,
      piece,
    });
    expect(normalizeLastMove({ row: 1, col: 2, piece })).toEqual({
      row: 1,
      col: 2,
      piece,
    });
    expect(normalizeLastMove("S")).toBeNull();
  });

  it("parses the backend's snake_case analysis", () => {
    expect(
      parseAnalysis({
        winning_moves: [[1, 2, 3, 4]],
        unsafe_moves: [],
        game_over: true,
        winner: "B",
      }),
    ).toEqual({
      winningMoves: [[1, 2, 3, 4]],
      unsafeMoves: [],
      gameOver: true,
      winner: "B",
    });
  });
});

it("switches players", () => {
  expect(opponent("B")).toBe("W");
  expect(opponent("W")).toBe("B");
});
