import {
  Dispatch,
  MutableRefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
} from "react-flow-renderer";
import {
  MoveNote,
  NODE_COLORS,
  NodeOutcome,
  OUTCOME_COLORS,
  HIDE_RESOLVED_COLORS,
  PLAY_MEMO_COLORS,
  POSITION_COLORS,
  SKIP_REEXPANSION_COLORS,
} from "../constants/colors";
import { MAX_AUTO_EXPAND_NODES } from "../constants/game";
import {
  ExplorationStats,
  isReusablePositionColor,
  resolveExploration,
} from "../game/exploration";
import { analyzeMoves } from "../game/rules";
import { STATIC_MODE, staticGraphUrl } from "../game/staticMode";
import {
  AppliedMove,
  applyMove,
  boardKey,
  lastMoveToPayload,
  moveKey,
  normalizeBoard,
  normalizeLastMove,
  opponent,
  parseAnalysis,
} from "../game/moves";
import {
  GameBoard,
  GameType,
  MyNodeData,
  NodesMap,
  PyrgaLastMove,
} from "../types/MyNodeData";
import { BoardRenderer, FlowNode } from "../types/flow";
import { Player } from "../types/pyrga";

// An empty value is valid: CRA's dev-server proxy forwards same-origin
// /load_graph, /save_graph and /legal_moves/* requests to the backend.
const API_URL = process.env.REACT_APP_API_URL ?? "http://127.0.0.1:8000";

/**
 * State is mirrored in refs and every write goes through `commit`, so async
 * chains always read the freshest value instead of a render-time snapshot.
 * (The old hook read a stale `nodesMap` after awaits, which made "Add 2 Legal
 * Moves" expand only one ply.)
 */
function commit<T>(
  ref: MutableRefObject<T>,
  setter: Dispatch<SetStateAction<T>>,
  updater: (previous: T) => T,
): T {
  const next = updater(ref.current);
  ref.current = next;
  setter(next);
  return next;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const numericId = (id: string): number => {
  const match = /^node_(\d+)$/.exec(id);
  return match ? Number(match[1]) : -1;
};

export const useGraphLogic = (gameType: GameType, Board: BoardRenderer) => {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodesMap, setNodesMap] = useState<NodesMap>({});
  const [selectedNodeId, setSelectedState] = useState<string | null>(null);
  const [nodeIndex, setNodeIndex] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [explorationStats, setExplorationStats] =
    useState<ExplorationStats | null>(null);

  const nodesRef = useRef<FlowNode[]>(nodes);
  const edgesRef = useRef<Edge[]>(edges);
  const nodesMapRef = useRef<NodesMap>(nodesMap);
  const nodeIndexRef = useRef<Record<string, string>>(nodeIndex);
  const selectedRef = useRef<string | null>(null);
  const nextIdRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const setSelectedNodeId = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedState(id);
  }, []);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    const token = process.env.REACT_APP_API_TOKEN;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) || {}),
    };
    if (token) headers["X-API-Token"] = token;
    const response = await fetch(`${API_URL}${path}`, { ...init, headers });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = typeof body?.detail === "string" ? `: ${body.detail}` : "";
      } catch {
        /* non-JSON error body */
      }
      throw new Error(
        `${init.method || "GET"} ${path} failed (${response.status})${detail}`,
      );
    }
    return response.json();
  }, []);

  const toFlowNode = useCallback(
    (node: MyNodeData, position: { x: number; y: number }): FlowNode => ({
      id: node.id,
      type: "board",
      position,
      data: {
        board: node.board,
        color: node.color,
        moveNote: node.moveNote ?? null,
        outcome: node.outcome ?? null,
        Board,
      },
      hidden: node.hidden,
    }),
    [Board],
  );

  /** Patch one node in both the game-tree map and its ReactFlow display data. */
  const patchNode = useCallback(
    (nodeId: string, patch: Partial<MyNodeData>) => {
      if (!nodesMapRef.current[nodeId]) return;
      commit(nodesMapRef, setNodesMap, (previous) => ({
        ...previous,
        [nodeId]: { ...previous[nodeId], ...patch },
      }));
      commit(nodesRef, setNodes, (previous) =>
        previous.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  ...(patch.color === undefined ? {} : { color: patch.color }),
                  ...(patch.outcome === undefined
                    ? {}
                    : { outcome: patch.outcome ?? null }),
                  ...(patch.moveNote === undefined
                    ? {}
                    : { moveNote: patch.moveNote ?? null }),
                },
              }
            : node,
        ),
      );
    },
    [],
  );

  const normalizeNode = useCallback(
    (id: string, raw: Record<string, unknown>): MyNodeData => ({
      id,
      board: normalizeBoard(gameType, raw.board),
      currentPlayer: raw.currentPlayer === "W" ? "W" : "B",
      parentId: typeof raw.parentId === "string" ? raw.parentId : undefined,
      children: Array.isArray(raw.children)
        ? raw.children.filter((child): child is string => typeof child === "string")
        : [],
      position:
        raw.position && typeof raw.position === "object"
          ? (raw.position as { x: number; y: number })
          : undefined,
      color:
        typeof raw.color === "string" ? raw.color : NODE_COLORS.unanalyzed,
      hidden: Boolean(raw.hidden),
      hiddenChildren: Boolean(raw.hiddenChildren),
      lastMove: normalizeLastMove(raw.lastMove),
      move: Array.isArray(raw.move) ? (raw.move as number[]) : undefined,
      moveNote: raw.moveNote === "mustNotChoose" ? "mustNotChoose" : null,
      outcome:
        raw.outcome === "win" || raw.outcome === "loss" || raw.outcome === "unknown"
          ? raw.outcome
          : null,
      winner: typeof raw.winner === "string" ? raw.winner : null,
      gameOver: Boolean(raw.gameOver),
      analysis:
        raw.analysis && typeof raw.analysis === "object"
          ? parseAnalysis({
              winning_moves: (raw.analysis as Record<string, unknown>).winningMoves,
              unsafe_moves: (raw.analysis as Record<string, unknown>).unsafeMoves,
              game_over: (raw.analysis as Record<string, unknown>).gameOver,
              winner: (raw.analysis as Record<string, unknown>).winner,
            })
          : undefined,
    }),
    [gameType],
  );

  const loadGraphFromApi = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      const token = process.env.REACT_APP_API_TOKEN;
      if (token) headers["X-API-Token"] = token;
      // Static Pages builds read the bundled snapshot instead of FastAPI.
      const url = STATIC_MODE
        ? staticGraphUrl(gameType)
        : `${API_URL}/load_graph?game_type=${encodeURIComponent(gameType)}`;
      const response = await fetch(url, {
        signal: controller.signal,
        headers,
      });
      if (!response.ok) throw new Error(`load_graph failed (${response.status})`);
      const data = await response.json();
      if (data?.error) throw new Error(String(data.error));
      if (!mountedRef.current) return;

      const rawMap = (data?.nodesMap ?? {}) as Record<string, Record<string, unknown>>;
      const map: NodesMap = {};
      for (const [id, raw] of Object.entries(rawMap)) {
        if (raw && typeof raw === "object") map[id] = normalizeNode(id, raw);
      }
      // Repair dangling children left by older versions.
      for (const node of Object.values(map)) {
        node.children = node.children.filter((child) => Boolean(map[child]));
        if (node.parentId && !map[node.parentId]) node.parentId = undefined;
      }

      const positions = new Map<string, { x: number; y: number }>();
      for (const saved of (data?.nodes ?? []) as Array<{
        id: string;
        position?: { x: number; y: number };
      }>) {
        if (saved?.id && saved.position) positions.set(saved.id, saved.position);
      }
      const flowNodes: FlowNode[] = Object.values(map).map((node) =>
        toFlowNode(
          node,
          positions.get(node.id) ?? node.position ?? {
            x: 100 + Math.random() * 300,
            y: 100 + Math.random() * 300,
          },
        ),
      );
      const hiddenIds = new Set(
        Object.values(map).filter((node) => node.hidden).map((node) => node.id),
      );
      const flowEdges: Edge[] = [];
      const seenEdges = new Set<string>();
      for (const raw of (data?.edges ?? []) as Array<{
        id?: string;
        source: string;
        target: string;
      }>) {
        if (!raw || !map[raw.source] || !map[raw.target] || raw.source === raw.target) {
          continue;
        }
        const id = raw.id || `e_${raw.source}_${raw.target}`;
        if (seenEdges.has(id)) continue;
        seenEdges.add(id);
        flowEdges.push({
          id,
          source: raw.source,
          target: raw.target,
          hidden: hiddenIds.has(raw.source) || hiddenIds.has(raw.target),
        });
      }

      const index: Record<string, string> = {};
      for (const node of Object.values(map)) {
        index[
          boardKey(gameType, node.board, node.currentPlayer, node.lastMove ?? null)
        ] = node.id;
      }
      const maxId = Object.keys(map).reduce(
        (max, id) => Math.max(max, numericId(id)),
        0,
      );
      nextIdRef.current = maxId + 1;

      commit(nodesMapRef, setNodesMap, () => map);
      commit(nodesRef, setNodes, () => flowNodes);
      commit(edgesRef, setEdges, () => flowEdges);
      commit(nodeIndexRef, setNodeIndex, () => index);
      const preferred = data?.selectedNodeId as string | null;
      setSelectedNodeId(
        preferred && map[preferred] ? preferred : (Object.keys(map)[0] ?? null),
      );
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      if (mountedRef.current) setError(`Could not load graph: ${messageOf(caught)}`);
    } finally {
      if (mountedRef.current && abortRef.current === controller) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, [gameType, normalizeNode, setSelectedNodeId, toFlowNode]);

  useEffect(() => {
    void loadGraphFromApi();
    return () => abortRef.current?.abort();
  }, [loadGraphFromApi]);

  /** BFS with a visited set: cycles from transpositions can no longer hang. */
  const getDescendants = useCallback((nodeId: string): string[] => {
    const result: string[] = [];
    const visited = new Set<string>([nodeId]);
    const queue = [...(nodesMapRef.current[nodeId]?.children ?? [])];
    while (queue.length) {
      const childId = queue.shift() as string;
      if (visited.has(childId)) continue;
      visited.add(childId);
      if (!nodesMapRef.current[childId]) continue;
      result.push(childId);
      queue.push(...(nodesMapRef.current[childId]?.children ?? []));
    }
    return result;
  }, []);

  const deleteIds = useCallback(
    (ids: string[]) => {
      const doomed = new Set(ids);
      if (!doomed.size) return;
      const fallbackParent = nodesMapRef.current[ids[0]]?.parentId;
      commit(nodesMapRef, setNodesMap, (previous) => {
        const next: NodesMap = {};
        for (const [id, node] of Object.entries(previous)) {
          if (doomed.has(id)) continue;
          next[id] = {
            ...node,
            children: node.children.filter((child) => !doomed.has(child)),
            parentId:
              node.parentId && !doomed.has(node.parentId)
                ? node.parentId
                : undefined,
          };
        }
        return next;
      });
      commit(nodesRef, setNodes, (previous) =>
        previous.filter((node) => !doomed.has(node.id)),
      );
      commit(edgesRef, setEdges, (previous) =>
        previous.filter(
          (edge) => !doomed.has(edge.source) && !doomed.has(edge.target),
        ),
      );
      commit(nodeIndexRef, setNodeIndex, (previous) => {
        const next = { ...previous };
        for (const [key, id] of Object.entries(next)) {
          if (doomed.has(id)) delete next[key];
        }
        return next;
      });
      const selected = selectedRef.current;
      if (selected && doomed.has(selected)) {
        setSelectedNodeId(
          fallbackParent && !doomed.has(fallbackParent)
            ? fallbackParent
            : null,
        );
      }
    },
    [setSelectedNodeId],
  );

  /**
   * Apply the three minimax rules to the WHOLE current graph. Decided nodes
   * are retained as reusable evidence; rule 2 additionally removes the other
   * white Unanalyzed sibling subtrees of a freshly resolved parent.
   */
  const applyExplorationRules = useCallback((): ExplorationStats => {
    const result = resolveExploration(
      nodesMapRef.current,
      selectedRef.current ? [selectedRef.current] : [],
    );
    commit(nodesMapRef, setNodesMap, () => result.nodesMap);
    commit(nodesRef, setNodes, (previous) =>
      previous.map((node) => {
        const data = result.nodesMap[node.id];
        if (!data) return node;
        return {
          ...node,
          data: {
            ...node.data,
            color: data.color,
            outcome: data.outcome ?? null,
            moveNote: data.moveNote ?? null,
          },
        };
      }),
    );
    const cutEdges = new Set(
      result.cutEdgePairs.map(([source, target]) =>
        JSON.stringify([source, target]),
      ),
    );
    if (cutEdges.size) {
      commit(edgesRef, setEdges, (previous) =>
        previous.filter(
          (edge) => !cutEdges.has(JSON.stringify([edge.source, edge.target])),
        ),
      );
    }
    deleteIds(result.removedIds);
    setExplorationStats(result.stats);
    return result.stats;
  }, [deleteIds]);

  const syncVisibility = useCallback((map: NodesMap) => {
    const hidden = new Set(
      Object.values(map).filter((node) => node.hidden).map((node) => node.id),
    );
    const nextNodes = commit(nodesRef, setNodes, (previous) =>
      previous.map((node) => {
        const shouldHide = hidden.has(node.id);
        return node.hidden === shouldHide
          ? node
          : { ...node, hidden: shouldHide };
      }),
    );
    const hiddenById = new Map(nextNodes.map((node) => [node.id, !!node.hidden]));
    commit(edgesRef, setEdges, (previous) =>
      previous.map((edge) => {
        const shouldHide = Boolean(
          hiddenById.get(edge.source) || hiddenById.get(edge.target),
        );
        return edge.hidden === shouldHide
          ? edge
          : { ...edge, hidden: shouldHide };
      }),
    );
  }, []);

  const applyVisibility = useCallback(
    (updater: (previous: NodesMap) => NodesMap) => {
      const next = commit(nodesMapRef, setNodesMap, updater);
      syncVisibility(next);
    },
    [syncVisibility],
  );

  const updateNodeColor = useCallback(
    (color: string, nodeId?: string) => {
      const targetId = nodeId ?? selectedRef.current;
      if (!targetId || !nodesMapRef.current[targetId]) return;
      patchNode(targetId, { color });
    },
    [patchNode],
  );

  /**
   * Explicit exploration result. `outcome` is currentPlayer-relative; the
   * palette intentionally shows the INVERSE (previous-mover perspective).
   */
  const setNodeOutcome = useCallback(
    (nodeId: string, outcome: Exclude<NodeOutcome, null>) => {
      const node = nodesMapRef.current[nodeId];
      if (!node) return;
      const decided = Boolean(node.analysis?.gameOver && node.analysis.winner);
      const color = decided
        ? POSITION_COLORS.winning
        : node.color === POSITION_COLORS.noMoves
          ? POSITION_COLORS.noMoves
          : OUTCOME_COLORS[outcome as "win" | "loss"] ?? node.color;
      patchNode(nodeId, { outcome, color });
    },
    [patchNode],
  );

  /**
   * A move note is stored on the CHILD (which incoming move is flagged). It is
   * a structured annotation, not a minimax result: the evaluated yellow/teal
   * colours are only assigned by the exploration rules.
   */
  const setMoveNotes = useCallback((ids: string[], note: MoveNote) => {
    const target = new Set(ids);
    if (!target.size) return;
    commit(nodesMapRef, setNodesMap, (previous) => {
      const next = { ...previous };
      for (const id of target) {
        if (next[id]) next[id] = { ...next[id], moveNote: note };
      }
      return next;
    });
    commit(nodesRef, setNodes, (previous) =>
      previous.map((node) =>
        target.has(node.id)
          ? { ...node, data: { ...node.data, moveNote: note } }
          : node,
      ),
    );
  }, []);

  const addEdge = useCallback((source: string, target: string) => {
    if (source === target) return;
    const id = `e_${source}_${target}`;
    commit(edgesRef, setEdges, (previous) =>
      previous.some((edge) => edge.id === id)
        ? previous
        : [...previous, { id, source, target }],
    );
  }, []);

  const addChildNode = useCallback(
    (params: {
      parentId: string;
      board: GameBoard;
      currentPlayer: Player;
      lastMove: PyrgaLastMove | null;
      move: number[];
      index: number;
      siblingCount: number;
    }): string => {
      const { parentId, board, currentPlayer, lastMove, move, index, siblingCount } =
        params;
      const newId = `node_${nextIdRef.current++}`;
      const parentFlow = nodesRef.current.find((node) => node.id === parentId);
      const offset = 140;
      const position = parentFlow
        ? {
            x: parentFlow.position.x +
              (index - (siblingCount - 1) / 2) * offset,
            y: parentFlow.position.y + offset,
          }
        : { x: Math.random() * 400, y: Math.random() * 400 };

      const node: MyNodeData = {
        id: newId,
        board,
        currentPlayer,
        parentId,
        children: [],
        position,
        color: POSITION_COLORS.unanalyzed,
        hidden: false,
        hiddenChildren: false,
        lastMove,
        move,
        moveNote: null,
        outcome: "unknown",
      };

      commit(nodesMapRef, setNodesMap, (previous) => {
        const next = { ...previous, [newId]: node };
        if (next[parentId]) {
          next[parentId] = {
            ...next[parentId],
            children: [...next[parentId].children, newId],
          };
        }
        return next;
      });
      commit(nodeIndexRef, setNodeIndex, (previous) => ({
        ...previous,
        [boardKey(gameType, board, currentPlayer, lastMove)]: newId,
      }));
      commit(nodesRef, setNodes, (previous) => [
        ...previous,
        toFlowNode(node, position),
      ]);
      addEdge(parentId, newId);
      return newId;
    },
    [addEdge, gameType, toFlowNode],
  );

  const addLegalMovesFromApi = useCallback(
    async (nodeId: string) => {
      const node = nodesMapRef.current[nodeId];
      if (!node || SKIP_REEXPANSION_COLORS.includes(node.color)) return;
      setBusy(true);
      setError(null);
      try {
        let raw: Record<string, unknown>;
        if (STATIC_MODE) {
          // Browser-side port of backend/rules.py; no server on Pages.
          raw = analyzeMoves(
            gameType,
            node.board,
            node.currentPlayer,
            node.lastMove ?? null,
          );
        } else {
          const payload: Record<string, unknown> = {
            board: node.board,
            player: node.currentPlayer,
          };
          if (gameType === "pyrga") {
            payload.last_move = lastMoveToPayload(node.lastMove);
          }
          raw = await request(`/legal_moves/${gameType}`, {
            method: "POST",
            body: JSON.stringify(payload),
          });
        }
        if (!mountedRef.current || !nodesMapRef.current[nodeId]) return;

        const rawMoves = raw?.moves;
        const moves: number[][] = Array.isArray(rawMoves)
          ? (rawMoves as number[][])
          : [];
        const analysis = parseAnalysis(raw);
        commit(nodesMapRef, setNodesMap, (previous) => ({
          ...previous,
          [nodeId]: {
            ...previous[nodeId],
            analysis,
            gameOver: analysis.gameOver,
            winner: analysis.winner,
          },
        }));

        if (moves.length === 0) {
          // A terminal position is a loss for the side to move. The reached
          // child keeps the decided-board / noMoves colour; the parent is then
          // decided by the exploration rules. Never paint the parent from here.
          const decided = analysis.gameOver && !!analysis.winner;
          updateNodeColor(
            decided ? POSITION_COLORS.winning : POSITION_COLORS.noMoves,
            nodeId,
          );
          setNodeOutcome(nodeId, "loss");
          applyExplorationRules();
          return;
        }

        // Highest priority: a move that makes three in a row would create a
        // decided child. Do NOT add that child. Let rule 1 mark this parent
        // `loss` (UI "Certain win" for the player who just moved); the rule
        // engine is the single source of truth for outcomes.
        if (analysis.winningMoves.length > 0) {
          applyExplorationRules();
          return;
        }

        // A move that lets the opponent win with one reply is a one-move loss.
        // Exclude it BEFORE creating any child instead of only annotating it.
        // Use the fresh analysis response, not a possibly stale saved analysis.
        const unsafeKeys = new Set(analysis.unsafeMoves.map(moveKey));
        const candidateMoves = moves.filter(
          (move) => !unsafeKeys.has(moveKey(move)),
        );

        if (candidateMoves.length === 0) {
          // Every legal move loses in one reply for the side to move. Store
          // `loss`; the UI shows the inverse label "Certain win". Make the
          // no-op expansion visible instead of leaving the parent unanalyzed.
          setNodeOutcome(nodeId, "loss");
          applyExplorationRules();
          return;
        }

        const childPlayer = opponent(node.currentPlayer);
        for (let index = 0; index < candidateMoves.length; index += 1) {
          const move = candidateMoves[index];
          let applied: AppliedMove;
          try {
            applied = applyMove(gameType, node.board, move, node.currentPlayer);
          } catch (caught) {
            console.warn("Skipping invalid move", move, messageOf(caught));
            continue;
          }
          const key = boardKey(
            gameType,
            applied.board,
            childPlayer,
            applied.lastMove,
          );
          const existingId = nodeIndexRef.current[key];
          if (existingId && nodesMapRef.current[existingId]) {
            if (existingId === nodeId) continue;
            addEdge(nodeId, existingId);
            // Read the colour BEFORE any automatic change: a loop is not a
            // decisive result and must not by itself mark the parent.
            const existingColor = nodesMapRef.current[existingId].color;
            if (isReusablePositionColor(existingColor)) {
              // Structured note on the incoming move; the parent's evaluation
              // is derived from the child's `outcome`, not from a colour.
              setMoveNotes([existingId], "mustNotChoose");
            } else if (existingColor === POSITION_COLORS.unanalyzed) {
              // Transposition: mark the re-reached position as a loop.
              updateNodeColor(POSITION_COLORS.loop, existingId);
            }
            continue;
          }
          addChildNode({
            parentId: nodeId,
            board: applied.board,
            currentPlayer: childPlayer,
            lastMove: applied.lastMove,
            move,
            index,
            siblingCount: candidateMoves.length,
          });
        }
        // Rule 1 (three-in-a-row priority), 2 and 3 propagate fresh child
        // outcomes to this parent and its ancestors; unknown siblings of
        // decided parents are pruned.
        applyExplorationRules();
      } catch (caught) {
        setError(`Could not fetch legal moves: ${messageOf(caught)}`);
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [
      addChildNode,
      addEdge,
      applyExplorationRules,
      gameType,
      request,
      setMoveNotes,
      setNodeOutcome,
      updateNodeColor,
    ],
  );

  const addLegalMovesFromApi2 = useCallback(
    async (nodeId: string) => {
      await addLegalMovesFromApi(nodeId);
      let expanded = 0;
      const level1 = [...(nodesMapRef.current[nodeId]?.children ?? [])];
      for (const childId of level1) {
        if (expanded >= MAX_AUTO_EXPAND_NODES) break;
        await addLegalMovesFromApi(childId);
        expanded += 1;
        const level2 = [...(nodesMapRef.current[childId]?.children ?? [])];
        for (const grandChildId of level2) {
          if (expanded >= MAX_AUTO_EXPAND_NODES) break;
          await addLegalMovesFromApi(grandChildId);
          expanded += 1;
        }
      }
    },
    [addLegalMovesFromApi],
  );

  const markUnsafeMoves = useCallback(
    (nodeId: string) => {
      const node = nodesMapRef.current[nodeId];
      if (!node?.analysis || node.analysis.unsafeMoves.length === 0) return;
      const keys = new Set(node.analysis.unsafeMoves.map(moveKey));
      const targets = node.children.filter((id) => {
        const child = nodesMapRef.current[id];
        return child?.move && keys.has(moveKey(child.move));
      });
      // New expansions skip unsafe moves entirely, so normally `targets` is
      // empty. This still annotates children that came from older graphs.
      // Risky moves are manual annotations, NOT a proven minimax loss.
      setMoveNotes(targets, "mustNotChoose");
    },
    [setMoveNotes],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (!nodesMapRef.current[nodeId]) return;
      deleteIds([nodeId, ...getDescendants(nodeId)]);
    },
    [deleteIds, getDescendants],
  );

  const deleteChildren = useCallback(
    (nodeId: string) => {
      if (!nodesMapRef.current[nodeId]) return;
      deleteIds(getDescendants(nodeId));
    },
    [deleteIds, getDescendants],
  );

  const handleNodesDelete = useCallback(
    (deletedNodes: Node[]) => {
      const ids = new Set<string>();
      for (const node of deletedNodes) {
        ids.add(node.id);
        for (const id of getDescendants(node.id)) ids.add(id);
      }
      deleteIds([...ids]);
    },
    [deleteIds, getDescendants],
  );

  const hideNode = useCallback(
    (nodeId: string) => {
      if (!nodesMapRef.current[nodeId]) return;
      applyVisibility((previous) => ({
        ...previous,
        [nodeId]: { ...previous[nodeId], hidden: true },
      }));
    },
    [applyVisibility],
  );

  const toggleChildren = useCallback(
    (nodeId: string) => {
      const target = nodesMapRef.current[nodeId];
      if (!target) return;
      const hide = !target.hiddenChildren;
      const descendants = getDescendants(nodeId);
      applyVisibility((previous) => {
        const next: NodesMap = {
          ...previous,
          [nodeId]: { ...previous[nodeId], hiddenChildren: hide },
        };
        for (const id of descendants) {
          if (next[id]) next[id] = { ...next[id], hidden: hide };
        }
        return next;
      });
    },
    [applyVisibility, getDescendants],
  );

  /**
   * One-way hide: resolved positions (decided / noMoves / loop AND evaluated
   * certain-win / losing) become hidden. Nothing is ever un-hidden here, so
   * already hidden Unanalyzed / memo nodes stay exactly as they were. Hidden
   * nodes are not deleted and remain reusable evidence.
   */
  const hideResolved = useCallback(() => {
    applyVisibility((previous) => {
      const next: NodesMap = {};
      for (const [id, node] of Object.entries(previous)) {
        next[id] = HIDE_RESOLVED_COLORS.includes(node.color)
          ? { ...node, hidden: true }
          : node;
      }
      return next;
    });
  }, [applyVisibility]);

  /** Filters on manual WORK MEMOS (the green "play line" colours). */
  const showPlayLine = useCallback(() => {
    applyVisibility((previous) => {
      const next: NodesMap = {};
      for (const [id, node] of Object.entries(previous)) {
        next[id] = {
          ...node,
          hidden: !PLAY_MEMO_COLORS.includes(node.color),
        };
      }
      return next;
    });
  }, [applyVisibility]);

  /** Restore every node and edge, including ones hidden in the saved graph. */
  const showAllNodes = useCallback(() => {
    applyVisibility((previous) => {
      const next: NodesMap = {};
      for (const [id, node] of Object.entries(previous)) {
        next[id] = { ...node, hidden: false, hiddenChildren: false };
      }
      return next;
    });
  }, [applyVisibility]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Positions live only in ReactFlow state now; mirroring them into nodesMap
    // on every drag used to re-render all ~8,000 nodes per mouse move.
    commit(nodesRef, setNodes, (previous) =>
      applyNodeChanges(changes, previous) as FlowNode[],
    );
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    commit(edgesRef, setEdges, (previous) =>
      applyEdgeChanges(changes, previous),
    );
  }, []);

  const saveGraph = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const payload = {
        // `data` contains component references; only positions are persisted.
        nodes: nodesRef.current.map((node) => ({
          id: node.id,
          position: node.position,
        })),
        edges: edgesRef.current.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          hidden: edge.hidden ?? false,
        })),
        nodesMap: nodesMapRef.current,
        selectedNodeId: selectedRef.current,
      };
      if (STATIC_MODE) {
        // Pages has no writable backend. Export the current graph so edits are
        // still recoverable instead of failing with a 404 / CORS error.
        const blob = new Blob([JSON.stringify(payload)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${gameType}_graph.json`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setSaveStatus("saved");
        setError(null);
        return;
      }
      const result = await request(
        `/save_graph?game_type=${encodeURIComponent(gameType)}`,
        { method: "POST", body: JSON.stringify(payload) },
      );
      if (result?.status !== "ok" && result?.error) {
        throw new Error(String(result.error));
      }
      setSaveStatus("saved");
      setError(null);
    } catch (caught) {
      setSaveStatus("error");
      setError(`Could not save graph: ${messageOf(caught)}`);
    }
  }, [gameType, request]);

  return {
    nodes,
    edges,
    nodesMap,
    selectedNodeId,
    setSelectedNodeId,
    loading,
    busy,
    error,
    saveStatus,
    loadGraphFromApi,
    deleteNode,
    deleteChildren,
    hideNode,
    handleNodesDelete,
    updateNodeColor,
    toggleChildren,
    addLegalMovesFromApi,
    addLegalMovesFromApi2,
    applyExplorationRules,
    explorationStats,
    markUnsafeMoves,
    onNodesChange,
    onEdgesChange,
    hideResolved,
    showPlayLine,
    showAllNodes,
    saveGraph,
  };
};
