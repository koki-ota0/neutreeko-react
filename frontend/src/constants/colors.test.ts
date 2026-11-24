import {
  COLOR_SWATCH_GROUPS,
  DECISIVE_OR_EVALUATED_COLORS,
  DECISIVE_POSITION_COLORS,
  EVALUATED_POSITION_COLORS,
  getStatusMeta,
  HIDE_RESOLVED_COLORS,
  MEMO_COLORS,
  MOVE_NOTE_COLORS,
  NODE_COLORS,
  NODE_STATUS_META,
  OUTCOME_COLORS,
  PLAY_MEMO_COLORS,
  POSITION_COLORS,
  readableTextOn,
  RESOLVED_POSITION_COLORS,
  SKIP_REEXPANSION_COLORS,
} from "./colors";

describe("color semantics", () => {
  it("keeps position colours and manual memos disjoint", () => {
    const position = Object.values(POSITION_COLORS);
    const memo = Object.values(MEMO_COLORS);
    expect(position.some((color) => memo.includes(color as never))).toBe(false);
  });

  it("uses a new colour for a certain win and keeps #285294 for decided boards", () => {
    expect(POSITION_COLORS.certainWin).not.toBe(POSITION_COLORS.winning);
    expect(POSITION_COLORS.winning).toBe("#285294");
    expect(Object.values(MEMO_COLORS)).not.toContain(POSITION_COLORS.certainWin);
    expect(NODE_COLORS.winning).toBe("#285294");
    expect(NODE_COLORS.certainWin).toBe(POSITION_COLORS.certainWin);
  });

  it("aliases the move-note colour to the losing position colour", () => {
    expect(MOVE_NOTE_COLORS.mustNotChoose).toBe(POSITION_COLORS.losing);
    expect(POSITION_COLORS.losing).toBe("#ffff99");
  });

  it("maps outcomes to the new evaluation colours", () => {
    expect(OUTCOME_COLORS.win).toBe(POSITION_COLORS.certainWin);
    expect(OUTCOME_COLORS.loss).toBe(POSITION_COLORS.losing);
  });

  it("exposes every color in exactly one swatch group", () => {
    const grouped = COLOR_SWATCH_GROUPS.flatMap((group) =>
      group.swatches.map((swatch) => swatch.color),
    );
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(Object.values(NODE_COLORS)));
    expect(COLOR_SWATCH_GROUPS.map((group) => group.swatches.length)).toEqual([
      6, 5,
    ]);
  });

  it("treats decided/noMoves as decisive and loop as resolved only", () => {
    expect(DECISIVE_POSITION_COLORS).toEqual([
      POSITION_COLORS.winning,
      POSITION_COLORS.noMoves,
    ]);
    expect(RESOLVED_POSITION_COLORS).toContain(POSITION_COLORS.loop);
    expect(RESOLVED_POSITION_COLORS).not.toContain(POSITION_COLORS.losing);
  });

  it("hides exploration results with Hide resolved, but keeps them reusable", () => {
    expect(EVALUATED_POSITION_COLORS).toEqual([
      POSITION_COLORS.certainWin,
      POSITION_COLORS.losing,
    ]);
    expect(HIDE_RESOLVED_COLORS).toEqual([
      ...RESOLVED_POSITION_COLORS,
      ...EVALUATED_POSITION_COLORS,
    ]);
    for (const color of RESOLVED_POSITION_COLORS) {
      expect(HIDE_RESOLVED_COLORS).toContain(color);
    }
    for (const color of EVALUATED_POSITION_COLORS) {
      expect(RESOLVED_POSITION_COLORS).not.toContain(color);
      expect(HIDE_RESOLVED_COLORS).toContain(color);
      expect(SKIP_REEXPANSION_COLORS).toContain(color);
    }
    for (const memo of Object.values(MEMO_COLORS)) {
      expect(HIDE_RESOLVED_COLORS).not.toContain(memo);
      expect(SKIP_REEXPANSION_COLORS).not.toContain(memo);
    }
  });

  it("resolves a parent on a transposition to a decided or evaluated node", () => {
    expect(DECISIVE_OR_EVALUATED_COLORS).toContain(POSITION_COLORS.certainWin);
    expect(DECISIVE_OR_EVALUATED_COLORS).toContain(POSITION_COLORS.losing);
    expect(DECISIVE_OR_EVALUATED_COLORS).not.toContain(POSITION_COLORS.loop);
  });

  it("filters the play line on manual memos only", () => {
    expect(PLAY_MEMO_COLORS).toEqual([
      MEMO_COLORS.playing,
      MEMO_COLORS.played,
    ]);
    expect(PLAY_MEMO_COLORS).not.toContain(POSITION_COLORS.certainWin);
  });

  it("gives every status a label, icon and unique short code", () => {
    const colors = Object.values(NODE_COLORS);
    const shortLabels = colors.map((color) => {
      const status = NODE_STATUS_META[color];
      expect(status).toBeDefined();
      expect(status.label).toBeTruthy();
      expect(status.icon).toBeTruthy();
      expect(status.shortLabel).toBeTruthy();
      expect(status.accent).toMatch(/^#/);
      expect(status.borderWidth).toBeGreaterThan(0);
      return status.shortLabel;
    });
    expect(new Set(shortLabels).size).toBe(colors.length);
  });

  it("chooses readable chip text for dark, light and 8-digit colours", () => {
    expect(readableTextOn(POSITION_COLORS.certainWin)).toBe("#ffffff");
    expect(readableTextOn(POSITION_COLORS.winning)).toBe("#ffffff");
    expect(readableTextOn(POSITION_COLORS.losing)).toBe("#111827");
    expect(readableTextOn(MEMO_COLORS.played)).toBe("#111827");
    expect(getStatusMeta(POSITION_COLORS.certainWin).chipText).toBe("#ffffff");
    expect(getStatusMeta(POSITION_COLORS.losing).chipText).toBe("#111827");
  });

  it("falls back to a labelled unknown status for a strange persisted colour", () => {
    const status = getStatusMeta("#123456");
    expect(status.color).toBe("#123456");
    expect(status.label).toBe("Unknown status");
    expect(status.icon).toBe("?");
  });
});
