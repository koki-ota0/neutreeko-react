import { ComponentType } from "react";
import { Node } from "react-flow-renderer";
import { MoveNote, NodeOutcome } from "../constants/colors";
import { GameBoard } from "./MyNodeData";

/**
 * Board renderers accept the union and narrow internally. Status colour is
 * deliberately NOT passed here: the pieces always sit on a neutral surface and
 * the node chrome shows the status with a label / icon / border / pattern.
 */
export interface BoardRenderProps {
  board: GameBoard;
}

export type BoardRenderer = ComponentType<BoardRenderProps>;

export interface BoardNodeData {
  board: GameBoard;
  color: string;
  moveNote?: MoveNote;
  outcome?: NodeOutcome;
  Board: BoardRenderer;
}

export type FlowNode = Node<BoardNodeData>;
