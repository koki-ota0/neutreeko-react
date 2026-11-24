#!/usr/bin/env node
/**
 * Build a self-contained GitHub Pages bundle.
 *
 * 1. Copy the canonical graphs from backend/data into public/data as compact
 *    JSON (the pretty-printed Neutreeko graph is ~10 MB; compact is ~4.9 MB).
 * 2. Run react-scripts build with Public URL / static-mode variables baked in.
 *
 * No generated JSON is committed: frontend/public/data/ is gitignored.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, "..");
const repo = resolve(frontend, "..");
const publicData = join(frontend, "public", "data");

mkdirSync(publicData, { recursive: true });
for (const gameType of ["neutreeko", "pyrga"]) {
  const source = join(repo, "backend", "data", `${gameType}_graph.json`);
  const graph = JSON.parse(readFileSync(source, "utf8"));
  if (!graph || typeof graph !== "object" || !graph.nodesMap) {
    throw new Error(`${source} is not a graph JSON object`);
  }
  writeFileSync(
    join(publicData, `${gameType}_graph.json`),
    JSON.stringify(graph),
  );
}

const repoSlug = process.env.GITHUB_REPOSITORY || "kokilux/neutreeko-react";
const repoName = repoSlug.split("/")[1] || "neutreeko-react";
const publicUrl = process.env.PAGES_BASE_PATH || `/${repoName}`;
const reactScripts = join(
  frontend,
  "node_modules",
  "react-scripts",
  "bin",
  "react-scripts.js",
);

const result = spawnSync(process.execPath, [reactScripts, "build"], {
  cwd: frontend,
  stdio: "inherit",
  env: {
    ...process.env,
    CI: process.env.CI || "true",
    PUBLIC_URL: publicUrl,
    REACT_APP_STATIC_DATA: "1",
    // Static mode never calls the backend; clear the placeholder from
    // .env.production so no invalid absolute URL is baked into the bundle.
    REACT_APP_API_URL: "",
  },
});

process.exit(result.status ?? 1);
