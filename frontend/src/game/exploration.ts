/**
 * Minimax-style exploration rules, shared by live expansion and the
 * "Apply exploration rules" action. Outcomes are always viewed from the
 * perspective of the node's `currentPlayer`.
 *
 * 1. A node with an immediate winning move is `win`; unknown siblings need no
 *    exploration and are removed.
 * 2. A node with a `win` child (the opponent can force a win) is `loss`;
 *    unknown siblings are removed.
 * 3. A node whose children are all `loss` is `win` and is recorded.
 *
 * Already decided children are never removed: they are reusable evidence for
 * transpositions and later exploration. The one-time migration of the legacy
 * graph lives in `backend/exploration.py`; this module uses the explicit
 * `outcome` field and is colour-independent for pruning decisions.
 */

import {
  DECISIVE_OR_EVALUATED_COLORS,
  NodeOutcome,
  OUTCOME_COLORS,
  POSITION_COLORS,
} from "../constants/colors";
import { moveKey } from "./moves";
import { MyNodeData, NodesMap } from "../types/MyNodeData";

export type ExplorationOutcome = "win" | "loss" | "unknown";

export interface ExplorationStats {
  nodesBefore: number;
  nodesAfter: number;
  nodesRemoved: number;
  edgesCut: number;
  outcomeWin: number;
  outcomeLoss: number;
  outcomeUnknown: number;
  ruleHits: { rule1: number; rule2: number; rule3: number };
  decidedChildrenKept: number;
}

export interface ExplorationResult {
  /** Full map, including nodes scheduled for deletion (the hook removes them). */
  nodesMap: NodesMap;
  removedIds: string[];
  /** Parent/child pairs whose exploration edge is cut; the nodes may survive. */
  cutEdgePairs: Array<[string, string]>;
  stats: ExplorationStats;
}

const WIN: ExplorationOutcome = "win";
const LOSS: ExplorationOutcome = "loss";
const UNKNOWN: ExplorationOutcome = "unknown";

const isDecidedOutcome = (value: NodeOutcome | undefined): boolean =>
  value === "win" || value === "loss";

/** Explicit outcomes only. A yellow manual note is never treated as a proof. */
const persistedOutcome = (node: MyNodeData): ExplorationOutcome =>
  node.outcome === WIN || node.outcome === LOSS
    ? node.outcome
    : UNKNOWN;

const isDecidedEvidence = (
  node: MyNodeData,
  winningMoveKeys: Set<string>,
): boolean => {
  if (isDecidedOutcome(node.outcome)) return true;
  if (node.analysis?.gameOver && node.analysis.winner) return true;
  if (node.color === POSITION_COLORS.noMoves) return true;
  if (node.color === POSITION_COLORS.loop) return true;
  return Boolean(node.move && winningMoveKeys.has(moveKey(node.move)));
};

const outcomeColor = (
  node: MyNodeData,
  outcome: ExplorationOutcome,
): string => {
  // A decided board keeps the blue "winning position" marker on the CHILD.
  // An exhausted position keeps its own marker. Everything else follows the
  // new evaluation palette: certainWin / losing.
  if (node.analysis?.gameOver && node.analysis.winner) {
    return POSITION_COLORS.winning;
  }
  if (node.color === POSITION_COLORS.noMoves) {
    return POSITION_COLORS.noMoves;
  }
  if (node.color === POSITION_COLORS.loop) {
    return POSITION_COLORS.loop;
  }
  if (outcome === WIN) return OUTCOME_COLORS.win;
  if (outcome === LOSS) return OUTCOME_COLORS.loss;
  return node.color;
};

const postorder = (nodesMap: NodesMap): string[] => {
  const order: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string): void => {
    if (done.has(id) || visiting.has(id) || !nodesMap[id]) return;
    visiting.add(id);
    for (const childId of nodesMap[id].children) {
      if (nodesMap[childId]) visit(childId);
    }
    visiting.delete(id);
    done.add(id);
    order.push(id);
  };
  for (const id of Object.keys(nodesMap)) visit(id);
  return order;
};

const winningMoveKeysFor = (node: MyNodeData): Set<string> =>
  new Set((node.analysis?.winningMoves ?? []).map(moveKey));

/** Colour-independent rule engine. Does not mutate the input map. */
export function resolveExploration(
  source: NodesMap,
  protectedIds: string[] = [],
): ExplorationResult {
  const nodesMap: NodesMap = {};
  for (const [id, node] of Object.entries(source)) {
    nodesMap[id] = {
      ...node,
      children: node.children.filter((childId) => Boolean(source[childId])),
    };
  }

  const outcomes: Record<string, ExplorationOutcome> = {};
  for (const [id, node] of Object.entries(nodesMap)) {
    outcomes[id] = persistedOutcome(node);
    if (outcomes[id] === UNKNOWN && node.analysis?.gameOver && node.analysis.winner) {
      // The player who just moved won; the side to move here has lost.
      outcomes[id] = LOSS;
    }
    if (outcomes[id] === UNKNOWN && node.color === POSITION_COLORS.noMoves) {
      outcomes[id] = LOSS;
    }
  }

  const hits = { rule1: 0, rule2: 0, rule3: 0 };
  const winningMoveKeys: Record<string, Set<string>> = {};
  for (const id of Object.keys(nodesMap)) {
    winningMoveKeys[id] = winningMoveKeysFor(nodesMap[id]);
  }

  for (const id of postorder(nodesMap)) {
    const node = nodesMap[id];
    if (outcomes[id] !== UNKNOWN) continue;
    const kids = node.children.filter((childId) => Boolean(nodesMap[childId]));
    if (winningMoveKeys[id].size > 0) {
      outcomes[id] = WIN;
      hits.rule1 += 1;
    } else if (kids.some((childId) => outcomes[childId] === WIN)) {
      outcomes[id] = LOSS;
      hits.rule2 += 1;
    } else if (
      kids.length > 0 &&
      kids.every((childId) => outcomes[childId] === LOSS)
    ) {
      outcomes[id] = WIN;
      hits.rule3 += 1;
    }
  }

  // A subtree containing reusable decided evidence must survive even when its
  // immediate root is still `unknown`. Evaluate this before deciding cuts.
  const evidenceMemo = new Map<string, boolean>();
  const evidenceVisiting = new Set<string>();
  const subtreeHasEvidence = (id: string, rootWins: Set<string>): boolean => {
    const node = nodesMap[id];
    if (!node) return false;
    const memoKey = `${id}:${[...rootWins].sort().join(",")}`;
    if (evidenceMemo.has(memoKey)) return evidenceMemo.get(memoKey) as boolean;
    if (evidenceVisiting.has(id)) return false;
    evidenceVisiting.add(id);
    const result =
      isDecidedEvidence(node, rootWins) ||
      node.children.some((childId) =>
        nodesMap[childId] ? subtreeHasEvidence(childId, rootWins) : false,
      );
    evidenceVisiting.delete(id);
    evidenceMemo.set(memoKey, result);
    return result;
  };

  const cutEdges: Record<string, Set<string>> = {};
  let decidedChildrenKept = 0;
  for (const [id, node] of Object.entries(nodesMap)) {
    if (outcomes[id] === UNKNOWN) continue;
    const rootWins = winningMoveKeys[id];
    for (const childId of node.children) {
      const child = nodesMap[childId];
      if (!child) continue;
      if (isDecidedEvidence(child, rootWins)) {
        decidedChildrenKept += 1;
        continue;
      }
      if (outcomes[childId] !== UNKNOWN) continue;
      if (subtreeHasEvidence(childId, rootWins)) continue;
      (cutEdges[id] ??= new Set<string>()).add(childId);
    }
  }

  // Any node reachable from a graph root through non-cut edges survives. This
  // protects shared nodes (transpositions/DAGs) and their descendants automatically.
  const incoming = new Set<string>();
  for (const node of Object.values(nodesMap)) {
    for (const childId of node.children) {
      if (nodesMap[childId]) incoming.add(childId);
    }
    if (node.parentId && nodesMap[node.parentId]) incoming.add(node.id);
  }
  const roots = new Set<string>();
  for (const id of Object.keys(nodesMap)) {
    const parentId = nodesMap[id].parentId;
    if (!parentId || !nodesMap[parentId] || !incoming.has(id)) roots.add(id);
  }
  for (const id of protectedIds) {
    if (nodesMap[id]) roots.add(id);
  }

  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift() as string;
    if (reachable.has(id) || !nodesMap[id]) continue;
    reachable.add(id);
    for (const childId of nodesMap[id].children) {
      if (!nodesMap[childId] || cutEdges[id]?.has(childId)) continue;
      queue.push(childId);
    }
  }
  const removedIds = Object.keys(nodesMap).filter((id) => !reachable.has(id));
  const removedSet = new Set(removedIds);
  const cutEdgePairs: Array<[string, string]> = [];
  for (const [parentId, children] of Object.entries(cutEdges)) {
    if (removedSet.has(parentId)) continue;
    for (const childId of children) {
      if (removedSet.has(childId)) continue;
      cutEdgePairs.push([parentId, childId]);
    }
  }

  // Cut edges are removed even when the child survives elsewhere (DAG reuse).
  for (const [id, node] of Object.entries(nodesMap)) {
    const cutChildren = cutEdges[id] ?? new Set<string>();
    node.children = node.children.filter(
      (childId) => !cutChildren.has(childId) && !removedSet.has(childId),
    );
  }
  // Prefer a surviving parent after a cut; otherwise clear the stale pointer.
  for (const [id, node] of Object.entries(nodesMap)) {
    if (!node.parentId) continue;
    const parentStillReferences = nodesMap[node.parentId]?.children.includes(id);
    if (parentStillReferences) continue;
    const replacement = Object.values(nodesMap).find((candidate) =>
      candidate.children.includes(id),
    );
    node.parentId = replacement?.id;
  }

  // Persist the outcome and its colour. Unknown nodes keep manual memo colours.
  for (const [id, node] of Object.entries(nodesMap)) {
    const outcome = outcomes[id];
    nodesMap[id] = {
      ...node,
      outcome,
      color: outcomeColor(node, outcome),
    };
  }

  const counts = Object.values(outcomes).reduce(
    (acc, value) => {
      acc[value] += 1;
      return acc;
    },
    { win: 0, loss: 0, unknown: 0 } as Record<ExplorationOutcome, number>,
  );

  return {
    nodesMap,
    removedIds,
    cutEdgePairs,
    stats: {
      nodesBefore: Object.keys(nodesMap).length,
      nodesAfter: Object.keys(nodesMap).length - removedIds.length,
      nodesRemoved: removedIds.length,
      edgesCut: cutEdgePairs.length,
      outcomeWin: counts.win,
      outcomeLoss: counts.loss,
      outcomeUnknown: counts.unknown,
      ruleHits: hits,
      decidedChildrenKept,
    },
  };
}

/** Used by UI status text; do not infer outcomes from colour alone. */
export const OUTCOME_LABELS: Record<ExplorationOutcome, string> = {
  win: "Certain win (this side can force a win)",
  loss: "Losing (the opponent can force a win)",
  unknown: "Not decided yet",
};

/** A transposition to an evaluated/decided position resolves its new parent. */
export const isReusablePositionColor = (color: string): boolean =>
  DECISIVE_OR_EVALUATED_COLORS.includes(color);
