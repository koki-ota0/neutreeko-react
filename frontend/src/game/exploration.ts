/**
 * Minimax-style exploration rules, shared by live expansion and the
 * "Apply exploration rules" action.
 *
 * PERSPECTIVE: the persisted `outcome` is still from the node's
 * `currentPlayer` point of view (`win` = side to move can force a win,
 * `loss` = side to move is lost). The UI deliberately shows the INVERSE,
 * from the player who just moved: `loss` is labelled "Certain win" and
 * `win` is labelled "Losing". That inversion is in `OUTCOME_COLORS` /
 * `OUTCOME_LABELS`, NOT in this engine.
 *
 * 1. HIGHEST PRIORITY: a parent with a three-in-a-row child — or a legal move
 *    that would create one — becomes `loss` (UI "Certain win"). The decided
 *    child is not added during live expansion. This overrides rules 2/3 and
 *    even an already-persisted `win`/`loss` outcome.
 * 2. Any child that is `loss` (UI "Certain win") makes its parent `win`
 *    (UI "Losing"). Every OTHER **Unanalyzed** child of that parent, and its
 *    whole subtree, is cut. This is the "Certain win child → Losing parent"
 *    propagation the user asked for.
 * 3. A node whose children are ALL `win` (UI "Losing") becomes `loss`
 *    (UI "Certain win"). Its own parent then becomes `win` via rule 2, and
 *    the same sibling pruning applies one level higher.
 *
 * Live expansion additionally drops `unsafe_moves` (one-reply losses) before
 * creating children; if no candidate remains, the hook marks the parent
 * `loss` (UI "Certain win") directly. Those moves never reach this engine.
 *
 * Already decided/evaluated children are never removed: they are reusable
 * evidence for transpositions. The one-time migration of the legacy graph
 * lives in `backend/exploration.py`; this module uses the explicit `outcome`
 * field and is colour-independent for pruning decisions.
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
  /** Edges from a rule-2 parent to its other white Unanalyzed children. */
  unanalyzedSiblingsPruned: number;
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

/** A decided board: three in a row is already on the board. */
const isThreeInARowNode = (node: MyNodeData): boolean =>
  Boolean(node.analysis?.gameOver && node.analysis?.winner) ||
  node.color === POSITION_COLORS.winning;

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

  const winningMoveKeys: Record<string, Set<string>> = {};
  for (const id of Object.keys(nodesMap)) {
    winningMoveKeys[id] = winningMoveKeysFor(nodesMap[id]);
  }

  const initialOutcomes = (): Record<string, ExplorationOutcome> => {
    const outcomes: Record<string, ExplorationOutcome> = {};
    for (const [id, node] of Object.entries(nodesMap)) {
      outcomes[id] = persistedOutcome(node);
      if (
        outcomes[id] === UNKNOWN &&
        node.analysis?.gameOver &&
        node.analysis.winner
      ) {
        // The side to move here has lost; the player who just moved won.
        outcomes[id] = LOSS;
      }
      if (outcomes[id] === UNKNOWN && node.color === POSITION_COLORS.noMoves) {
        outcomes[id] = LOSS;
      }
    }
    return outcomes;
  };

  const cutEdges: Record<string, Set<string>> = {};
  const addCut = (parentId: string, childId: string): boolean => {
    const siblings = (cutEdges[parentId] ??= new Set<string>());
    if (siblings.has(childId)) return false;
    siblings.add(childId);
    return true;
  };
  const effectiveKids = (id: string): string[] =>
    (nodesMap[id]?.children ?? []).filter(
      (childId) => Boolean(nodesMap[childId]) && !cutEdges[id]?.has(childId),
    );
  const isUnanalyzedChild = (
    childId: string,
    outcomes: Record<string, ExplorationOutcome>,
  ): boolean => {
    const child = nodesMap[childId];
    return (
      Boolean(child) &&
      child.color === POSITION_COLORS.unanalyzed &&
      outcomes[childId] === UNKNOWN
    );
  };

  let outcomes = initialOutcomes();
  let hits = { rule1: 0, rule2: 0, rule3: 0 };
  let unanalyzedSiblingsPruned = 0;
  // Recompute outcomes from persisted state, then cut the remaining white
  // Unanalyzed siblings of each freshly rule-2 parent. Cutting can make a
  // grandparent "all losing", so iterate until no new edge is cut.
  const maxPasses = Object.keys(nodesMap).length + 2;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    outcomes = initialOutcomes();
    const passOutcomes = outcomes;
    hits = { rule1: 0, rule2: 0, rule3: 0 };
    const rule2Parents = new Set<string>();
    for (const id of postorder(nodesMap)) {
      const kids = effectiveKids(id);
      // Rule 1 has absolute priority and overrides a stale persisted result.
      if (
        winningMoveKeys[id].size > 0 ||
        kids.some((childId) => isThreeInARowNode(nodesMap[childId]))
      ) {
        passOutcomes[id] = LOSS;
        hits.rule1 += 1;
        continue;
      }
      if (passOutcomes[id] !== UNKNOWN) continue;
      const hasLossChild = kids.some(
        (childId) => passOutcomes[childId] === LOSS,
      );
      const allWinChildren =
        kids.length > 0 &&
        kids.every((childId) => passOutcomes[childId] === WIN);
      if (hasLossChild) {
        passOutcomes[id] = WIN;
        hits.rule2 += 1;
        rule2Parents.add(id);
      } else if (allWinChildren) {
        passOutcomes[id] = LOSS;
        hits.rule3 += 1;
      }
    }

    let changed = false;
    for (const parentId of rule2Parents) {
      for (const childId of effectiveKids(parentId)) {
        // Keep every already-decided child, especially the `loss` child that
        // triggered rule 2. Delete only white, still-unknown alternatives.
        if (passOutcomes[childId] !== UNKNOWN) continue;
        if (!isUnanalyzedChild(childId, passOutcomes)) continue;
        if (addCut(parentId, childId)) {
          changed = true;
          unanalyzedSiblingsPruned += 1;
        }
      }
    }
    if (!changed) break;
  }

  // Ordinary evidence protection for whatever remains: a subtree containing
  // reusable decided evidence survives even under an unknown parent.
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

  let decidedChildrenKept = 0;
  for (const [id, node] of Object.entries(nodesMap)) {
    if (outcomes[id] === UNKNOWN) continue;
    const rootWins = winningMoveKeys[id];
    for (const childId of node.children) {
      if (cutEdges[id]?.has(childId)) continue;
      const child = nodesMap[childId];
      if (!child) continue;
      if (isDecidedEvidence(child, rootWins)) {
        decidedChildrenKept += 1;
        continue;
      }
      if (outcomes[childId] !== UNKNOWN) continue;
      if (subtreeHasEvidence(childId, rootWins)) continue;
      addCut(id, childId);
    }
  }

  // Reachability through non-cut edges protects shared DAG nodes. `incoming`
  // uses ORIGINAL children so a cut child is not mistaken for a new root.
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

  for (const [id, node] of Object.entries(nodesMap)) {
    const cutChildren = cutEdges[id] ?? new Set<string>();
    node.children = node.children.filter(
      (childId) => !cutChildren.has(childId) && !removedSet.has(childId),
    );
  }
  for (const [id, node] of Object.entries(nodesMap)) {
    if (!node.parentId) continue;
    const parentStillReferences = nodesMap[node.parentId]?.children.includes(id);
    if (parentStillReferences) continue;
    const replacement = Object.values(nodesMap).find((candidate) =>
      candidate.children.includes(id),
    );
    node.parentId = replacement?.id;
  }

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
      unanalyzedSiblingsPruned,
    },
  };
}

/** UI labels are from the previous mover's perspective (inverse of stored). */
export const OUTCOME_LABELS: Record<ExplorationOutcome, string> = {
  win: "Losing (the player who just moved is lost)",
  loss: "Certain win (the player who just moved can force a win)",
  unknown: "Not decided yet",
};

/** A transposition to an evaluated/decided position resolves its new parent. */
export const isReusablePositionColor = (color: string): boolean =>
  DECISIVE_OR_EVALUATED_COLORS.includes(color);
