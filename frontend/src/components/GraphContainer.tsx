import React, { useEffect } from "react";
import { NeutreekoBoard } from "./board/NeutreekoBoard";
import { useGraphLogic } from "../hooks/useGraphLogic";
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

export const GraphContainer: React.FC = () => {
  const {
    nodes,
    edges,
    nodesMap,
    selectedNodeId,
    setNodes,
    setEdges,
    setNodesMap,
    setSelectedNodeId,
    addNode,
    deleteNode,
    updateNodeColor,
    toggleChildren,
    addLegalMovesFromApi,
    saveGraph,
  } = useGraphLogic(
    "http://127.0.0.1:8000/load_graph",
    "http://127.0.0.1:8000/save_graph"
  );

  const BoardComponent = NeutreekoBoard; // ここで PyrgaBoard に切り替え可能

  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((n) => {
        const mapNode = nodesMap[n.id];
        if (!mapNode) return n;
        return {
          ...n,
          data: {
            ...n.data,
            label: (
              <BoardComponent board={mapNode.board} color={mapNode.color} />
            ),
          },
          hidden: mapNode.hidden ?? false,
        };
      })
    );
  }, [nodesMap, BoardComponent, setNodes]);

  const handleNodesDelete = (deletedNodes: Node[]) => {
    deletedNodes.forEach((node) => {
      deleteNode(node.id);
    });
  };
  return (
    <ReactFlowProvider>
      <div style={{ display: "flex", height: "100vh" }}>
        <div style={{ flex: 3 }}>
          <ReactFlow
            nodes={nodes.filter((n) => !n.hidden)}
            edges={edges.filter((e) => !e.hidden)}
            onNodesChange={(changes) =>
              setNodes((nds) => {
                const updated = [...nds];
                return updated;
              })
            }
            onEdgesChange={(changes) => setEdges((eds) => [...eds])}
            onNodeClick={(e, node) => {
              setSelectedNodeId(node.id);
            }}
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
              boardComponent={BoardComponent}
              addLegalMoves={addLegalMovesFromApi}
              deleteNode={() => deleteNode(selectedNodeId)}
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
