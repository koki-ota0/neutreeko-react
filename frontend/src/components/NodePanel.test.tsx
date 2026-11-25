import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { POSITION_COLORS } from "../constants/colors";
import { NEUTREEKO_INITIAL_BOARD } from "../game/moves";
import { NodePanel } from "./NodePanel";
import { BoardRenderer, BoardRenderProps } from "../types/flow";
import { MyNodeData } from "../types/MyNodeData";

const boardSpy = jest.fn((props: BoardRenderProps) =>
  React.createElement(
    "div",
    { "data-testid": "panel-board" },
    Array.isArray(props.board) ? "board" : "invalid",
  ),
);
const DummyBoard = boardSpy as unknown as BoardRenderer;

const node: MyNodeData = {
  id: "node_0",
  board: NEUTREEKO_INITIAL_BOARD,
  currentPlayer: "B",
  children: [],
  color: POSITION_COLORS.certainWin,
  hidden: false,
  hiddenChildren: false,
  moveNote: null,
  // Stored `loss` is displayed as Certain win (previous mover's perspective).
  outcome: "loss",
};

const showAllSpy = jest.fn();

const props: React.ComponentProps<typeof NodePanel> = {
  node,
  boardComponent: DummyBoard,
  gameType: "neutreeko",
  busy: false,
  saveStatus: "idle",
  addLegalMoves: () => {},
  addLegalMoves2: () => {},
  applyExplorationRules: () => {},
  explorationStats: null,
  deleteNode: () => {},
  hideNode: () => {},
  updateNodeColor: () => {},
  toggleChildren: () => {},
  hideResolved: () => {},
  showAllNodes: showAllSpy,
  visibleNodeCount: 269,
  totalNodeCount: 7881,
  deleteChildren: () => {},
  showPlayLine: () => {},
  markUnsafeMoves: () => {},
  saveGraph: () => {},
};

beforeEach(() => {
  boardSpy.mockClear();
  showAllSpy.mockClear();
});

describe("NodePanel readable status", () => {
  it("shows an icon, label, short code and spelled-out outcome", () => {
    render(React.createElement(NodePanel, props));

    expect(screen.getAllByText("Certain win").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("WIN")).toBeInTheDocument();
    expect(screen.getAllByText("✓").length).toBeGreaterThanOrEqual(2);
    expect(
      screen.getByText(/Certain win \(the player who just moved can force a win\)/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("panel-board-surface")).toHaveStyle(
      "background-color: #ffffff",
    );
    expect(boardSpy.mock.calls[0][0]).not.toHaveProperty("color");
  });

  it("turns the colour-only swatches into labelled buttons", () => {
    render(React.createElement(NodePanel, props));

    expect(
      screen.getByRole("button", {
        name: "Position (automatic): Certain win",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Position (automatic): Losing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Work memo (manual): Almost winning" }),
    ).toBeInTheDocument();
  });

  it("explains that Hide resolved never reveals already hidden nodes", () => {
    render(React.createElement(NodePanel, props));

    expect(
      screen.getByRole("button", { name: "Hide resolved positions" }),
    ).toHaveAttribute(
      "title",
      "Hide resolved nodes only; already hidden nodes stay hidden",
    );
    expect(
      screen.getByText(
        /Hides resolved nodes only\. Already hidden Unanalyzed \/ memo nodes stay hidden/,
      ),
    ).toBeInTheDocument();
  });

  it("shows the visible node count and can restore every hidden node", () => {
    render(React.createElement(NodePanel, props));

    expect(
      screen.getByText(/Visible: 269 \/ 7881 nodes/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Show all nodes" }),
    );
    expect(showAllSpy).toHaveBeenCalledTimes(1);
  });

  it("explains that unsafe moves are skipped during expansion", () => {
    render(
      React.createElement(NodePanel, {
        ...props,
        node: {
          ...node,
          analysis: {
            winningMoves: [],
            unsafeMoves: [[1, 2, 2, 2]],
            gameOver: false,
            winner: null,
          },
        },
      }),
    );

    expect(screen.getByText(/Risky moves skipped: 1/)).toBeInTheDocument();
    expect(screen.getByText(/excluded from expansion/)).toBeInTheDocument();
  });

  it("uses download labels for the static Pages build", () => {
    render(
      React.createElement(NodePanel, {
        ...props,
        saveStatus: "saved",
        saveButtonLabel: "Download graph JSON",
        saveSavedLabel: "Downloaded",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Download graph JSON" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Downloaded")).toBeInTheDocument();
  });
});
