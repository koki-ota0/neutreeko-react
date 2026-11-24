/* eslint-disable testing-library/no-node-access, testing-library/render-result-naming-convention */
// These rules target DOM assertions; this suite asserts on hook state, not nodes.
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  MEMO_COLORS,
  NODE_COLORS,
  POSITION_COLORS,
} from "../constants/colors";
import { NEUTREEKO_INITIAL_BOARD } from "../game/moves";
import { GameType } from "../types/MyNodeData";
import { BoardRenderer } from "../types/flow";
import { useGraphLogic } from "./useGraphLogic";

const DummyBoard: BoardRenderer = () => null;

interface Reply {
  status?: number;
  body: unknown;
}

const emptyPyrgaBoard = () =>
  Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => [] as unknown[]),
  );

const graphFor = (gameType: GameType): Reply => ({
  body: {
    nodes: [{ id: "node_0", position: { x: 100, y: 100 } }],
    edges: [],
    nodesMap: {
      node_0: {
        id: "node_0",
        board:
          gameType === "pyrga" ? emptyPyrgaBoard() : NEUTREEKO_INITIAL_BOARD,
        currentPlayer: "B",
        children: [],
        color: NODE_COLORS.unanalyzed,
        hidden: false,
        hiddenChildren: false,
        lastMove: null,
      },
    },
    selectedNodeId: "node_0",
  },
});

const installFetch = (handler: (url: string, init?: RequestInit) => Reply) => {
  const mock = jest.fn(async (input: unknown, init?: RequestInit) => {
    const reply = handler(String(input), init);
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => reply.body,
    } as Response;
  });
  const globalWithFetch = global as typeof globalThis & { fetch: typeof fetch };
  globalWithFetch.fetch = mock as unknown as typeof fetch;
  return mock;
};

const originalFetch = global.fetch;
afterEach(() => {
  (global as typeof globalThis & { fetch: typeof fetch }).fetch = originalFetch;
  jest.clearAllMocks();
});

const mount = async (gameType: GameType) => {
  const hook = renderHook(() => useGraphLogic(gameType, DummyBoard));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
};

describe("useGraphLogic", () => {
  it("applies Pyrga placements and forwards last_move on the next request", async () => {
    const sentBodies: Array<Record<string, unknown>> = [];
    installFetch((url, init) => {
      if (url.includes("/load_graph")) return graphFor("pyrga");
      if (url.includes("/legal_moves/pyrga")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        sentBodies.push(body);
        // Root is the first move; the child sees a legal adjacent placement.
        const moves = body.last_move ? [[1, 0, 1]] : [[0, 0, 0]];
        return {
          body: {
            moves,
            winning_moves: [],
            unsafe_moves: [],
            game_over: false,
            winner: null,
          },
        };
      }
      return { status: 404, body: {} };
    });

    const { result } = await mount("pyrga");
    expect(Object.keys(result.current.nodesMap)).toEqual(["node_0"]);

    await act(async () => {
      await result.current.addLegalMovesFromApi("node_0");
    });
    const childId = result.current.nodesMap.node_0.children[0];
    expect(childId).toBeDefined();
    const child = result.current.nodesMap[childId];
    expect(child.lastMove).toEqual({
      row: 0,
      col: 0,
      piece: { type: "S", player: "B" },
    });
    expect((child.board as unknown[][][])[0][0]).toEqual([
      { type: "S", player: "B" },
    ]);
    expect(sentBodies[0].last_move).toBeNull();

    await act(async () => {
      await result.current.addLegalMovesFromApi(childId);
    });
    expect(sentBodies[1].last_move).toEqual([
      0,
      0,
      { type: "S", player: "B" },
    ]);
  });

  it("creates a child for every Neutreeko move without silent pruning", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) return graphFor("neutreeko");
      if (url.includes("/legal_moves/neutreeko")) {
        return {
          body: {
            moves: [
              [1, 2, 2, 2],
              [4, 1, 3, 0],
            ],
            winning_moves: [],
            unsafe_moves: [[4, 1, 3, 0]],
            game_over: false,
            winner: null,
          },
        };
      }
      return { status: 404, body: {} };
    });

    const { result } = await mount("neutreeko");
    await act(async () => {
      await result.current.addLegalMovesFromApi("node_0");
    });
    expect(result.current.nodesMap.node_0.children).toHaveLength(2);
    expect(result.current.edges).toHaveLength(2);
    expect(result.current.nodesMap.node_0.analysis?.unsafeMoves).toHaveLength(1);

    const [first] = result.current.nodesMap.node_0.children;
    expect((result.current.nodesMap[first].board as string[][])[2][2]).toBe("B");
    expect((result.current.nodesMap[first].board as string[][])[1][2]).toBe(".");
  });

  it("puts the decided colour on the reached child and a certain win on its parent", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) {
        const graph = graphFor("neutreeko");
        const body = graph.body as Record<string, unknown>;
        const nodesMap = body.nodesMap as Record<string, Record<string, unknown>>;
        nodesMap.node_1 = {
          id: "node_1",
          board: NEUTREEKO_INITIAL_BOARD,
          currentPlayer: "W",
          parentId: "node_0",
          children: [],
          color: NODE_COLORS.unanalyzed,
          hidden: false,
          hiddenChildren: false,
          outcome: "unknown",
        };
        nodesMap.node_0.children = ["node_1"];
        return graph;
      }
      if (url.includes("/legal_moves/neutreeko")) {
        return {
          body: {
            moves: [],
            winning_moves: [],
            unsafe_moves: [],
            game_over: true,
            winner: "B",
          },
        };
      }
      return { status: 404, body: {} };
    });

    const { result } = await mount("neutreeko");
    await act(async () => {
      await result.current.addLegalMovesFromApi("node_1");
    });
    // A. Position evaluation: the CHILD is the decided, winning position.
    expect(result.current.nodesMap.node_1.color).toBe(POSITION_COLORS.winning);
    expect(result.current.nodesMap.node_1.outcome).toBe("loss");
    expect(result.current.nodesMap.node_1.winner).toBe("B");
    // B. Rule 3: the PARENT can force that decided position => certain win.
    expect(result.current.nodesMap.node_0.color).toBe(
      POSITION_COLORS.certainWin,
    );
    expect(result.current.nodesMap.node_0.outcome).toBe("win");
    // The old blue-on-parent / yellow-on-child behaviour is gone.
    expect(result.current.nodesMap.node_0.color).not.toBe(POSITION_COLORS.winning);
    expect(result.current.nodesMap.node_1.color).not.toBe(POSITION_COLORS.losing);
  });

  it("uses noMoves (not winning) for a terminal board without a winner", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) return graphFor("neutreeko");
      if (url.includes("/legal_moves/neutreeko")) {
        return {
          body: {
            moves: [],
            winning_moves: [],
            unsafe_moves: [],
            game_over: false,
            winner: null,
          },
        };
      }
      return { status: 404, body: {} };
    });
    const { result } = await mount("neutreeko");
    await act(async () => {
      await result.current.addLegalMovesFromApi("node_0");
    });
    expect(result.current.nodesMap.node_0.color).toBe(POSITION_COLORS.noMoves);
    expect(result.current.nodesMap.node_0.outcome).toBe("loss");
  });

  it("rule 1 chooses the winning move, prunes unknown siblings and records a certain win", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) return graphFor("neutreeko");
      if (url.includes("/legal_moves/neutreeko")) {
        return {
          body: {
            moves: [
              [1, 2, 2, 2],
              [4, 1, 3, 0],
            ],
            winning_moves: [[1, 2, 2, 2]],
            unsafe_moves: [],
            game_over: false,
            winner: null,
          },
        };
      }
      return { status: 404, body: {} };
    });
    const { result } = await mount("neutreeko");
    await act(async () => {
      await result.current.addLegalMovesFromApi("node_0");
    });
    expect(result.current.nodesMap.node_0.analysis?.winningMoves).toHaveLength(1);
    expect(result.current.nodesMap.node_0.children).toHaveLength(1);
    expect(result.current.nodesMap.node_0.outcome).toBe("win");
    expect(result.current.nodesMap.node_0.color).toBe(
      POSITION_COLORS.certainWin,
    );
    const [winningChild] = result.current.nodesMap.node_0.children;
    expect(result.current.nodesMap[winningChild].move).toEqual([1, 2, 2, 2]);
    expect(result.current.explorationStats?.ruleHits.rule1).toBe(1);
  });

  it("deduplicates transpositions instead of creating duplicate children", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) return graphFor("neutreeko");
      if (url.includes("/legal_moves/neutreeko")) {
        return {
          body: {
            moves: [
              [1, 2, 2, 2],
              [1, 2, 2, 2],
            ],
            winning_moves: [],
            unsafe_moves: [],
            game_over: false,
            winner: null,
          },
        };
      }
      return { status: 404, body: {} };
    });

    const { result } = await mount("neutreeko");
    await act(async () => {
      await result.current.addLegalMovesFromApi("node_0");
    });
    expect(result.current.nodesMap.node_0.children).toHaveLength(1);
    expect(result.current.edges).toHaveLength(1);
    // A re-reached position is automatically marked as a loop.
    const [childId] = result.current.nodesMap.node_0.children;
    expect(result.current.nodesMap[childId].color).toBe(POSITION_COLORS.loop);
    // A loop is not a decisive result: the parent gets no move note.
    expect(result.current.nodesMap.node_0.color).toBe(POSITION_COLORS.unanalyzed);
  });

  it("marks risky incoming moves without claiming a minimax loss", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) return graphFor("neutreeko");
      if (url.includes("/legal_moves/neutreeko")) {
        return {
          body: {
            moves: [
              [1, 2, 2, 2],
              [4, 1, 3, 0],
            ],
            winning_moves: [],
            unsafe_moves: [[4, 1, 3, 0]],
            game_over: false,
            winner: null,
          },
        };
      }
      return { status: 404, body: {} };
    });
    const { result } = await mount("neutreeko");
    await act(async () => {
      await result.current.addLegalMovesFromApi("node_0");
    });
    await act(async () => {
      result.current.markUnsafeMoves("node_0");
    });
    // A risky move is a structured note, not a proven losing outcome.
    expect(result.current.nodesMap.node_0.color).toBe(
      POSITION_COLORS.unanalyzed,
    );
    expect(result.current.nodesMap.node_0.outcome).toBe("unknown");
    const children = result.current.nodesMap.node_0.children;
    expect(result.current.nodesMap[children[0]].moveNote).toBeNull();
    expect(result.current.nodesMap[children[1]].moveNote).toBe("mustNotChoose");
    // The children themselves are not painted with the note colour.
    expect(result.current.nodesMap[children[1]].color).toBe(
      POSITION_COLORS.unanalyzed,
    );
  });

  it("hides only resolved nodes and leaves already hidden nodes untouched", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) {
        const graph = graphFor("neutreeko");
        const body = graph.body as Record<string, unknown>;
        const nodesMap = body.nodesMap as Record<string, Record<string, unknown>>;
        nodesMap.node_0.moveNote = "mustNotChoose";
        const child = (
          id: string,
          color: string,
          outcome?: string,
        ): Record<string, unknown> => ({
          id,
          board: NEUTREEKO_INITIAL_BOARD,
          currentPlayer: "W",
          parentId: "node_0",
          children: [],
          color,
          hidden: false,
          hiddenChildren: false,
          ...(outcome ? { outcome } : {}),
        });
        nodesMap.node_1 = child("node_1", POSITION_COLORS.winning);
        nodesMap.node_2 = child("node_2", MEMO_COLORS.playing);
        nodesMap.node_3 = child(
          "node_3",
          POSITION_COLORS.certainWin,
          "win",
        );
        nodesMap.node_4 = child("node_4", POSITION_COLORS.losing, "loss");
        nodesMap.node_5 = child("node_5", POSITION_COLORS.unanalyzed);
        nodesMap.node_6 = {
          ...child("node_6", POSITION_COLORS.unanalyzed),
          hidden: true,
          hiddenChildren: true,
        };
        nodesMap.node_0.children = [
          "node_1",
          "node_2",
          "node_3",
          "node_4",
          "node_5",
          "node_6",
        ];
        return graph;
      }
      return { status: 404, body: {} };
    });
    const { result } = await mount("neutreeko");
    await act(async () => {
      result.current.hideResolved();
    });
    expect(result.current.nodesMap.node_1.hidden).toBe(true); // decided
    expect(result.current.nodesMap.node_3.hidden).toBe(true); // certain win
    expect(result.current.nodesMap.node_4.hidden).toBe(true); // losing
    expect(result.current.nodesMap.node_0.hidden).toBe(false); // structured note
    expect(result.current.nodesMap.node_2.hidden).toBe(false); // manual memo
    expect(result.current.nodesMap.node_5.hidden).toBe(false); // unanalyzed
    expect(result.current.nodesMap.node_6.hidden).toBe(true); // stays hidden
    expect(result.current.nodesMap.node_6.hiddenChildren).toBe(true); // untouched
    // ReactFlow receives the same hidden flags, not just nodesMap.
    expect(
      result.current.nodes.find((node) => node.id === "node_3")?.hidden,
    ).toBe(true);
    expect(
      result.current.nodes.find((node) => node.id === "node_4")?.hidden,
    ).toBe(true);
    expect(
      result.current.nodes.find((node) => node.id === "node_5")?.hidden,
    ).toBe(false);
    expect(
      result.current.nodes.find((node) => node.id === "node_6")?.hidden,
    ).toBe(true);
    // Hiding must not delete reusable evaluation results.
    expect(result.current.nodesMap.node_3.outcome).toBe("win");
    expect(result.current.nodesMap.node_4.outcome).toBe("loss");
  });

  it("showAllNodes restores every saved hidden node and edge", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) {
        const graph = graphFor("neutreeko");
        const body = graph.body as Record<string, unknown>;
        const nodesMap = body.nodesMap as Record<string, Record<string, unknown>>;
        nodesMap.node_0.hidden = true;
        nodesMap.node_0.hiddenChildren = true;
        nodesMap.node_1 = {
          id: "node_1",
          board: NEUTREEKO_INITIAL_BOARD,
          currentPlayer: "W",
          parentId: "node_0",
          children: [],
          color: POSITION_COLORS.certainWin,
          hidden: true,
          hiddenChildren: true,
          outcome: "win",
        };
        nodesMap.node_0.children = ["node_1"];
        body.edges = [
          { id: "e_0_1", source: "node_0", target: "node_1", hidden: true },
        ];
        return graph;
      }
      return { status: 404, body: {} };
    });

    const { result } = await mount("neutreeko");
    await act(async () => {
      result.current.showAllNodes();
    });

    expect(result.current.nodesMap.node_0.hidden).toBe(false);
    expect(result.current.nodesMap.node_0.hiddenChildren).toBe(false);
    expect(result.current.nodesMap.node_1.hidden).toBe(false);
    expect(result.current.nodes.every((node) => !node.hidden)).toBe(true);
    expect(result.current.edges.every((edge) => !edge.hidden)).toBe(true);
  });

  it("deletes a whole subtree and removes its edges", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) return graphFor("neutreeko");
      if (url.includes("/legal_moves/neutreeko")) {
        return {
          body: {
            moves: [[1, 2, 2, 2]],
            winning_moves: [],
            unsafe_moves: [],
            game_over: false,
            winner: null,
          },
        };
      }
      return { status: 404, body: {} };
    });

    const { result } = await mount("neutreeko");
    await act(async () => {
      await result.current.addLegalMovesFromApi("node_0");
    });
    expect(Object.keys(result.current.nodesMap)).toHaveLength(2);

    await act(async () => {
      result.current.deleteNode("node_0");
    });
    expect(result.current.nodesMap).toEqual({});
    expect(result.current.nodes).toHaveLength(0);
    expect(result.current.edges).toHaveLength(0);
    expect(result.current.selectedNodeId).toBeNull();
  });

  it("applies the rules to a loaded graph and prunes only unknown branches", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) {
        const graph = graphFor("neutreeko");
        const body = graph.body as Record<string, unknown>;
        const nodesMap = body.nodesMap as Record<string, Record<string, unknown>>;
        nodesMap.node_0.outcome = "win";
        nodesMap.node_0.children = ["node_1", "node_2"];
        nodesMap.node_1 = {
          id: "node_1",
          board: NEUTREEKO_INITIAL_BOARD,
          currentPlayer: "W",
          parentId: "node_0",
          children: [],
          color: NODE_COLORS.losing,
          hidden: false,
          hiddenChildren: false,
          outcome: "loss",
        };
        nodesMap.node_2 = {
          id: "node_2",
          board: NEUTREEKO_INITIAL_BOARD,
          currentPlayer: "W",
          parentId: "node_0",
          children: [],
          color: NODE_COLORS.unanalyzed,
          hidden: false,
          hiddenChildren: false,
          outcome: "unknown",
        };
        body.edges = [
          { id: "e_0_1", source: "node_0", target: "node_1" },
          { id: "e_0_2", source: "node_0", target: "node_2" },
        ];
        return graph;
      }
      return { status: 404, body: {} };
    });

    const { result } = await mount("neutreeko");
    await act(async () => {
      result.current.applyExplorationRules();
    });

    expect(result.current.nodesMap.node_0.color).toBe(
      POSITION_COLORS.certainWin,
    );
    expect(result.current.nodesMap.node_1).toBeDefined();
    expect(result.current.nodesMap.node_2).toBeUndefined();
    expect(result.current.edges.map((edge) => edge.id)).toEqual(["e_0_1"]);
    expect(result.current.explorationStats?.nodesRemoved).toBe(1);
    expect(result.current.explorationStats?.decidedChildrenKept).toBe(1);
  });

  it("surfaces save failures instead of reporting success", async () => {
    installFetch((url) => {
      if (url.includes("/load_graph")) return graphFor("neutreeko");
      if (url.includes("/save_graph")) return { status: 500, body: {} };
      return { status: 404, body: {} };
    });

    const { result } = await mount("neutreeko");
    await act(async () => {
      await result.current.saveGraph();
    });
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.error).toMatch(/Could not save graph/);
  });

  it("shows a visible error when the graph cannot be loaded", async () => {
    installFetch((url) =>
      url.includes("/load_graph") ? { status: 500, body: {} } : { status: 404, body: {} },
    );
    const { result } = await mount("neutreeko");
    expect(result.current.error).toMatch(/Could not load graph/);
    expect(result.current.loading).toBe(false);
  });
});
