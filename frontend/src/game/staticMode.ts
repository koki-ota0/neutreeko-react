import { GameType } from "../types/MyNodeData";

/**
 * GitHub Pages has no FastAPI process. `REACT_APP_STATIC_DATA=1` builds a
 * self-contained viewer: graphs are bundled JSON and move rules run in the
 * browser. The default API-backed build is unchanged.
 */
export const STATIC_MODE = process.env.REACT_APP_STATIC_DATA === "1";

/** Join a public asset path to CRA's PUBLIC_URL (project Pages use a prefix). */
export const publicAssetUrl = (
  path: string,
  publicUrl: string = process.env.PUBLIC_URL || "",
): string => `${publicUrl}/${path.replace(/^\/+/, "")}`;

export const staticGraphUrl = (gameType: GameType): string =>
  publicAssetUrl(`data/${gameType}_graph.json`);
