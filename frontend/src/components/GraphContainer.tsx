import React from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
} from "react-flow-renderer";
import { useGraphLogic } from "../hooks/useGraphLogic";
import { GameType } from "../types/MyNodeData";
import { BoardRenderer } from "../types/flow";
import { nodeTypes } from "./BoardNode";
import { NodePanel } from "./NodePanel";

interface GraphContainerProps {
  gameType: GameType;
  BoardComponent: BoardRenderer;
}

export const GraphContainer: React.FC<GraphContainerProps> = ({
  gameType,
  BoardComponent,
}) => {
  const logic = useGraphLogic(gameType, BoardComponent);
  const selectedNode = logic.selectedNodeId
    ? logic.nodesMap[logic.selectedNodeId]
    : undefined;
  const totalNodeCount = Object.keys(logic.nodesMap).length;
  const visibleNodeCount = Object.values(logic.nodesMap).filter(
    (node) => !node.hidden,
  ).length;

  return (
    <ReactFlowProvider>
      <div style={{ display: "flex", height: "100vh" }}>
        <div style={{ flex: 3, position: "relative", minWidth: 0 }}>
          {logic.loading && (
            <div style={overlayStyle}>Loading graph…</div>
          )}
          {logic.error && (
            <div
              role="alert"
              style={{
                ...overlayStyle,
                backgroundColor: "rgba(255, 235, 235, 0.96)",
                color: "#8a1c1c",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <span>{logic.error}</span>
              <button onClick={() => void logic.loadGraphFromApi()}>
                Retry
              </button>
            </div>
          )}
          <ReactFlow
            nodes={logic.nodes}
            edges={logic.edges}
            nodeTypes={nodeTypes}
            onNodesChange={logic.onNodesChange}
            onEdgesChange={logic.onEdgesChange}
            onNodeClick={(_, node) => logic.setSelectedNodeId(node.id)}
            onNodesDelete={logic.handleNodesDelete}
            fitView
            style={{ width: "100%", height: "100%" }}
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>
        </div>
        <aside
          style={{
            flex: 1,
            padding: 10,
            overflowY: "auto",
            borderLeft: "1px solid #ddd",
          }}
        >
          <h3>Node Panel</h3>
          {logic.busy && <p role="status">Working…</p>}
          {selectedNode ? (
            <NodePanel
              node={selectedNode}
              boardComponent={BoardComponent}
              gameType={gameType}
              busy={logic.busy}
              saveStatus={logic.saveStatus}
              addLegalMoves={() => void logic.addLegalMovesFromApi(selectedNode.id)}
              addLegalMoves2={() => void logic.addLegalMovesFromApi2(selectedNode.id)}
              applyExplorationRules={logic.applyExplorationRules}
              explorationStats={logic.explorationStats}
              deleteNode={() => logic.deleteNode(selectedNode.id)}
              hideNode={() => logic.hideNode(selectedNode.id)}
              updateNodeColor={logic.updateNodeColor}
              toggleChildren={() => logic.toggleChildren(selectedNode.id)}
              hideResolved={logic.hideResolved}
              showAllNodes={logic.showAllNodes}
              visibleNodeCount={visibleNodeCount}
              totalNodeCount={totalNodeCount}
              deleteChildren={() => logic.deleteChildren(selectedNode.id)}
              showPlayLine={logic.showPlayLine}
              markUnsafeMoves={() => logic.markUnsafeMoves(selectedNode.id)}
              saveGraph={() => void logic.saveGraph()}
            />
          ) : (
            <p>Select a node to inspect it.</p>
          )}
        </aside>
      </div>
    </ReactFlowProvider>
  );
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  zIndex: 10,
  display: "flex",
  alignItems: "center",
  padding: "8px 12px",
  backgroundColor: "rgba(255, 255, 255, 0.95)",
  border: "1px solid #ccc",
  borderRadius: 4,
};
