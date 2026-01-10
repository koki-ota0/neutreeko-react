export interface MyNodeData {
  id: string;
  board: string[][];
  currentPlayer: string;
  parentId?: string;
  children: string[];
  position?: { x: number; y: number };
  color?: string;
  hidden?: boolean;
  hiddenChildren?: boolean;
}
