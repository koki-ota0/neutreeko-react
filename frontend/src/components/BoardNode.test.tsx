import React from "react";
import { render, screen } from "@testing-library/react";
import { NodeProps, ReactFlowProvider } from "react-flow-renderer";
import { NODE_COLORS, POSITION_COLORS } from "../constants/colors";
import { NEUTREEKO_INITIAL_BOARD } from "../game/moves";
import { BoardNode } from "./BoardNode";
import { BoardNodeData, BoardRenderer, BoardRenderProps } from "../types/flow";

const boardSpy = jest.fn((props: BoardRenderProps) =>
  React.createElement(
    "div",
    { "data-testid": "dummy-board" },
    Array.isArray(props.board) ? "board" : "invalid",
  ),
);
const DummyBoard = boardSpy as unknown as BoardRenderer;

const nodeProps = (
  overrides: Partial<BoardNodeData> = {},
): NodeProps<BoardNodeData> =>
  ({
    id: "node_0",
    type: "board",
    data: {
      board: NEUTREEKO_INITIAL_BOARD,
      color: NODE_COLORS.unanalyzed,
      moveNote: null,
      outcome: "unknown",
      Board: DummyBoard,
      ...overrides,
    },
    selected: false,
    xPos: 0,
    yPos: 0,
    zIndex: 0,
    isConnectable: true,
    dragging: false,
  } as unknown as NodeProps<BoardNodeData>);

const renderNode = (overrides: Partial<BoardNodeData> = {}) =>
  render(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(BoardNode, nodeProps(overrides)),
    ),
  );

beforeEach(() => boardSpy.mockClear());

describe("BoardNode readable status chrome", () => {
  it("spells out a certain win with text, icon and outcome instead of dyeing the board", () => {
    // Stored `loss` is shown as Certain win (previous mover's perspective).
    renderNode({
      color: POSITION_COLORS.certainWin,
      outcome: "loss",
    });

    expect(screen.getByText("Certain win")).toBeInTheDocument();
    expect(screen.getByText("WIN")).toBeInTheDocument();
    expect(screen.getByText("OUTCOME: WIN")).toBeInTheDocument();
    expect(screen.getAllByText("✓").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("board-surface")).toHaveStyle(
      "background-color: #ffffff",
    );
    expect(boardSpy.mock.calls[0][0]).not.toHaveProperty("color");
  });

  it("shows a losing result and keeps the board surface neutral", () => {
    // Stored `win` is shown as Losing (previous mover's perspective).
    renderNode({
      color: POSITION_COLORS.losing,
      outcome: "win",
    });

    expect(screen.getByText("Losing")).toBeInTheDocument();
    expect(screen.getByText("LOSS")).toBeInTheDocument();
    expect(screen.getByText("OUTCOME: LOSS")).toBeInTheDocument();
    expect(screen.getByTestId("board-surface")).toHaveStyle(
      "background-color: #ffffff",
    );
  });

  it("shows a structured move note as text, not just a dashed border", () => {
    renderNode({ moveNote: "mustNotChoose" });

    expect(screen.getByText("Unanalyzed")).toBeInTheDocument();
    expect(screen.getByText("⚠ MUST NOT CHOOSE")).toBeInTheDocument();
  });

  it("labels an unrecognized persisted colour instead of leaving it ambiguous", () => {
    renderNode({ color: "#123456" });

    expect(screen.getByText("Unknown status")).toBeInTheDocument();
  });
});
