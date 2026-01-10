import { useState, useEffect } from "react";
import { Node, Edge, NodeChange, applyNodeChanges } from "react-flow-renderer";
import { MyNodeData } from "../types/MyNodeData";

let idCounter = 0;
const getId = () => `node_${idCounter++}`;

export const useGraphLogic = (gameType: string) => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [nodesMap, setNodesMap] = useState<{ [key: string]: MyNodeData }>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [lastMove, setLastMove] = useState<[number, number, string] | null>(
    null
  ); // Pyrgaのみ使用

  // ===== ユーティリティ =====
  const getDescendants = (nodeId: string) => {
    const result: string[] = [];
    const queue = [...(nodesMap[nodeId]?.children || [])];
    while (queue.length) {
      const childId = queue.shift()!;
      result.push(childId);
      queue.push(...(nodesMap[childId]?.children || []));
    }
    return result;
  };

  const getChildren = (nodeId: string) => nodesMap[nodeId]?.children || [];

  const loadGraphFromApi = async () => {
    try {
      const res = await fetch(
        `http://127.0.0.1:8000/load_graph?game_type=${gameType}`
      );
      if (!res.ok) throw new Error("Failed to fetch graph");
      const data = await res.json();

      setNodesMap(data.nodesMap || {});
      setNodes(data.nodes || []);
      setEdges(data.edges || []);
      setSelectedNodeId(data.selectedNodeId || null);

      const maxId = (data.nodes || []).reduce((max: number, n: Node) => {
        const num = parseInt(n.id.replace("node_", ""));
        return isNaN(num) ? max : Math.max(max, num);
      }, 0);
      idCounter = maxId + 1;
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadGraphFromApi();
  }, [gameType]);

  // ===== ノード追加 =====
  const addNode = (
    parentId: string | null,
    board: string[][],
    currentPlayer: string,
    index: number,
    siblingCount: number
  ) => {
    const newId = getId();
    const newNodeData: MyNodeData = {
      id: newId,
      board,
      currentPlayer,
      parentId: parentId || undefined,
      children: [],
    };

    setNodesMap((prev) => {
      const updated = { ...prev, [newId]: newNodeData };
      if (parentId && !updated[parentId].children.includes(newId)) {
        updated[parentId].children.push(newId);
      }
      return updated;
    });

    let position = { x: Math.random() * 400, y: Math.random() * 400 };
    if (parentId) {
      const parentNode = nodes.find((n) => n.id === parentId);
      if (parentNode) {
        const offset = 140;
        let tmpX =
          siblingCount !== 1
            ? parentNode.position.x + (index - (siblingCount - 1) / 2) * offset
            : parentNode.position.x;
        position = { x: tmpX, y: parentNode.position.y + offset };
      }
    }

    const newNode: Node = {
      id: newId,
      data: { label: null },
      position,
    };

    setNodes((nds) => [...nds, newNode]);

    if (parentId) {
      const newEdge: Edge = {
        id: `e_${parentId}_${newId}`,
        source: parentId,
        target: newId,
      };
      setEdges((eds) => [...eds, newEdge]);
    }
  };

  // ===== ノード削除 =====
  const deleteNode = (nodeId: string) => {
    // 子も再帰削除
    getChildren(nodeId).forEach((childId) => deleteNode(childId));

    setNodesMap((prev) => {
      const updated = { ...prev };
      // 親の children 配列から除外
      Object.values(updated).forEach((n) => {
        n.children = n.children.filter((cId) => cId !== nodeId);
      });
      delete updated[nodeId];
      return updated;
    });

    setNodes((nds) => nds.filter((n) => n.id !== nodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
    );

    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };
  const handleNodesDelete = (deletedNodes: Node[]) => {
    deletedNodes.forEach((node) => {
      deleteNode(node.id);
    });
  };

  // ===== ノード色変更 =====
  const updateNodeColor = (color: string, nodeId?: string) => {
    const targetId = nodeId || selectedNodeId;
    if (!targetId) return;

    setNodesMap((prev) => ({
      ...prev,
      [targetId]: { ...prev[targetId], color },
    }));
  };

  // ===== 子ノード表示切替 =====
  const toggleChildren = (nodeId: string) => {
    const targetNode = nodesMap[nodeId];
    const hide = !targetNode.hiddenChildren;
    const descendants = getDescendants(nodeId);

    setNodesMap((prev) => {
      const updated = { ...prev };
      updated[nodeId].hiddenChildren = hide;
      descendants.forEach((id) => {
        if (!updated[id]) return;
        updated[id].hidden = hide;
      });
      return updated;
    });

    setNodes((prev) =>
      prev.map((n) => ({ ...n, hidden: nodesMap[n.id]?.hidden || false }))
    );
    setEdges((prev) =>
      prev.map((e) => ({
        ...e,
        hidden:
          (nodesMap[e.source]?.hidden ?? false) ||
          (nodesMap[e.target]?.hidden ?? false),
      }))
    );
  };

  // ===== APIから法的手を追加 =====
  const addLegalMovesFromApi = async () => {
    if (!selectedNodeId) return;
    const node = nodesMap[selectedNodeId];
    const body: any = {
      board: node.board,
      player: node.currentPlayer,
    };
    if (gameType === "pyrga") body.last_move = lastMove;

    try {
      console.log(JSON.stringify(body));
      const res = await fetch(`http://127.0.0.1:8000/legal_moves/${gameType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error("Failed to fetch legal moves");
      const data = await res.json();
      const moves: number[][] = data.moves;

      if (moves.length === 0) {
        updateNodeColor("#ff99ff"); // no moves
        const parentId = node.parentId;
        if (parentId) updateNodeColor("#ffff99", parentId);
        return;
      }

      moves.forEach(([r1, c1, r2, c2], idx) => {
        const newBoard = node.board.map((row, i) =>
          row.map((cell, j) =>
            i === r1 && j === c1
              ? "."
              : i === r2 && j === c2
              ? node.board[r1][c1]
              : cell
          )
        );
        addNode(
          selectedNodeId,
          newBoard,
          node.currentPlayer === "B" ? "W" : "B",
          idx,
          moves.length
        );
      });
    } catch (e) {
      console.error(e);
      alert("Failed to fetch legal moves");
    }
  };

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((nds) => {
      const updatedNodes = applyNodeChanges(changes, nds);
      // nodesMap の position も更新
      setNodesMap((prev) => {
        const newMap = { ...prev };
        updatedNodes.forEach((n) => {
          if (newMap[n.id]) newMap[n.id].position = n.position;
        });
        return newMap;
      });
      return updatedNodes;
    });
  };

  // ===== 保存 =====
  const saveGraph = async () => {
    const payload = {
      nodes: nodes.map((n) => ({ id: n.id, position: n.position })),
      edges,
      nodesMap,
      selectedNodeId,
    };
    try {
      await fetch(`http://127.0.0.1:8000/save_graph?game_type=${gameType}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log("Graph saved!");
    } catch (e) {
      console.error(e);
      alert("Failed to save graph");
    }
  };

  return {
    nodes,
    edges,
    nodesMap,
    selectedNodeId,
    setNodes,
    setEdges,
    setNodesMap,
    setSelectedNodeId,
    lastMove,
    setLastMove,
    getChildren,
    getDescendants,
    addNode,
    deleteNode,
    handleNodesDelete,
    updateNodeColor,
    toggleChildren,
    addLegalMovesFromApi,
    onNodesChange,
    saveGraph,
  };
};
