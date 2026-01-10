// frontend/src/components/board/PyrgaBoard.tsx
import React, { JSX } from "react";
import { PyrgaCell, PyrgaPiece } from "../../types/pyrga";

// Props
export interface PyrgaBoardProps {
  board: PyrgaCell[][]; // 4x4
  color?: string; // マス背景色
  lastMove?: { row: number; col: number; piece: PyrgaPiece }; // 最後の手
  cellSize?: number; // px
}

export const PyrgaBoard: React.FC<PyrgaBoardProps> = ({
  board,
  color = "#eee",
  lastMove,
  cellSize = 20,
}) => {
  const BOARD_SIZE = board.length;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
        gap: 2,
        backgroundColor: "#fff",
        border: "2px solid #333",
        padding: 4,
      }}
    >
      {board.flatMap((row, rIdx) => {
        const rowElements: JSX.Element[] = [];
        for (let cIdx = 0; cIdx < row.length; cIdx++) {
          const cell = row[cIdx];
          const cellElements: JSX.Element[] = [];

          // cellが配列でない場合は空に変換
          const pieces: PyrgaPiece[] = Array.isArray(cell) ? cell : [];

          for (let i = 0; i < pieces.length; i++) {
            const piece = pieces[i];
            const isLastMove =
              lastMove &&
              lastMove.row === rIdx &&
              lastMove.col === cIdx &&
              lastMove.piece === piece;

            const bgColor =
              piece.type === "S"
                ? piece.player === "B"
                  ? "black"
                  : "white"
                : piece.type === "T"
                ? piece.player === "B"
                  ? "darkred"
                  : "pink"
                : piece.player === "B"
                ? "blue"
                : "lightblue";

            cellElements.push(
              <div
                key={i}
                style={{
                  width: cellSize / 2,
                  height: cellSize / 2,
                  backgroundColor: bgColor,
                  borderRadius: piece.type === "C" ? "50%" : "0%",
                  border: isLastMove ? "2px solid yellow" : "1px solid #555",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  fontSize: 12,
                  color: piece.player === "B" ? "white" : "black",
                }}
              >
                {piece.type === "S" ? "■" : piece.type === "T" ? "▲" : "●"}
              </div>
            );
          }

          rowElements.push(
            <div
              key={`${rIdx}-${cIdx}`}
              style={{
                width: cellSize,
                height: cellSize,
                backgroundColor: color,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              {cellElements}
            </div>
          );
        }
        return rowElements;
      })}
    </div>
  );
};
