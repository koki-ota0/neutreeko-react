// frontend/src/components/boards/pyrga/PyrgaBoard.tsx
import React from "react";

export type PyrgaPiece = "S" | "T" | "C"; // Square, Triangle, Cylinder

export type PyrgaCell = PyrgaPiece[]; // 1マスに複数ピースを置ける

export interface PyrgaBoardProps {
  board: PyrgaCell[][]; // 4x4
  color?: string; // マス背景色
  cellSize?: number; // 1マスのサイズ（px）
}

const BOARD_SIZE = 4;

export const PyrgaBoard: React.FC<PyrgaBoardProps> = ({
  board,
  color = "#eee",
  cellSize = 30,
}) => {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${BOARD_SIZE}, ${cellSize}px)`,
        gap: 2,
        backgroundColor: "#333",
        padding: 4,
      }}
    >
      {board.flatMap((row, rIdx) =>
        row.map((cell, cIdx) => (
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
              border: "1px solid #333",
            }}
          >
            {cell.map((piece, idx) => {
              const pieceColor =
                piece === "S" ? "black" : piece === "T" ? "red" : "blue";
              return (
                <div
                  key={idx}
                  style={{
                    width: cellSize / 2,
                    height: cellSize / 2,
                    backgroundColor: pieceColor,
                    borderRadius: piece === "C" ? "50%" : "0%", // Cylinderは丸
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontSize: 10,
                    color: "white",
                  }}
                >
                  {piece === "T" ? "▲" : piece === "S" ? "■" : "●"}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
};
