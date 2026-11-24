# Neutreeko / Pyrga Game Tree Explorer

Build and analyse game trees for two abstract strategy games:

- **Neutreeko** — 5×5, three pieces per player. A piece slides in any of 8
  directions until blocked; three in a row wins.
- **Pyrga** — 4×4, pieces are *placed* (S / T / C). The previously placed
  piece decides where the next one may go (S = adjacent, T = along an 8-way
  line, C = the same cell). A cell holds at most three pieces, one of each type.

React + TypeScript frontend (ReactFlow canvas) and a FastAPI backend that
generates legal moves and persists the graph.

---

## Quick start

Two processes are required.

```bash
# Terminal 1 — backend (Python 3.11)
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements-dev.txt
uvicorn backend.api:app --reload --host 0.0.0.0 --port 8000

# Terminal 2 — frontend
cd frontend
npm ci
npm start                 # http://localhost:3000
```

`uvicorn` must be started from the repository root (the `backend.api` module
path). `cd backend && uvicorn api:app --reload` also works — both import styles
are supported, and data paths are anchored to `backend/data/` either way.

In development `REACT_APP_API_URL` is empty on purpose: the CRA dev server's
`proxy` setting forwards same-origin `/load_graph`, `/save_graph` and
`/legal_moves/*` requests to port 8000. That avoids CORS entirely and lets the
app work in hosted preview environments too. Production uses the absolute URL
from `REACT_APP_API_URL`.

Open <http://localhost:3000>, pick a game, select the root node and click
**Add legal moves**. Click **Save graph** to persist changes.

### Environment variables

| Where | Variable | Purpose |
| --- | --- | --- |
| frontend | `REACT_APP_API_URL` | Backend base URL. **Baked in at build time** — changing it requires a rebuild. See `frontend/.env.example`. |
| frontend | `REACT_APP_STATIC_DATA` | `1` builds the self-contained GitHub Pages viewer (bundled graph JSON + browser-side move rules); unset uses the API. |
| frontend | `REACT_APP_API_TOKEN` | Sent as `X-API-Token` when the backend requires a write token. |
| backend | `ALLOWED_ORIGINS` | Comma-separated browser origins for CORS. Defaults to localhost:3000; **must include the deployed Vercel origin** or the browser will block every request. |
| backend | `API_TOKEN` | When set, `POST /save_graph` requires header `X-API-Token`. Leave unset for local dev. |
| backend | `REDIS_URL` | When set, graphs live in Redis instead of `backend/data/*.json`. |
| backend | `MAX_GRAPH_BYTES` | Persisted graph size cap (default 32 MiB). |

Copy `backend/.env.example` / `frontend/.env.example` and configure the values
in your shell or hosting dashboard; never commit real tokens.

> `frontend/.env.production` contains an intentionally invalid placeholder.
> If you deploy without overriding `REACT_APP_API_URL`, the app shows a visible
> error instead of silently rendering an empty canvas.

---

## Tests and checks

```bash
# Backend
pytest backend                      # or: cd backend && pytest

# Frontend
cd frontend
npm run typecheck                   # tsc --noEmit
npm run lint                        # ESLint
npm run test:ci                     # Jest, non-interactive
CI=true npm run build               # production bundle
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push/PR.

---

## API

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness + storage backend (`file` or `redis`). |
| `GET` | `/load_graph?game_type=neutreeko\|pyrga` | Loads and normalizes the saved graph. Unknown game types → 422. |
| `POST` | `/save_graph?game_type=...` | Validated `GraphData` body, atomic write. Requires `X-API-Token` when `API_TOKEN` is set. |
| `POST` | `/legal_moves/neutreeko` | `{board: 5x5, player}` → **all** legal moves plus analysis. |
| `POST` | `/legal_moves/pyrga` | `{board: 4x4, player, last_move}` → legal placements. |

Both move endpoints return:

```json
{
  "moves": [[1, 2, 2, 2]],
  "winning_moves": [],
  "unsafe_moves": [],
  "game_over": false,
  "winner": null
}
```

- `moves` is the **complete** legal move list. The old implementation silently
  removed moves that let the opponent win; pruning is now explicit. **Mark risky
  moves** adds structured `moveNote` annotations from `unsafe_moves`, while
  **Apply exploration rules** performs the deterministic minimax pruning below.
- `game_over` / `winner` describe decided positions (three in a row).
- Move encoding differs per game: Neutreeko `[fromRow, fromCol, toRow, toCol]`,
  Pyrga `[row, col, pieceIndex]` where `0=S, 1=T, 2=C`.
- Pyrga `last_move` is `[row, col, {"type": ..., "player": ...}]` or `null`
  for the first move. It is stored per node and affects legal replies.
- Invalid boards / players / game types return **422**, not 500 or a 200 with
  an `{"error": ...}` body.

Interactive API docs: <http://127.0.0.1:8000/docs>.

---

## Data formats and storage

`backend/data/{game_type}_graph.json` holds `{nodes, edges, nodesMap,
selectedNodeId}`:

- `nodes` — ReactFlow display nodes (id + position only; board `data` is
  rehydrated from `nodesMap` on load).
- `edges` — `{id, source, target, hidden}`.
- `nodesMap` — game tree keyed by node id. Each node has `board`,
  `currentPlayer`, `parentId`, `children`, `color`, `hidden`,
  `hiddenChildren`, `move`, `moveNote`, `outcome`, plus `lastMove` / `winner` /
  `gameOver` / `analysis` where applicable. `moveNote` is a structured note on
  an incoming move; `outcome` is the persisted minimax value
  (`win` / `loss` / `unknown`) viewed from `currentPlayer`'s perspective.

Canonical board shapes:

- Neutreeko: `string[5][5]` with `"."`, `"B"`, `"W"`.
- Pyrga: `PyrgaPiece[4][4][]` — every cell is a list of 0–3 pieces
  `{type, player}`. Legacy shapes (`"."`, `{}`, `[{}]`, `null`) are normalized
  on load, so older saved graphs still work.

Writes are atomic (temp file + `os.replace`), validated and size-limited.
`POST /save_graph` is unauthenticated by default — set `API_TOKEN` before
exposing the backend publicly.

> `backend/data/neutreeko_graph.json` is ~8 MB / ~8,000 nodes of generated
> analysis data. Treat it as data, not source; back it up separately before
> large edits. `backend/data/pyrga_graph.json` was migrated to the canonical
> empty starting board because its previous contents used an invalid shape.

---

## Node color semantics

Defined once in `frontend/src/constants/colors.ts`. There are **three logical
categories**, kept in separate constants so hide/skip decisions never mix them.
The panel shows two swatch groups because the old move-note colour is now an
alias of the automatic `losing` evaluation colour.

### A. Position evaluation — automatic (`POSITION_COLORS`)

Describes the position itself, from the node's `currentPlayer` perspective.
Only the analyser assigns these.

| Color | Meaning | Attached to |
| --- | --- | --- |
| `#ffffff` | Unanalyzed | any node |
| `#0f766e` | **Certain win**: this side can force a win (exploration rule 1 / 3) | the evaluated position |
| `#ffff99` | **Losing**: the opponent can force a win (rule 2) | the evaluated position |
| `#285294` | **Decided**: three in a row already on the board; the player who just moved won | the **child** (reached terminal position) — never the parent |
| `#ff99ff` | No moves: no legal moves and no winner | the node with zero moves |
| `#ffcc99` | Loop / transposition: this position was reached before | the re-reached node |

`MOVE_NOTE_COLORS.mustNotChoose` is retained as a compatibility alias of
`POSITION_COLORS.losing`. It no longer means a merely risky branch.

### B. Move notes — structured (`moveNote`)

Risky incoming moves are stored as `moveNote: "mustNotChoose"` on the **child**
(dashed outline / ⚠ in the canvas). **Mark risky moves** adds these notes and
does **not** claim a minimax result, so it never paints the parent yellow.
The parent turns yellow only when rule 2 proves it is losing.

### C. Work memos — manual only (`MEMO_COLORS`)

Never assigned automatically. `#cccccc` root, `#99ff99` playing, `#11c101ff`
played, `#ff9999` avoid, `#9999ff` almost winning. **Show play line only**
filters on `playing` / `played`.

### Consequences

- `SKIP_REEXPANSION_COLORS` = decided/noMoves/loop positions + evaluated
  certain-win/losing positions. Manual memos do not block re-expansion.
- **Hide resolved positions** is a one-way hide: it sets `hidden: true` on
  `winning` / `noMoves` / `loop` **and** `certainWin` / `losing` nodes only.
  Already hidden nodes — including Unanalyzed and manual memos — are **not**
  un-hidden. Nodes stay in the graph and remain reusable for transpositions and
  future exploration. **Show all nodes** is a separate action that clears every
  `hidden` / `hiddenChildren` flag; the panel shows `Visible: X / Y nodes`.
- Old behaviour that put `#285294` on the parent, `#ffff99` on the child, or
  treated a risky-move note as a proven loss has been removed. Regression tests
  cover the categories and the exploration rules.

### Readable node chrome (not colour-only)

The board cells are **always** drawn on a neutral white / slate surface; a
status colour is never used as the background of the pieces. Instead each node
carries several redundant cues:

| Cue | Where |
| --- | --- |
| Full label + description | `NodePanel` status card, `BoardNode` tooltip / `aria-label` |
| Text icon (`✓`, `×`, `◆`, `↻`, …) and short code (`WIN`, `LOSS`, `3ROW`, …) | `BoardNode` header, `NodePanel` status card and swatch buttons |
| 8 px accent bar + distinct border style (`solid` / `double` / `dashed` / `dotted`) | `BoardNode` outer frame |
| Subtle pattern on the surrounding chrome only | `BoardNode` / `NodePanel` card |
| Explicit `OUTCOME: WIN` / `OUTCOME: LOSS` row | evaluated nodes |
| `⚠ MUST NOT CHOOSE` row | structured incoming-move notes |

`getStatusMeta()` in `frontend/src/constants/colors.ts` is the single source for
these labels; `readableTextOn()` guarantees readable chip text on both dark and
light colours. The `NodePanel` swatches are labelled buttons rather than bare
colour squares. Tests cover every status, the neutral board surface, and the
fallback for an unrecognized persisted colour.

---

## Exploration rules and the applied migration

The three requested rules operate on a persisted `outcome` field, always viewed
from the node's `currentPlayer`:

1. **A node with an immediate winning move is `win`.** Choose only those moves;
   other still-unknown branches need no exploration and are removed.
2. **A node with any `win` child is `loss`.** The opponent can force a win from
   there; remove the remaining unknown branches.
3. **A node whose children are all `loss` is `win`** and is recorded.

Decided `win` / `loss` children are **never removed**: they remain reusable for
transpositions and later exploration. Only unknown branches are pruned, and a
shared DAG node survives if another parent still references it.

- Live frontend behaviour: `frontend/src/game/exploration.ts` is the pure rule
  engine. `useGraphLogic` applies it after every expansion and from the
  **Apply exploration rules** button. It writes `outcome` plus the new colours,
  and shows ✓ / × badges on evaluated nodes.
- One-time backend migration: `backend/exploration.py` is a colour-independent
  CLI that seeds outcomes, evaluates all boards in postorder, reconstructs
  missing `move` fields, prunes doomed unknown nodes, and atomically saves.

```bash
python -m backend.exploration --dry-run    # no writes
python -m backend.exploration --apply      # writes .bak, then the graph
```

The agreed seed mapping was old `#285294 = win`, `#ffff99 = loss`,
`#ff99ff = loss`. New results use `#0f766e` for certain wins and `#ffff99` for
losses; `#285294` remains reserved for decided boards. `--no-seed` and
`--no-recolor` are available for board-only evaluation or colour-free output.

`backend/data/neutreeko_graph.json` has already been migrated **in place**, with
a gitignored backup at `backend/data/neutreeko_graph.json.bak`:

| Before | After |
| --- | --- |
| 7,992 nodes / 8,360 edges | 7,881 nodes / 8,231 edges |
| no `outcome` / `analysis` / `move` | 292 `win`, 2,875 `loss`, 4,714 `unknown`; analysis and moves persisted |
| old marker colours | 292 `#0f766e`, 2,875 `#ffff99`; 0 nodes retain `#285294` / `#ff99ff` |

111 unknown nodes were pruned, 8 decided children were kept, and there were 0
unrecoverable moves / dangling edges. A second dry-run on the migrated graph
removes 0 more nodes (idempotent). Save the `.bak` outside the working tree if
you need a long-term restore point: `.gitignore` excludes `backend/data/*.bak`.

---

## Architecture notes

- `backend/rules.py` — pure rule functions (no I/O), fully unit tested.
- `backend/schemas.py` — one definition per Pydantic model; validation lives here.
- `backend/storage.py` — file/Redis persistence, atomic writes, normalization.
- `backend/exploration.py` — colour-independent minimax pruning + migration CLI.
- `backend/api.py` — FastAPI wiring, CORS, optional write auth.
- `frontend/src/constants/colors.ts` — single source of truth for colour semantics.
- `frontend/src/game/moves.ts` — pure board/move helpers (unit tested).
- `frontend/src/game/rules.ts` — browser port of the backend legal-move rules
  for the static Pages build (unit tested).
- `frontend/src/game/staticMode.ts` — Pages asset URLs and static-mode flag.
- `frontend/scripts/build-pages.mjs` — bundles graph snapshots and builds with
  the correct `PUBLIC_URL` / static-mode environment.
- `frontend/src/game/exploration.ts` — pure exploration rules + DAG-safe pruning.
- `frontend/src/hooks/useGraphLogic.ts` — graph state. All writes go through a
  ref-backed `commit` helper so async expansions never read stale snapshots.
- `frontend/src/components/BoardNode.tsx` — ReactFlow custom node; boards live
  in node `data`, status is spelled out in labelled chrome, and the board
  surface stays neutral so dragging never rebuilds every node.
- `frontend/src/components/GraphContainer.tsx` / `NodePanel.tsx` — canvas,
  readable status card and labelled swatch buttons.

Positions live only in ReactFlow state; `nodesMap` is the game-tree source of
truth. Game-type switching remounts `GraphContainer` (`key={gameType}`), which
gives each game a fresh state and cancels the previous in-flight load.

`npm ci` requires the checked-in lockfile. `package.json` pins
`@types/d3-dispatch` to 3.0.6 via `overrides` because 3.0.7 uses TypeScript 5
syntax that CRA 5's TypeScript 4.9 cannot parse.

---

## Deployment

- GitHub Pages: <https://kokilux.github.io/neutreeko-react/>.
  `.github/workflows/pages.yml` builds on every push to `main` with
  `frontend/scripts/build-pages.mjs` and deploys via `actions/deploy-pages`.
  `npm run build:pages` copies `backend/data/*_graph.json` into
  `frontend/public/data/` (minified, gitignored), sets `PUBLIC_URL` to the
  repository subpath and `REACT_APP_STATIC_DATA=1`. Pages has no FastAPI
  process: legal moves are computed by `frontend/src/game/rules.ts`, and
  **Download graph JSON** exports edits from the browser tab. The bundled
  snapshot is read-only; the Vercel/API deployment remains the writable one.
- Frontend: Vercel (`vercel.json`). It runs `npm ci --include=dev`,
  `npm run typecheck` and `npm run build`. Set `REACT_APP_API_URL` (and
  `REACT_APP_API_TOKEN` if used) as Vercel environment variables.
- Backend: any Python host (`backend/Procfile` runs
  `uvicorn backend.api:app --host 0.0.0.0 --port $PORT`). Set
  `ALLOWED_ORIGINS` to the exact Vercel origin, plus `REDIS_URL` for durable
  storage — ephemeral filesystems lose `backend/data/*.json` on restart.
- Set `API_TOKEN` on the backend and the matching `REACT_APP_API_TOKEN` on the
  frontend so `/save_graph` is not publicly writable.

### Repository owner / Git identity

The GitHub account was renamed from `koki-ota0` to **`kokilux`** (same account
id `85487709`). The canonical repository is `kokilux/neutreeko-react` and the
Pages URL is `https://kokilux.github.io/neutreeko-react/`. Old URLs redirect,
but keep local clones in sync:

```bash
git config user.name kokilux
git config user.email 85487709+kokilux@users.noreply.github.com
git remote set-url origin https://github.com/kokilux/neutreeko-react.git
```

Use `kokilux/neutreeko-react` for `gh` commands. Past commits intentionally
keep their original author string: rewriting already-merged history would need
a force-push and would break the PR/merge trail.
