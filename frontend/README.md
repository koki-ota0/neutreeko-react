# Frontend (React + TypeScript + ReactFlow)

See the [root README](../README.md) for full setup, environment variables, API
contract, data formats, deployment and architecture.

## Commands

```bash
npm ci                  # reproducible install from the lockfile
npm start               # dev server on http://localhost:3000
npm run typecheck       # tsc --noEmit
npm run lint            # ESLint
npm run test:ci         # Jest, non-interactive
CI=true npm run build   # production bundle in build/
```

The backend must be running separately (`uvicorn backend.api:app --reload`
from the repo root) and reachable at `REACT_APP_API_URL`.

## Local configuration

`REACT_APP_API_URL` is read at **build time**. For local overrides use
`frontend/.env.development.local` (gitignored); for production set it in the
hosting dashboard. Copy `frontend/.env.example` as a starting point.

## Layout

```
src/
  components/            GraphContainer, NodePanel, BoardNode (labelled status chrome), board renderers
  constants/             color semantics and game constants
  game/moves.ts          pure board/move helpers (tested)
  game/exploration.ts    minimax rules + DAG-safe pruning (tested)
  hooks/useGraphLogic.ts graph state + API calls (tested)
  types/                 shared TypeScript types
```

Tests live next to the code as `*.test.ts(x)`. Run `npm run test:ci` before
opening a PR.
