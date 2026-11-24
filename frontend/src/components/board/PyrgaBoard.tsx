import React from "react";
import { PYRGA_SIZE } from "../../constants/game";
import { BoardRenderProps } from "../../types/flow";
import { PyrgaCell, PyrgaPiece } from "../../types/pyrga";

const SURFACE = "#f8fafc";

export interface PyrgaBoardProps extends BoardRenderProps {
  lastMove?: { row: number; col: number; piece: PyrgaPiece };
  cellSize?: number;
}

const asCell = (value: unknown): PyrgaCell =>
  Array.isArray(value)
    ? value.filter(
        (piece): piece is PyrgaPiece =>
          !!piece &&
          typeof piece === "object" &&
          ["S", "T", "C"].includes((piece as PyrgaPiece).type),
      )
    : [];

export const PyrgaBoard: React.FC<PyrgaBoardProps> = ({
  board,
  lastMove,
  cellSize = 20,
}) => {
  const rows = (Array.isArray(board) ? board : []) as unknown[][];

  return (
    <div
      role="grid"
      aria-label="Pyrga board"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${PYRGA_SIZE}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${PYRGA_SIZE}, ${cellSize}px)`,
        gap: 2,
        backgroundColor: "#ffffff",
        border: "2px solid #334155",
        borderRadius: 3,
        padding: 4,
      }}
    >
      {Array.from({ length: PYRGA_SIZE }, (_, rowIndex) =>
        Array.from({ length: PYRGA_SIZE }, (_, colIndex) => {
          const pieces = asCell(rows?.[rowIndex]?.[colIndex]);
          return (
            <div
              role="gridcell"
              key={`${rowIndex}-${colIndex}`}
              style={{
                width: cellSize,
                height: cellSize,
                backgroundColor: SURFACE,
                border: "1px solid #cbd5e1",
                borderRadius: 2,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                overflow: "hidden",
              }}
            >
              {pieces.map((piece, index) => {
                const isLastMove =
                  !!lastMove &&
                  lastMove.row === rowIndex &&
                  lastMove.col === colIndex &&
                  lastMove.piece === piece;
                const backgroundColor =
                  piece.type === "S"
                    ? piece.player === "B"
                      ? "#111827"
                      : "#ffffff"
                    : piece.type === "T"
                      ? piece.player === "B"
                        ? "#7f1d1d"
                        : "#fbcfe8"
                      : piece.player === "B"
                        ? "#1d4ed8"
                        : "#bfdbfe";
                return (
                  <div
                    key={`${piece.type}-${index}`}
                    style={{
                      width: cellSize / 2,
                      height: cellSize / 2,
                      backgroundColor,
                      borderRadius: piece.type === "C" ? "50%" : "0%",
                      border: isLastMove
                        ? "2px solid #f59e0b"
                        : "1px solid #475569",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      fontSize: 10,
                      color: piece.player === "B" ? "#ffffff" : "#111827",
                    }}
                  >
                    {piece.type === "S" ? "■" : piece.type === "T" ? "▲" : "●"}
                  </div>
                );
              })}
            </div>
          );
        }),
      )}
    </div>
  );
};
