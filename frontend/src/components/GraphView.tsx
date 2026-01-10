// GraphView.tsx
import React from "react";
import { useState } from "react";
import ReactFlow, {
  ReactFlowProvider,
  MiniMap,
  Controls,
  Background,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
} from "react-flow-renderer";
import { NodePanel } from "./NodePanel";
import { MyNodeData } from "../types/MyNodeData";

interface GraphViewProps {
  nodes: Node[];
  edges: Edge[];
  nodesMap: { [key: string]: MyNodeData };
  selectedNodeId: string | null;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  handleDeleteNode: (nodeId: string) => void;
  handleAddLegalMovesFromApi: () => void;
  updateNodeColor: (color: string) => void;
  toggleChildren: (nodeId: string) => void;
  saveGraph: () => void;
}

export const GraphView: React.FC<GraphViewProps> = ({
  nodes,
  edges,
  nodesMap,
  selectedNodeId,
  onNodesChange,
  onEdgesChange,
  onNodeClick,
  handleDeleteNode,
  handleAddLegalMovesFromApi,
  updateNodeColor,
  toggleChildren,
  saveGraph,
}) => {
  const handleNodesDelete = (deletedNodes: Node[]) => {
    deletedNodes.forEach((node) => {
      handleDeleteNode(node.id);
    });
  };
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <ReactFlowProvider>
      <div style={{ display: "flex", height: "100vh" }}>
        <div style={{ flex: 3 }}>
          <ReactFlow
            nodes={nodes.filter((n) => !n.hidden)}
            edges={edges.filter((e) => !e.hidden)}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodesDelete={handleNodesDelete}
            fitView
            style={{ width: "100%", height: "100%" }}
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </div>
        <div style={{ flex: 1, padding: "10px" }}>
          <h3>Node Panel</h3>
          {selectedNodeId && nodesMap[selectedNodeId] && (
            <NodePanel
              node={nodesMap[selectedNodeId]}
              addLegalMoves={handleAddLegalMovesFromApi}
              deleteNode={() => handleDeleteNode(selectedNodeId)}
              updateNodeColor={updateNodeColor}
              toggleChildren={toggleChildren}
              saveGraph={saveGraph}
            />
          )}
        </div>
        <button onClick={saveGraph} style={{ marginTop: "10px" }}>
          Save Graph
        </button>
      </div>
    </ReactFlowProvider>
  );
};
