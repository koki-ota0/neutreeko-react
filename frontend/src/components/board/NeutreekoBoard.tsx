import React from "react";
import { NEUTREEKO_SIZE } from "../../constants/game";
import { BoardRenderProps } from "../../types/flow";

const CELL_SIZE = 15;
const SURFACE = "#f8fafc";

/** 5x5 grid, black/white pieces. Tolerates legacy/malformed cell values. */
export const NeutreekoBoard: React.FC<BoardRenderProps> = ({ board }) => {
  const rows = (Array.isArray(board) ? board : []) as unknown[][];
  const cellAt = (r: number, c: number): string => {
    const value = rows?.[r]?.[c];
    return value === "B" || value === "W" ? value : ".";
  };

  return (
    <div
      role="grid"
      aria-label="Neutreeko board"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${NEUTREEKO_SIZE}, ${CELL_SIZE}px)`,
        gap: 1,
        padding: 2,
        backgroundColor: "#ffffff",
        border: "2px solid #334155",
        borderRadius: 3,
      }}
    >
      {Array.from({ length: NEUTREEKO_SIZE }, (_, r) =>
        Array.from({ length: NEUTREEKO_SIZE }, (_, c) => {
          const cell = cellAt(r, c);
          return (
            <div
              role="gridcell"
              key={`${r}-${c}`}
              style={{
                width: CELL_SIZE,
                height: CELL_SIZE,
                border: "1px solid #94a3b8",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                backgroundColor:
                  cell === "." ? SURFACE : cell === "B" ? "#111827" : "#fbcfe8",
                color: cell === "B" ? "#ffffff" : "#111827",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {cell !== "." ? cell : ""}
            </div>
          );
        }),
      )}
    </div>
  );
};
