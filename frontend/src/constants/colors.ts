/**
 * Node colors are split into categories with *different* meanings.
 *
 * A. POSITION_COLORS - evaluation / state of the position, viewed from its
 *    `currentPlayer`. Assigned only by the analyser. Includes the exploration
 *    results `certainWin` (this side can force a win) and `losing` (the
 *    opponent can). `winning` stays reserved for a DECIDED board (three in a
 *    row already on the board: the player who just moved won).
 * B. Move notes - NOT a colour: stored as the structured `moveNote` field on
 *    the child. A risky-move note never changes the parent's colour; yellow
 *    is reserved for a proven `losing` evaluation result.
 * C. MEMO_COLORS - manual work notes. Never assigned automatically.
 *
 * The board cells themselves are always drawn on a neutral surface. Status is
 * communicated by the node chrome (labelled chip, icon, short code, coloured
 * bar, border style and subtle pattern), never by dyeing the pieces' grid.
 */

// A. Position evaluation (automatic)
export const POSITION_COLORS = {
  unanalyzed: "#ffffff",
  /** Exploration result: this side can force a win. */
  certainWin: "#0f766e",
  /** Exploration result: this side is lost (the opponent can force a win). */
  losing: "#ffff99",
  /** Decided board: three in a row; the player who just moved won. */
  winning: "#285294",
  /** No legal moves and no winner. */
  noMoves: "#ff99ff",
  /** Transposition: this position was reached before. */
  loop: "#ffcc99",
} as const;

/**
 * Compatibility alias for older callers. `losing` is a position evaluation;
 * move notes live in `moveNote` on the child and do not imply a loss.
 */
export const MOVE_NOTE_COLORS = {
  mustNotChoose: POSITION_COLORS.losing,
} as const;

// C. Manual memos (never set automatically)
export const MEMO_COLORS = {
  root: "#cccccc",
  playing: "#99ff99",
  played: "#11c101ff",
  avoid: "#ff9999",
  almostWinning: "#9999ff",
} as const;

/** Flat lookup kept for the panel and for persisted `color` values. */
export const NODE_COLORS = {
  ...POSITION_COLORS,
  ...MEMO_COLORS,
} as const;

export type PositionColor = (typeof POSITION_COLORS)[keyof typeof POSITION_COLORS];
export type MoveNoteColor = (typeof MOVE_NOTE_COLORS)[keyof typeof MOVE_NOTE_COLORS];
export type MemoColor = (typeof MEMO_COLORS)[keyof typeof MEMO_COLORS];
export type NodeColor = (typeof NODE_COLORS)[keyof typeof NODE_COLORS];

/** Structured note stored on a child: which incoming move is flagged. */
export type MoveNote = "mustNotChoose" | null;

/** Persisted exploration result, always from the node's currentPlayer view. */
export type NodeOutcome = "win" | "loss" | "unknown" | null;

export const OUTCOME_COLORS: Record<"win" | "loss", string> = {
  win: POSITION_COLORS.certainWin,
  loss: POSITION_COLORS.losing,
};

/** Decided boards and exhausted boards. */
export const DECISIVE_POSITION_COLORS: string[] = [
  POSITION_COLORS.winning,
  POSITION_COLORS.noMoves,
];
/** Terminal / loop states that were already resolved before evaluation. */
export const RESOLVED_POSITION_COLORS: string[] = [
  ...DECISIVE_POSITION_COLORS,
  POSITION_COLORS.loop,
];

/** Results of the three exploration rules. Hidden by "Hide resolved" on
 *  request, but kept in the graph as reusable evidence and never re-expanded. */
export const EVALUATED_POSITION_COLORS: string[] = [
  POSITION_COLORS.certainWin,
  POSITION_COLORS.losing,
];

/** "Hide resolved positions" hides terminal/loop states AND evaluated wins /
 *  losses. Hiding is not deletion: decided nodes remain reusable. */
export const HIDE_RESOLVED_COLORS: string[] = [
  ...RESOLVED_POSITION_COLORS,
  ...EVALUATED_POSITION_COLORS,
];

/** A transposition to one of these colours immediately resolves the parent. */
export const DECISIVE_OR_EVALUATED_COLORS: string[] = [
  ...DECISIVE_POSITION_COLORS,
  ...EVALUATED_POSITION_COLORS,
];

/** Same set as HIDE_RESOLVED_COLORS today; kept as a separate name because
 *  hiding a node and skipping its re-expansion are different operations. */
export const SKIP_REEXPANSION_COLORS: string[] = [...HIDE_RESOLVED_COLORS];

/** "Show play line only" filters on manual memos. */
export const PLAY_MEMO_COLORS: string[] = [
  MEMO_COLORS.playing,
  MEMO_COLORS.played,
];

/**
 * WCAG-ish contrast helper. Handles 6- and 8-digit hex (the legacy `played`
 * memo colour is 8-digit). Light chips get dark text; dark chips get white.
 */
export const readableTextOn = (hex: string): string => {
  const value = hex.replace("#", "");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) return "#111827";
  const channel = (start: number): number => {
    const raw = parseInt(value.slice(start, start + 2), 16) / 255;
    return raw <= 0.04045 ? raw / 12.92 : Math.pow((raw + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.35 ? "#111827" : "#ffffff";
};

export type StatusCategory = "position" | "memo";
export type StatusBorderStyle = "solid" | "double" | "dashed" | "dotted";

/** Everything needed to render a status without relying on colour alone. */
export interface NodeStatusMeta {
  color: string;
  label: string;
  /** Compact code shown on the node, e.g. WIN / LOSS / 3ROW. */
  shortLabel: string;
  /** Text icon (not an emoji) so it renders consistently. */
  icon: string;
  description: string;
  category: StatusCategory;
  /** Visible border / bar colour; darker than very light chip colours. */
  accent: string;
  chipBg: string;
  chipText: string;
  borderStyle: StatusBorderStyle;
  borderWidth: number;
  /** Applied only to the node chrome, never to the board cells. */
  pattern: string;
}

const stripe = (
  rgb: string,
  angle: number,
  width: number,
  gap: number,
  alpha = 0.14,
): string =>
  `repeating-linear-gradient(${angle}deg, rgba(${rgb}, ${alpha}) 0 ${width}px, ` +
  `rgba(255, 255, 255, 0) ${width}px ${gap}px)`;

const meta = (
  value: Omit<NodeStatusMeta, "chipText">,
): NodeStatusMeta => ({
  ...value,
  chipText: readableTextOn(value.chipBg),
});

const POSITION_STATUS: NodeStatusMeta[] = [
  meta({
    color: POSITION_COLORS.unanalyzed,
    label: "Unanalyzed",
    shortLabel: "?",
    icon: "○",
    description: "No analysis yet",
    category: "position",
    accent: "#9ca3af",
    chipBg: "#f3f4f6",
    borderStyle: "solid",
    borderWidth: 2,
    pattern: "none",
  }),
  meta({
    color: POSITION_COLORS.certainWin,
    label: "Certain win",
    shortLabel: "WIN",
    icon: "✓",
    description: "This side can force a win (rule 1 / 3)",
    category: "position",
    accent: "#0f766e",
    chipBg: "#0f766e",
    borderStyle: "double",
    borderWidth: 3,
    pattern: stripe("15, 118, 110", 135, 6, 12, 0.18),
  }),
  meta({
    color: POSITION_COLORS.losing,
    label: "Losing",
    shortLabel: "LOSS",
    icon: "×",
    description: "Opponent can force a win (rule 2)",
    category: "position",
    accent: "#a16207",
    chipBg: "#ffff99",
    borderStyle: "dashed",
    borderWidth: 3,
    pattern: stripe("161, 98, 7", 45, 4, 9, 0.16),
  }),
  meta({
    color: POSITION_COLORS.winning,
    label: "Decided",
    shortLabel: "3ROW",
    icon: "◆",
    description: "Three in a row on the board: the player who just moved won",
    category: "position",
    accent: "#285294",
    chipBg: "#285294",
    borderStyle: "solid",
    borderWidth: 3,
    pattern: stripe("40, 82, 148", 90, 5, 10, 0.18),
  }),
  meta({
    color: POSITION_COLORS.noMoves,
    label: "No moves",
    shortLabel: "∅",
    icon: "∅",
    description: "No legal moves, no winner",
    category: "position",
    accent: "#a21caf",
    chipBg: "#ff99ff",
    borderStyle: "dotted",
    borderWidth: 3,
    pattern: stripe("162, 28, 175", 0, 3, 8, 0.14),
  }),
  meta({
    color: POSITION_COLORS.loop,
    label: "Loop",
    shortLabel: "↻",
    icon: "↻",
    description: "Transposition / position reached before",
    category: "position",
    accent: "#b45309",
    chipBg: "#ffcc99",
    borderStyle: "dashed",
    borderWidth: 2,
    pattern: stripe("180, 83, 9", 45, 5, 10, 0.14),
  }),
];

const MEMO_STATUS: NodeStatusMeta[] = [
  meta({
    color: MEMO_COLORS.root,
    label: "Root",
    shortLabel: "R",
    icon: "●",
    description: "Starting position marker",
    category: "memo",
    accent: "#6b7280",
    chipBg: "#cccccc",
    borderStyle: "solid",
    borderWidth: 2,
    pattern: "none",
  }),
  meta({
    color: MEMO_COLORS.playing,
    label: "Playing",
    shortLabel: "▶",
    icon: "▶",
    description: "Line currently being played",
    category: "memo",
    accent: "#15803d",
    chipBg: "#99ff99",
    borderStyle: "solid",
    borderWidth: 2,
    pattern: stripe("21, 128, 61", 135, 3, 9, 0.12),
  }),
  meta({
    color: MEMO_COLORS.played,
    label: "Played",
    shortLabel: "✔",
    icon: "✔",
    description: "Line already played",
    category: "memo",
    accent: "#15803d",
    chipBg: "#11c101ff",
    borderStyle: "double",
    borderWidth: 3,
    pattern: stripe("21, 128, 61", 45, 5, 10, 0.16),
  }),
  meta({
    color: MEMO_COLORS.avoid,
    label: "Avoid",
    shortLabel: "!",
    icon: "!",
    description: "Probably a bad move",
    category: "memo",
    accent: "#b91c1c",
    chipBg: "#ff9999",
    borderStyle: "dashed",
    borderWidth: 2,
    pattern: stripe("185, 28, 28", 135, 4, 9, 0.12),
  }),
  meta({
    color: MEMO_COLORS.almostWinning,
    label: "Almost winning",
    shortLabel: "~",
    icon: "~",
    description: "Mostly winning",
    category: "memo",
    accent: "#4338ca",
    chipBg: "#9999ff",
    borderStyle: "dotted",
    borderWidth: 2,
    pattern: stripe("67, 56, 202", 90, 4, 9, 0.12),
  }),
];

export const NODE_STATUS_META: Record<string, NodeStatusMeta> = {};
for (const entry of [...POSITION_STATUS, ...MEMO_STATUS]) {
  NODE_STATUS_META[entry.color] = entry;
}

const UNKNOWN_STATUS: NodeStatusMeta = meta({
  color: "#ffffff",
  label: "Unknown status",
  shortLabel: "?",
  icon: "?",
  description: "Unrecognized persisted status colour",
  category: "position",
  accent: "#6b7280",
  chipBg: "#f3f4f6",
  borderStyle: "solid",
  borderWidth: 2,
  pattern: "none",
});

export const getStatusMeta = (color: string): NodeStatusMeta =>
  NODE_STATUS_META[color] ?? { ...UNKNOWN_STATUS, color };

export interface ColorSwatch {
  color: string;
  label: string;
  description: string;
}

export interface ColorSwatchGroup {
  title: string;
  description: string;
  swatches: ColorSwatch[];
}

export const COLOR_SWATCH_GROUPS: ColorSwatchGroup[] = [
  {
    title: "Position (automatic)",
    description: "Evaluation of this position, from the current player's view.",
    swatches: POSITION_STATUS.map(({ color, label, description }) => ({
      color,
      label,
      description,
    })),
  },
  {
    title: "Work memo (manual)",
    description: "Your own notes. The app never assigns these automatically.",
    swatches: MEMO_STATUS.map(({ color, label, description }) => ({
      color,
      label,
      description,
    })),
  },
];
