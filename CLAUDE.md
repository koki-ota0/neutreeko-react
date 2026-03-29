# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a game tree visualization and analysis tool for two abstract strategy board games: **Neutreeko** (5x5) and **Pyrga** (4x4). The application allows exploring and building game trees with legal moves computed by the backend.

## Development Commands

### Frontend (React + TypeScript)
```bash
cd frontend
npm start          # Start dev server at http://localhost:3000
npm run build      # Production build
npm test           # Run tests
```

### Backend (FastAPI + Python)
```bash
cd backend
uvicorn api:app --reload  # Start API server at http://127.0.0.1:8000
```

Both servers must run simultaneously for the app to function.

## Architecture

### State Management
The application uses a dual-state architecture in `useGraphLogic.ts`:
- **ReactFlow state** (`nodes`, `edges`): Visual graph with positions for rendering
- **nodesMap**: Internal game tree data indexed by node ID, stores board state, player, parent/child relationships, and colors

Key operations sync both states: position changes update `nodesMap`, game state changes update ReactFlow nodes.

### Frontend (`frontend/src/`)
- **App.tsx**: Root component with game type selector (neutreeko/pyrga)
- **components/GraphContainer.tsx**: Main container using ReactFlow for graph visualization
- **components/NodePanel.tsx**: Side panel for node operations (add moves, delete, color coding)
- **components/board/**: Game board renderers
  - `NeutreekoBoard.tsx`: 5x5 grid, B/W pieces
  - `PyrgaBoard.tsx`: 4x4 grid with stacking pieces (S/T/C types)
- **hooks/useGraphLogic.ts**: Core state management for graph, API communication, and tree operations
- **types/**: TypeScript interfaces (`MyNodeData`, `PyrgaPiece`)

### Backend (`backend/`)
- **api.py**: FastAPI server with endpoints:
  - `GET /load_graph?game_type=` - Load saved graph from JSON
  - `POST /save_graph?game_type=` - Persist graph state
  - `POST /legal_moves/neutreeko` - Compute legal moves for Neutreeko (filters out moves that would allow opponent immediate win)
  - `POST /legal_moves/pyrga` - Compute legal moves for Pyrga (placement rules based on last piece type: S=adjacent, T=line, C=same cell)

### Data Flow
1. Graph state is loaded from `backend/data/{game_type}_graph.json` on startup
2. `nodesMap` stores game state (board, player, children) keyed by node ID
3. `nodeIndex` provides fast lookup by board+player key to detect transpositions
4. ReactFlow `nodes`/`edges` arrays handle visual positioning
5. Legal moves are fetched from backend and create child nodes in the tree

### Node Color Coding
Colors indicate node analysis status:
- `#ffffff` (white): Unanalyzed
- `#285294` (dark blue): Winning position
- `#ffff99` (yellow): Must not choose (opponent wins)
- `#ff99ff` (pink): No legal moves
- `#99ff99` / `#11c101ff` (green): Currently playing / played

### Game Rules
- **Neutreeko**: Pieces slide in 8 directions until blocked. Win by aligning 3 pieces.
- **Pyrga**: Place S/T/C pieces with movement constraints based on opponent's last piece type. Max 3 pieces per cell, no duplicate types.
