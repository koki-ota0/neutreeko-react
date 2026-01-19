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
  const [nodeIndex, setNodeIndex] = useState<Record<string, string>>({});
  const keyFor = (board: string[][], player: string) =>
    JSON.stringify({ board, player });

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

  const addEdge = (edge: Edge) => {
    setEdges((prev) => {
      // 既存エッジチェック
      if (prev.find((e) => e.id === edge.id)) return prev;
      return [...prev, edge];
    });
  };

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
      return data;
    } catch (e) {
      console.error(e);
      return { nodesMap: {}, nodes: [], edges: [], selectedNodeId: null };
    }
  };

  useEffect(() => {
    loadGraphFromApi().then((data) => {
      const idx: Record<string, string> = {};

      const nodes = Object.values(data.nodesMap || {}) as MyNodeData[];

      nodes.forEach((n) => {
        const key = keyFor(n.board, n.currentPlayer);
        idx[key] = n.id;
      });

      setNodeIndex(idx);
    });
  }, [gameType]);

  const addNode = (
    parentId: string | null,
    board: string[][],
    currentPlayer: string,
    index: number,
    siblingCount: number,
    color?: string
  ) => {
    const key = keyFor(board, currentPlayer);
    const newId = getId();

    // ==== 内部データ構築 ====
    const newNodeData: MyNodeData = {
      id: newId,
      board,
      currentPlayer,
      parentId: parentId || undefined,
      children: [],
      color: color || "#ffffff",
      hidden: false,
      hiddenChildren: false,
      position: { x: 0, y: 0 }, // 仮置き、後で更新
    };

    // ==== 内部データ更新 ====
    setNodesMap((prev) => {
      const updated = { ...prev, [newId]: newNodeData };

      if (parentId && updated[parentId]) {
        const parent = updated[parentId];
        if (!parent.children.includes(newId)) {
          parent.children = [...parent.children, newId];
        }
      }
      return updated;
    });

    // ==== nodeIndex 更新 ====
    setNodeIndex((prev) => ({
      ...prev,
      [key]: newId,
    }));

    // ==== 位置計算 ====
    let position = { x: Math.random() * 400, y: Math.random() * 400 };

    if (parentId) {
      const parentNode = nodes.find((n) => n.id === parentId);
      if (parentNode) {
        const offset = 140;
        const tmpX =
          siblingCount !== 1
            ? parentNode.position.x + (index - (siblingCount - 1) / 2) * offset
            : parentNode.position.x;
        position = { x: tmpX, y: parentNode.position.y + offset };
      }
    }

    // ==== ReactFlow ノード追加（boardも保持させる）====
    const newNode: Node = {
      id: newId,
      data: {
        board,
        currentPlayer,
        color: color || "#ffffff",
      },
      position,
    };

    setNodes((prev) => [...prev, newNode]);

    // ==== Edge追加 ====
    if (parentId) {
      const newEdge: Edge = {
        id: `e_${parentId}_${newId}`,
        source: parentId,
        target: newId,
      };
      setEdges((prev) => [...prev, newEdge]);
    }
  };

  // ===== ノード削除 =====
  const deleteNode = (nodeId: string) => {
    const nodeColor = nodesMap[nodeId].color;
    if (nodeColor === "#285294" || nodeColor === "#ffff99") {
      return;
    }
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

    // nodeIndex からも削除
    setNodeIndex((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((key) => {
        if (updated[key] === nodeId) {
          delete updated[key];
        }
      });
      return updated;
    });
  };
  const handleNodesDelete = (deletedNodes: Node[]) => {
    deletedNodes.forEach((node) => {
      deleteNode(node.id);
    });
  };

  // ===== 子ノードの削除 =====
  const deleteChildren = (nodeId: string) => {
    const children = getChildren(nodeId);

    if (!children || children.length === 0) return;

    const blueChildren: string[] = [];
    const deleteTargets: string[] = [];

    // 色判定して仕分け
    children.forEach((childId) => {
      const childNode = nodesMap[childId];
      if (!childNode) return;

      if (childNode.color === "#285294") {
        blueChildren.push(childId);
      } else {
        deleteTargets.push(childId);
      }
    });

    // 青以外の子を削除
    deleteTargets.forEach((childId) => {
      deleteNode(childId);
    });

    // 親ノードの children を青だけ残す
    setNodesMap((prev) => {
      const updated = { ...prev };
      if (updated[nodeId]) {
        updated[nodeId] = {
          ...updated[nodeId],
          children: blueChildren,
        };
      }
      return updated;
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

  const hideNode = (nodeId: string) => {
    setNodesMap((prev) => {
      const updated = { ...prev };
      updated[nodeId].hidden = true;
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
        updateNodeColor("#ff99ff");
        // 親ノードの色も変更
        const parentId = nodesMap[selectedNodeId]?.parentId;
        const parent = parentId ? nodesMap[parentId] : null;

        if (parentId && parent) {
          updateNodeColor("#ffff99", parent.id);
          // 兄弟削除
          const siblings = [...parent.children];
          siblings.forEach((siblingId) => {
            if (siblingId !== selectedNodeId) {
              deleteNode(siblingId);
            }
          });
          toggleChildren(parentId);
        }
        return;
      }

      let breakpoint = false;

      moves.forEach(([r1, c1, r2, c2], idx) => {
        if (breakpoint) return;
        const newBoard = node.board.map((row, i) =>
          row.map((cell, j) =>
            i === r1 && j === c1
              ? "."
              : i === r2 && j === c2
                ? node.board[r1][c1]
                : cell
          )
        );
        let color: string = "#ffffff";

        const key = keyFor(newBoard, node.currentPlayer === "B" ? "W" : "B");
        const existingId = nodeIndex[key];

        if (existingId) {
          const existingNode = nodesMap[existingId];
          console.log(
            "Existing node found for legal move:",
            existingId,
            existingNode
          );
          existingNode.hidden = false; // ノード表示
          // エッジを追加
          const edgeId = `e_${selectedNodeId}_${existingId}`;
          setEdges((eds) => {
            // 既存エッジチェック
            if (eds.find((e) => e.id === edgeId)) return eds;
            return [
              ...eds,
              { id: edgeId, source: selectedNodeId, target: existingId },
            ];
          });
          const existingColor = existingNode?.color ?? "#ffffff";
          if (existingColor === "#ff99ff" || existingColor === "a#285294") {
            console.log("Existing node color:", existingColor);
            updateNodeColor("#ffff99", selectedNodeId);
            // 兄弟削除
            const siblings = [...node.children];
            console.log("Siblings to delete:", siblings);
            siblings.forEach((siblingId) => {
              if (siblingId !== existingId) {
                console.log("Deleting sibling node:", siblingId);
                deleteNode(siblingId);
              }
            });
            toggleChildren(selectedNodeId);
            breakpoint = true;
          }
        } else {
          addNode(
            selectedNodeId,
            newBoard,
            node.currentPlayer === "B" ? "W" : "B",
            idx,
            moves.length,
            color
          );
        }
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

  const hideyellow = () => {
    setNodesMap((prev) => {
      const updated = { ...prev };
      Object.values(updated).forEach((n) => {
        if (
          n.color === "#ffff99" ||
          n.color === "#285294" ||
          n.color === "#ff99ff"
        ) {
          n.hidden = true;
        }
      });
      return updated;
    });

    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        hidden: nodesMap[n.id]?.hidden || false,
      }))
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

  const showGreen = () => {
    setNodesMap((prev) => {
      const updated = { ...prev };
      Object.values(updated).forEach((n) => {
        if (n.color !== "#99ff99" && n.color !== "#11c101ff") {
          n.hidden = true;
        } else {
          n.hidden = false;
        }
      });
      return updated;
    });
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        hidden: nodesMap[n.id]?.hidden || false,
      }))
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
    addEdge,
    deleteNode,
    hideNode,
    handleNodesDelete,
    updateNodeColor,
    toggleChildren,
    addLegalMovesFromApi,
    onNodesChange,
    hideyellow,
    deleteChildren,
    showGreen,
    saveGraph,
  };
};
