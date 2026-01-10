import React from "react";

type NeutreekoBoardNodeProps = {
  board: string[][];
  color?: string;
};

const BOARD_SIZE = 5;

export const NeutreekoBoardNode: React.FC<NeutreekoBoardNodeProps> = ({
  board,
  color,
}) => {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${BOARD_SIZE}, 15px)`,
        backgroundColor: color,
      }}
    >
      {board.flat().map((cell, idx) => (
        <div
          key={idx}
          style={{
            width: 15,
            height: 15,
            border: "1px solid #333",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor:
              cell === "." ? "white" : cell === "B" ? "black" : "pink",
            color: cell === "B" ? "white" : "black",
          }}
        >
          {cell !== "." ? cell : ""}
        </div>
      ))}
    </div>
  );
};
