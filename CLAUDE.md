# CLAUDE.md

Guidance for AI coding assistants working in this repository. See
[README.md](README.md) for the full setup / deployment guide.

## Project overview

A game-tree visualization and analysis tool for **Neutreeko** (5×5 sliding
pieces, three in a row wins) and **Pyrga** (4×4 placement game). A React +
TypeScript frontend renders the tree with ReactFlow; a FastAPI backend generates
legal moves and persists the graph.

## Development commands

```bash
# Backend (run from repo root)
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements-dev.txt
uvicorn backend.api:app --reload --host 0.0.0.0 --port 8000
pytest backend

# Frontend
cd frontend
npm ci
npm start
npm run typecheck
npm run test:ci
CI=true npm run build
```

Both servers must run at once. `REACT_APP_API_URL` (frontend) defaults to
`http://127.0.0.1:8000`; `ALLOWED_ORIGINS` (backend) must include the browser
origin. Optional shared secret: `API_TOKEN` / `REACT_APP_API_TOKEN`.

## Architecture

`backend/rules.py` holds pure, unit-tested rule functions; `schemas.py` holds
the single definition of each Pydantic model; `storage.py` handles atomic
file/Redis persistence and legacy normalization; `exploration.py` holds the
colour-independent minimax pruning engine / migration CLI; `api.py` is just
FastAPI wiring.

`frontend/src/game/moves.ts` holds pure board/move helpers and
`game/exploration.ts` holds the pure three-rule engine. `outcome` is always
viewed from that node's `currentPlayer`. Rule 1 has **highest priority**: a
parent with a three-in-a-row child (or a legal move that would create one) is
`loss` / `Losing`, and that decided child is NOT added during live expansion.
This deliberately beats rule 3 (all children `loss` → `win`), rule 2 and even an
already-persisted `win` outcome. The hook does not set `outcome` for this case:
`resolveExploration` is the single source of truth, so `ruleHits.rule1` counts
it. Rule 2 (`win` child → `loss`) and rule 3 are unchanged.
`backend/exploration.py` keeps the
original one-time migration semantics; it is intentionally not re-run against
the saved graph. The state hook (`hooks/useGraphLogic.ts`) keeps two
synchronized structures:

- **ReactFlow state** (`nodes`, `edges`): positions, visibility and node `data`.
- **nodesMap**: game tree keyed by node id (board, player, parent/children,
  color, lastMove, moveNote, outcome, analysis).

All state writes go through a ref-backed `commit` helper so async expansions
always read current values. Positions are *not* mirrored into `nodesMap` (that
used to re-render every node on each drag). `App.tsx` keys `GraphContainer` by
`gameType` so switching games remounts state and cancels in-flight loads.

### Board and move encodings (critical)

| | Neutreeko | Pyrga |
| --- | --- | --- |
| Board | `string[5][5]` (`"."`, `"B"`, `"W"`) | `PyrgaPiece[4][4][]`, each cell 0–3 pieces, one per type |
| Move | `[fromRow, fromCol, toRow, toCol]` | `[row, col, pieceIndex]`, `0=S, 1=T, 2=C` |
| Extra request field | — | `last_move: [row, col, piece]` or `null` for the first move |

`lastMove` is stored per Pyrga node because it determines the next placement
zone. Transposition keys include it for Pyrga. Do not share a single
move-application path across the two games.

### API

- `GET /health`
- `GET /load_graph?game_type=neutreeko|pyrga`
- `POST /save_graph?game_type=...` — validated `GraphData`, atomic write,
  optional `X-API-Token` auth.
- `POST /legal_moves/neutreeko`, `POST /legal_moves/pyrga` — both return
  `{moves, winning_moves, unsafe_moves, game_over, winner}`.

`moves` is the **complete** legal move list. Pruning is explicit: "Mark risky
moves" adds structured `moveNote` annotations from `unsafe_moves`, while
"Apply exploration rules" performs deterministic minimax pruning. Invalid input
returns 422, and decided positions set `game_over` / `winner`.

### Node color semantics (three logical categories)

Single source of truth: `frontend/src/constants/colors.ts`. Do **not** treat
these as one flat status list — they mean different things and are used by
different operations. The UI has two swatch groups because the old move-note
colour is now an alias of the automatic `losing` evaluation colour.

- **A. `POSITION_COLORS` (automatic, from `currentPlayer`'s perspective)**:
  `#ffffff` unanalyzed, `#0f766e` certain win (rules 1/3), `#ffff99` losing
  (rule 2), `#285294` decided board (child only), `#ff99ff` no moves,
  `#ffcc99` loop. `#285294` goes on the **child** decided terminal position,
  never on the parent that chose the move. A certain win is a *new* colour;
  the blue marker is not reused as a minimax result.
- **B. `moveNote` (structured note on the incoming move)**: dangerous/risky
  children carry `moveNote: "mustNotChoose"` and a `⚠ MUST NOT CHOOSE` row. The
  compatibility alias `MOVE_NOTE_COLORS.mustNotChoose` equals `losing`, but a
  risky move is **not** a proven loss. "Mark risky moves" must not paint the
  parent yellow.
- **C. `MEMO_COLORS` (manual work notes, never auto-assigned)**: `#cccccc`
  root, `#99ff99` playing, `#11c101ff` played, `#ff9999` avoid, `#9999ff`
  almost winning.

`HIDE_RESOLVED_COLORS` = decided/noMoves/loop positions + evaluated
certain-win/losing positions. `hideResolved` is **one-way**: it sets
`hidden: true` only on those nodes (including `#0f766e` certain wins and
`#ffff99` losses). It must NOT un-hide anything — already hidden Unanalyzed /
memo nodes stay hidden. Do not turn it into a view filter again. Hidden nodes
are not deleted and remain reusable. `showAllNodes` is the separate action that
clears every `hidden` / `hiddenChildren` flag, and the panel shows
`Visible: X / Y nodes` so a one-way hide is still measurable.
`SKIP_REEXPANSION_COLORS` is the same set today but is a separate name because
skipping re-expansion is a different operation. `showPlayLine` filters on green
manual memos. Never infer a minimax outcome from a colour alone: the persisted
`outcome` field is authoritative.

### Readability: never dye the board cells

`BoardRenderProps` has no `color` prop. `NeutreekoBoard` / `PyrgaBoard` always
use white / slate cells; the outer `BoardNode` carries the status. Do not
reintroduce a coloured board background. Status must stay readable without
colour perception:

- `getStatusMeta(color)` supplies `label`, `icon`, `shortLabel`, `accent`,
  `chipBg`, `chipText`, `borderStyle`, `borderWidth` and `pattern`.
- `BoardNode` renders a labelled chip, icon, short code, 8px accent bar,
  distinct border, subtle chrome-only pattern, and explicit `OUTCOME: WIN/LOSS`
  / `⚠ MUST NOT CHOOSE` rows.
- `NodePanel` uses the same metadata for its status card and labelled swatch
  buttons; `readableTextOn()` handles dark, light and 8-digit hex colours.
- `BoardNode.test.tsx` / `NodePanel.test.tsx` assert the neutral board surface
  and the text cues. Unknown persisted colours get a labelled fallback.

### Exploration rules and persisted migration

`outcome` is `win` / `loss` / `unknown` from the node's `currentPlayer` view.

1. Immediate winning move → `win`; choose that move and prune unknown siblings.
2. Any `win` child → `loss`; prune unknown siblings.
3. All children `loss` → `win`; record it.

Decided children are never removed (reuse for transpositions/future
exploration). Only unknown branches are pruned; shared DAG nodes survive if any
other parent still references them. `useGraphLogic` applies the rules after
expansion and from the explicit button; `BoardNode` shows ✓ / × outcome badges.

`backend/exploration.py` performed the one-time in-place migration of
`backend/data/neutreeko_graph.json`, seeding old `#285294=win`,
`#ffff99=loss`, `#ff99ff=loss`, then writing `outcome`, `analysis`, recovered
`move`, `#0f766e` certain wins and `#ffff99` losses. Result: 7,992 → 7,881
nodes, 8,360 → 8,231 edges, 292 wins / 2,875 losses / 4,714 unknowns, 111
unknown nodes removed, 8 decided children kept, 0 dangling edges. A
gitignored backup is at `backend/data/neutreeko_graph.json.bak`. Re-running
the CLI dry-run is idempotent (0 further prunes).

## GitHub Pages / static mode

`.github/workflows/pages.yml` deploys `main` to
<https://kokilux.github.io/neutreeko-react/> with `actions/deploy-pages`.
`npm run build:pages` runs `frontend/scripts/build-pages.mjs`: it minifies the
canonical graphs into gitignored `frontend/public/data/` and builds with
`PUBLIC_URL=/neutreeko-react`, `REACT_APP_STATIC_DATA=1`, and an empty
`REACT_APP_API_URL`. In static mode `useGraphLogic` loads the bundled graph,
`frontend/src/game/rules.ts` replaces `/legal_moves/*`, and `saveGraph`
downloads JSON instead of POSTing. Do not make the Pages build depend on
`127.0.0.1` or an external API; the Vercel/API build stays unchanged.

The GitHub owner is **`kokilux`** (renamed from `koki-ota0`, same id
`85487709`); use `--repo kokilux/neutreeko-react` / the `kokilux/...` URL for
`gh` and `origin`. Local identity is `kokilux
<85487709+kokilux@users.noreply.github.com>`. Do not rewrite already-merged
commit authors.

## Conventions / gotchas

- `npm ci` is required (the lockfile is checked in). `@types/d3-dispatch` is
  pinned to 3.0.6 via `overrides` because newer releases use TS 5 syntax that
  CRA 5's TypeScript 4.9 cannot parse.
- Don't commit `backend/data/*.tmp`, `backend/data/*.bak`, `__pycache__`,
  `.env*.local` files or generated `backend/tmp_data/`.
- `backend/data/neutreeko_graph.json` is ~10 MB of generated analysis data and
  now carries explicit `outcome` fields — avoid rewriting it casually. Use the
  CLI dry-run / backup before another migration.
- Game rules have unit tests in `backend/tests/` and
  `frontend/src/**/*.test.ts(x)`; add a regression test when changing rules or
  move encodings.
