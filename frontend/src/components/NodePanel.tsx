// NodePanel.tsx
import React from "react";
import { MyNodeData } from "../types/MyNodeData";

interface NodePanelProps {
  node: MyNodeData & { color?: string };
  boardComponent: React.ComponentType<{ board: any; color?: string }>;
  addLegalMoves: () => void;
  deleteNode: () => void;
  hideNode: () => void;
  updateNodeColor: (color: string) => void;
  toggleChildren: (nodeId: string) => void;
  hideyellow: () => void;
  deleteChildren: (nodeId: string) => void;
  showGreen: () => void;
  saveGraph: () => void;
}

export const NodePanel: React.FC<NodePanelProps> = ({
  node,
  boardComponent: BoardComponent,
  addLegalMoves,
  deleteNode,
  hideNode,
  updateNodeColor,
  toggleChildren,
  hideyellow,
  deleteChildren,
  showGreen,
  saveGraph,
}) => {
  const colors = [
    "#ffffff",
    "#cccccc", // またルート見えず
    "#ffcc99", // ループノード
    "#99ff99", // プレイ中のノード
    "#11c101ff", // プレイ終了のノード
    "#ff9999", // 選ばない方がいい
    "#9999ff", // ほとんど勝ち
    "#ffff99", // 選んじゃダメ
    "#285294", // 勝ち確
  ]; // 6色

  return (
    <div>
      <div>
        <strong>Current Player:</strong> {node.currentPlayer}
        <p>Node ID: {node.id}</p>
      </div>
      <div style={{ marginTop: 10 }}>
        <BoardComponent board={node.board} color={node.color} />
      </div>

      <div style={{ marginTop: 10 }}>
        <button onClick={addLegalMoves}>Add Legal Moves</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <button onClick={deleteNode}>Delete Node</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <button onClick={hideNode}>Hide Node</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <label>Node Color: </label>
        <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
          {colors.map((c) => (
            <div
              key={c}
              onClick={() => updateNodeColor(c)}
              style={{
                width: 20,
                height: 20,
                backgroundColor: c,
                border: node.color === c ? "3px solid #000" : "1px solid #333",
                cursor: "pointer",
              }}
            />
          ))}
        </div>
      </div>
      <button onClick={() => toggleChildren(node.id)}>
        {node.hiddenChildren ? "Show Children" : "Hide Children"}
      </button>
      <button onClick={hideyellow} style={{ marginTop: "10px" }}>
        Hide Yellow Nodes
      </button>
      <button
        onClick={() => deleteChildren(node.id)}
        style={{ marginTop: "10px" }}
      >
        Delete Children Nodes
      </button>
      <button onClick={() => showGreen()} style={{ marginTop: "10px" }}>
        Show Green nodes
      </button>
      <button onClick={saveGraph} style={{ marginTop: "10px" }}>
        Save Graph
      </button>
    </div>
  );
};
