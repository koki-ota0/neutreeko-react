import React from "react";
import { Handle, NodeProps, Position } from "react-flow-renderer";
import { getStatusMeta, OUTCOME_COLORS } from "../constants/colors";
import { OUTCOME_LABELS } from "../game/exploration";
import { BoardNodeData } from "../types/flow";

/**
 * A ReactFlow custom node. Boards live in `data` (not in JSX labels rebuilt by
 * an effect), so dragging does not rebuild every node in an ~8,000-node tree.
 *
 * The board itself is ALWAYS drawn on a white/neutral surface. Status is shown
 * by a labelled chip, a text icon, a short code, a coloured bar, a distinct
 * border style and a subtle pattern on the surrounding chrome. That keeps the
 * pieces readable and does not rely on colour (or a border) alone.
 */
export const BoardNode = React.memo(function BoardNode({
  data,
}: NodeProps<BoardNodeData>) {
  const Board = data?.Board;
  const meta = getStatusMeta(data?.color ?? "#ffffff");
  const flagged = data?.moveNote === "mustNotChoose";
  const outcome = data?.outcome;

  // Stored `outcome` is currentPlayer-relative; the UI shows the INVERSE,
  // from the player who just moved. `loss` displays as a certain win, `win`
  // as a loss. Colours come from OUTCOME_COLORS, which is inverted too.
  const outcomeLabel =
    outcome === "loss" ? "WIN" : outcome === "win" ? "LOSS" : null;
  const outcomeIcon =
    outcome === "loss" ? "✓" : outcome === "win" ? "×" : null;
  const outcomeDescription =
    outcome && outcome !== "unknown" ? OUTCOME_LABELS[outcome] : null;
  const outcomeAccent =
    outcome === "win"
      ? OUTCOME_COLORS.win
      : getStatusMeta(OUTCOME_COLORS.loss).accent;

  const statusTitle = [meta.label, outcomeDescription]
    .concat(flagged ? ["incoming move: must not choose"] : [])
    .filter(Boolean)
    .join(" — ");

  return (
    <div
      title={statusTitle}
      aria-label={`Node status: ${statusTitle}`}
      style={{
        position: "relative",
        minWidth: 120,
        padding: 0,
        backgroundColor: "#ffffff",
        border: `${meta.borderWidth}px ${meta.borderStyle} ${meta.accent}`,
        borderLeft: `8px solid ${meta.accent}`,
        borderRadius: 6,
        boxShadow: "0 1px 3px rgba(15, 23, 42, 0.18)",
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div
        style={{
          borderRadius: 4,
          overflow: "hidden",
          background: meta.pattern,
          backgroundColor: "#ffffff",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 5px",
            backgroundColor: meta.chipBg,
            color: meta.chipText,
            fontSize: 9,
            fontWeight: 700,
            lineHeight: 1.25,
            whiteSpace: "nowrap",
          }}
        >
          <span aria-hidden="true">{meta.icon}</span>
          <span>{meta.label}</span>
          <span style={{ marginLeft: "auto", opacity: 0.85 }}>
            {meta.shortLabel}
          </span>
        </div>

        {outcomeLabel && (
          <div
            title={outcomeDescription ?? undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "1px 5px",
              borderLeft: `4px solid ${outcomeAccent}`,
              borderTop: "1px solid #e5e7eb",
              backgroundColor: "#ffffff",
              color: "#111827",
              fontSize: 9,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            <span aria-hidden="true">{outcomeIcon}</span>
            <span>OUTCOME: {outcomeLabel}</span>
          </div>
        )}

        {flagged && (
          <div
            style={{
              padding: "1px 5px",
              borderTop: "1px solid #fcd34d",
              backgroundColor: "#fffbeb",
              color: "#8a6d00",
              fontSize: 9,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            ⚠ MUST NOT CHOOSE
          </div>
        )}

        <div
          data-testid="board-surface"
          style={{
            display: "flex",
            justifyContent: "center",
            padding: 4,
            borderTop: "1px solid #e5e7eb",
            backgroundColor: "#ffffff",
          }}
        >
          {Board ? (
            <Board board={data.board} />
          ) : (
            <span style={{ fontSize: 10 }}>Missing board</span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

export const nodeTypes = { board: BoardNode };
