import React from "react";
import {
  COLOR_SWATCH_GROUPS,
  getStatusMeta,
  POSITION_COLORS,
} from "../constants/colors";
import { ExplorationStats, OUTCOME_LABELS } from "../game/exploration";
import { GameType, MyNodeData } from "../types/MyNodeData";
import { BoardRenderer } from "../types/flow";

interface NodePanelProps {
  node: MyNodeData;
  boardComponent: BoardRenderer;
  gameType: GameType;
  busy: boolean;
  saveStatus: "idle" | "saving" | "saved" | "error";
  addLegalMoves: () => void;
  addLegalMoves2: () => void;
  applyExplorationRules: () => void;
  explorationStats: ExplorationStats | null;
  deleteNode: () => void;
  hideNode: () => void;
  updateNodeColor: (color: string) => void;
  toggleChildren: () => void;
  hideResolved: () => void;
  showAllNodes: () => void;
  visibleNodeCount: number;
  totalNodeCount: number;
  deleteChildren: () => void;
  showPlayLine: () => void;
  markUnsafeMoves: () => void;
  saveGraph: () => void;
  /** Optional labels for the static Pages build (download instead of POST). */
  saveButtonLabel?: string;
  saveSavedLabel?: string;
}

const rowStyle: React.CSSProperties = { marginTop: 10 };

export const NodePanel: React.FC<NodePanelProps> = ({
  node,
  boardComponent: BoardComponent,
  gameType,
  busy,
  saveStatus,
  addLegalMoves,
  addLegalMoves2,
  applyExplorationRules,
  explorationStats,
  deleteNode,
  hideNode,
  updateNodeColor,
  toggleChildren,
  hideResolved,
  showAllNodes,
  visibleNodeCount,
  totalNodeCount,
  deleteChildren,
  showPlayLine,
  markUnsafeMoves,
  saveGraph,
  saveButtonLabel = "Save graph",
  saveSavedLabel = "Saved",
}) => {
  const meta = getStatusMeta(node.color);
  const outcomeText =
    node.outcome === "win" || node.outcome === "loss"
      ? OUTCOME_LABELS[node.outcome]
      : null;

  return (
    <div>
      <div>
        <strong>Current player:</strong> {node.currentPlayer}
        <p style={{ margin: "4px 0" }}>Node ID: {node.id}</p>

        {/* Status is spelled out with an icon, label, short code and description. */}
        <div
          style={{
            marginTop: 6,
            border: "1px solid #e5e7eb",
            borderLeft: `6px solid ${meta.accent}`,
            borderRadius: 6,
            overflow: "hidden",
            background: meta.pattern,
            backgroundColor: "#ffffff",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 6px",
              backgroundColor: meta.chipBg,
              color: meta.chipText,
            }}
          >
            <span aria-hidden="true" style={{ fontWeight: 700 }}>
              {meta.icon}
            </span>
            <strong style={{ fontSize: 12 }}>{meta.label}</strong>
            <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700 }}>
              {meta.shortLabel}
            </span>
          </div>
          <div style={{ padding: "4px 6px", backgroundColor: "#ffffff" }}>
            <small>{meta.description}</small>
            {outcomeText && (
              <p style={{ margin: "4px 0 0" }}>
                <strong>Outcome:</strong> {outcomeText}
              </p>
            )}
          </div>
        </div>

        {node.winner && (
          <p style={{ color: POSITION_COLORS.winning }}>
            Winner: {node.winner} (the player who just moved)
          </p>
        )}
        {node.gameOver && <p>Terminal position — no legal moves.</p>}
        {node.moveNote === "mustNotChoose" && (
          <p
            style={{
              backgroundColor: "#fffbeb",
              borderLeft: "4px solid #f59e0b",
              color: "#8a6d00",
              padding: "4px 6px",
            }}
          >
            ⚠ Incoming move is flagged <em>must not choose</em> (structured
            note; not a proven losing outcome).
          </p>
        )}
        {node.analysis && (
          <p style={{ margin: "4px 0" }}>
            <small>
              Winning moves: {node.analysis.winningMoves.length} · Risky moves
              skipped: {node.analysis.unsafeMoves.length}
            </small>
          </p>
        )}
      </div>

      {/* The selected board is also shown on a neutral surface. */}
      <div style={rowStyle}>
        <div
          data-testid="panel-board-surface"
          style={{
            display: "inline-block",
            padding: 6,
            backgroundColor: "#ffffff",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
          }}
        >
          <BoardComponent board={node.board} />
        </div>
      </div>

      <div style={rowStyle}>
        <button disabled={busy} onClick={addLegalMoves}>
          Add legal moves
        </button>{" "}
        <button
          disabled={busy}
          onClick={addLegalMoves2}
          title="Expand two plies (capped)"
        >
          Add 2 levels of legal moves
        </button>{" "}
        <button
          disabled={busy}
          onClick={applyExplorationRules}
          title="Apply rules 1–3 to the whole graph"
        >
          Apply exploration rules
        </button>
        {explorationStats && (
          <div>
            <small>
              Last pass: {explorationStats.nodesRemoved} unknown nodes /{" "}
              {explorationStats.edgesCut} edges pruned ·{" "}
              {explorationStats.outcomeWin} certain wins /{" "}
              {explorationStats.outcomeLoss} losses · rule hits{" "}
              {explorationStats.ruleHits.rule1}/{explorationStats.ruleHits.rule2}/
              {explorationStats.ruleHits.rule3} (1 = three-in-a-row priority,
              overrides 3) ·{" "}
              {explorationStats.decidedChildrenKept} decided children kept.
            </small>
          </div>
        )}
      </div>
      <div style={rowStyle}>
        <button disabled={busy} onClick={markUnsafeMoves}>
          Mark risky moves
        </button>
        <div>
          <small>
            Unsafe moves are now <em>excluded from expansion</em>. This only
            adds a structured <em>must not choose</em> note to risky children
            that older graphs had already created; it is not a minimax result.
          </small>
        </div>
      </div>

      <div style={rowStyle}>
        <strong>Node status</strong>
        {COLOR_SWATCH_GROUPS.map((group) => (
          <div key={group.title} style={{ marginTop: 8 }}>
            <div>
              <small>
                <strong>{group.title}</strong> — {group.description}
              </small>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                marginTop: 5,
              }}
            >
              {group.swatches.map((swatch) => {
                const swatchMeta = getStatusMeta(swatch.color);
                const selected = node.color === swatch.color;
                return (
                  <button
                    key={swatch.color}
                    type="button"
                    title={swatch.description}
                    aria-label={`${group.title}: ${swatch.label}`}
                    aria-pressed={selected}
                    onClick={() => updateNodeColor(swatch.color)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "3px 6px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: selected ? 700 : 500,
                      backgroundColor: swatchMeta.chipBg,
                      color: swatchMeta.chipText,
                      border: selected
                        ? `3px solid ${swatchMeta.accent}`
                        : `1px solid ${swatchMeta.accent}`,
                      cursor: "pointer",
                    }}
                  >
                    <span aria-hidden="true">{swatchMeta.icon}</span>
                    <span>{swatch.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div style={rowStyle}>
        <button onClick={toggleChildren}>
          {node.hiddenChildren ? "Show children" : "Hide children"}
        </button>{" "}
        <button onClick={hideNode}>Hide node</button>
      </div>
      <div style={rowStyle}>
        <button
          onClick={hideResolved}
          title="Hide resolved nodes only; already hidden nodes stay hidden"
        >
          Hide resolved positions
        </button>{" "}
        <button
          onClick={showPlayLine}
          title="Show only nodes with a green work memo"
        >
          Show play line only
        </button>{" "}
        <button onClick={showAllNodes} title="Unhide every saved node">
          Show all nodes
        </button>
        <div>
          <small>
            Hides resolved nodes only. Already hidden Unanalyzed / memo nodes
            stay hidden; use Show all nodes to reveal them.
          </small>
        </div>
        <div>
          <small role="status">
            Visible: {visibleNodeCount} / {totalNodeCount} nodes
          </small>
        </div>
      </div>
      <div style={rowStyle}>
        <button onClick={deleteChildren}>Delete all children</button>{" "}
        <button onClick={deleteNode}>Delete node (and subtree)</button>
      </div>

      <div style={rowStyle}>
        <button disabled={busy || saveStatus === "saving"} onClick={saveGraph}>
          {saveStatus === "saving" ? "Saving…" : saveButtonLabel}
        </button>{" "}
        {saveStatus === "saved" && (
          <span role="status">{saveSavedLabel}</span>
        )}
        {saveStatus === "error" && <span role="alert">Save failed</span>}
      </div>

      <p style={{ marginTop: 12 }}>
        <small>Game: {gameType}</small>
      </p>
    </div>
  );
};
