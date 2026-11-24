import { POSITION_COLORS } from "../constants/colors";
import { NEUTREEKO_INITIAL_BOARD } from "./moves";
import { isReusablePositionColor, resolveExploration } from "./exploration";
import { MyNodeData, NodesMap } from "../types/MyNodeData";

const board = () => NEUTREEKO_INITIAL_BOARD.map((row) => row.slice());

const node = (id: string, overrides: Partial<MyNodeData> = {}): MyNodeData => ({
  id,
  board: board(),
  currentPlayer: "B",
  children: [],
  color: POSITION_COLORS.unanalyzed,
  hidden: false,
  hiddenChildren: false,
  moveNote: null,
  outcome: "unknown",
  ...overrides,
});

const graph = (...nodes: MyNodeData[]): NodesMap =>
  Object.fromEntries(nodes.map((entry) => [entry.id, entry]));

describe("resolveExploration", () => {
  it("rule 1 makes a three-in-a-row parent Losing with highest priority", () => {
    const result = resolveExploration(
      graph(
        node("root", {
          children: ["winner", "unknown", "decided"],
          analysis: {
            winningMoves: [[1, 2, 2, 2]],
            unsafeMoves: [],
            gameOver: false,
            winner: null,
          },
        }),
        node("winner", { parentId: "root", move: [1, 2, 2, 2] }),
        node("unknown", { parentId: "root", move: [0, 0, 0, 0] }),
        node("decided", {
          parentId: "root",
          outcome: "loss",
          color: POSITION_COLORS.winning,
          analysis: {
            winningMoves: [], unsafeMoves: [], gameOver: true, winner: "B",
          },
        }),
      ),
    );

    expect(result.nodesMap.root.outcome).toBe("loss");
    expect(result.nodesMap.root.color).toBe(POSITION_COLORS.losing);
    expect(result.nodesMap.root.children).toEqual(["winner", "decided"]);
    expect(result.nodesMap.decided.color).toBe(POSITION_COLORS.winning);
    expect(result.removedIds).toEqual(["unknown"]);
    expect(result.stats.ruleHits.rule1).toBe(1);
    expect(result.stats.decidedChildrenKept).toBe(2);
  });

  it("three-in-a-row beats rule 3 even when every child outcome is loss", () => {
    const result = resolveExploration(
      graph(
        node("root", { children: ["three", "losing"] }),
        node("three", {
          parentId: "root",
          outcome: "loss",
          color: POSITION_COLORS.winning,
          analysis: {
            winningMoves: [],
            unsafeMoves: [],
            gameOver: true,
            winner: "B",
          },
        }),
        node("losing", { parentId: "root", outcome: "loss" }),
      ),
    );

    expect(result.nodesMap.root.outcome).toBe("loss");
    expect(result.nodesMap.root.color).toBe(POSITION_COLORS.losing);
    expect(result.stats.ruleHits.rule1).toBe(1);
    expect(result.stats.ruleHits.rule3).toBe(0);
  });

  it("rule 1 overrides an already-persisted win on the parent", () => {
    const result = resolveExploration(
      graph(
        node("root", {
          outcome: "win",
          color: POSITION_COLORS.certainWin,
          children: ["three"],
        }),
        node("three", {
          parentId: "root",
          outcome: "loss",
          color: POSITION_COLORS.winning,
          analysis: {
            winningMoves: [], unsafeMoves: [], gameOver: true, winner: "B",
          },
        }),
      ),
    );

    expect(result.nodesMap.root.outcome).toBe("loss");
    expect(result.nodesMap.root.color).toBe(POSITION_COLORS.losing);
    expect(result.stats.ruleHits.rule1).toBe(1);
  });

  it("rule 2 marks the parent losing and keeps the winning child", () => {
    const result = resolveExploration(
      graph(
        node("root", { children: ["winner", "unknown"] }),
        node("winner", {
          parentId: "root", outcome: "win", color: POSITION_COLORS.certainWin,
        }),
        node("unknown", { parentId: "root" }),
      ),
    );

    expect(result.nodesMap.root.outcome).toBe("loss");
    expect(result.nodesMap.root.color).toBe(POSITION_COLORS.losing);
    expect(result.nodesMap.root.children).toEqual(["winner"]);
    expect(result.removedIds).toEqual(["unknown"]);
    expect(result.stats.ruleHits.rule2).toBe(1);
    expect(result.stats.decidedChildrenKept).toBe(1);
  });

  it("rule 3 records a certain win when every child is losing", () => {
    const result = resolveExploration(
      graph(
        node("root", { children: ["a", "b"] }),
        node("a", { parentId: "root", outcome: "loss" }),
        node("b", { parentId: "root", outcome: "loss" }),
      ),
    );

    expect(result.nodesMap.root.outcome).toBe("win");
    expect(result.nodesMap.root.color).toBe(POSITION_COLORS.certainWin);
    expect(result.nodesMap.root.children).toEqual(["a", "b"]);
    expect(result.removedIds).toEqual([]);
    expect(result.stats.ruleHits.rule3).toBe(1);
    expect(result.stats.decidedChildrenKept).toBe(2);
  });

  it("does not mistake a yellow manual note for a proven loss", () => {
    const result = resolveExploration(
      graph(
        node("root", { children: ["noted"] }),
        node("noted", {
          parentId: "root",
          color: POSITION_COLORS.losing,
          moveNote: "mustNotChoose",
        }),
      ),
    );

    expect(result.nodesMap.root.outcome).toBe("unknown");
    expect(result.nodesMap.noted.outcome).toBe("unknown");
    expect(result.nodesMap.noted.color).toBe(POSITION_COLORS.losing);
    expect(result.removedIds).toEqual([]);
  });

  it("protects a shared transposition while cutting only the decided parent's edge", () => {
    const result = resolveExploration(
      graph(
        node("root", { children: ["decided", "other"] }),
        node("decided", {
          parentId: "root", outcome: "loss", children: ["shared"],
        }),
        node("other", { parentId: "root", children: ["shared"] }),
        node("shared", { parentId: "decided" }),
      ),
    );

    expect(result.removedIds).toEqual([]);
    expect(result.cutEdgePairs).toEqual([["decided", "shared"]]);
    expect(result.stats.edgesCut).toBe(1);
    expect(result.nodesMap.decided.children).toEqual([]);
    expect(result.nodesMap.other.children).toEqual(["shared"]);
    expect(result.nodesMap.shared.parentId).toBe("other");
  });

  it("keeps an unknown path when it leads to reusable decided evidence", () => {
    const result = resolveExploration(
      graph(
        node("root", { children: ["decided"] }),
        node("decided", {
          parentId: "root", outcome: "win", children: ["path"],
        }),
        node("path", { parentId: "decided", children: ["evidence"] }),
        node("evidence", { parentId: "path", outcome: "loss" }),
      ),
    );

    expect(result.removedIds).toEqual([]);
    expect(result.cutEdgePairs).toEqual([]);
    expect(result.nodesMap.decided.children).toEqual(["path"]);
  });

  it("classifies evaluated/decided colours as reusable, but not loops or memos", () => {
    expect(isReusablePositionColor(POSITION_COLORS.certainWin)).toBe(true);
    expect(isReusablePositionColor(POSITION_COLORS.losing)).toBe(true);
    expect(isReusablePositionColor(POSITION_COLORS.winning)).toBe(true);
    expect(isReusablePositionColor(POSITION_COLORS.noMoves)).toBe(true);
    expect(isReusablePositionColor(POSITION_COLORS.loop)).toBe(false);
    expect(isReusablePositionColor(POSITION_COLORS.unanalyzed)).toBe(false);
    expect(isReusablePositionColor("#9999ff")).toBe(false);
  });
});
