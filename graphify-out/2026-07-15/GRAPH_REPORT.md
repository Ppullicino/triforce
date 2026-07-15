# Graph Report - triforce  (2026-07-15)

## Corpus Check
- 20 files · ~17,439 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 135 nodes · 171 edges · 16 communities (9 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `7ae6aa0b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- orchestrator.js
- dependencies
- Agent
- package.json
- Triforce — Running & Operations
- server.js
- manifest.json
- gen-icons.mjs
- AGENTS.md
- graphify.md
- graphify.md
- CLAUDE.md
- install-service.sh
- sw.js
- triforce-phase0-prompt.md
- cli.js

## God Nodes (most connected - your core abstractions)
1. `Agent` - 13 edges
2. `main()` - 9 edges
3. `setupWizard()` - 7 edges
4. `track()` - 6 edges
5. `runPipeline()` - 5 edges
6. `Triforce — Running & Operations` - 5 edges
7. `resolveBinPath()` - 4 edges
8. `resolveBinPath()` - 4 edges
9. `connectWebSocket()` - 4 edges
10. `main()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `runReviewer()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `runArchitect()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `runDeveloper()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `main()` --calls--> `printSummary()`  [EXTRACTED]
  orchestrator.js → usage.js
- `main()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js

## Import Cycles
- None detected.

## Communities (16 total, 7 thin omitted)

### Community 0 - "orchestrator.js"
Cohesion: 0.20
Nodes (16): loadConfig(), main(), PROVIDER_ENV, runArchitect(), runDeveloper(), runInSandbox(), runReviewer(), runSandbox() (+8 more)

### Community 1 - "dependencies"
Cohesion: 0.13
Nodes (15): @anthropic-ai/sdk, dotenv, express, @google/genai, @homebridge/node-pty-prebuilt-multiarch, openai, dependencies, @anthropic-ai/sdk (+7 more)

### Community 2 - "Agent"
Cohesion: 0.24
Nodes (5): Agent, delay(), getErrorStatus(), resolveBinPath(), RETRYABLE_STATUSES

### Community 3 - "package.json"
Cohesion: 0.14
Nodes (13): bin, triforce, description, devDependencies, pngjs, main, name, scripts (+5 more)

### Community 4 - "Triforce — Running & Operations"
Cohesion: 0.17
Nodes (11): Access, Android (Chrome), iPhone / iPad (Safari), Mac (Chrome or Edge), Notes, One-time Install, PWA — Install as App, Service Management (+3 more)

### Community 5 - "server.js"
Cohesion: 0.19
Nodes (12): app, computeCosts(), __dirname, httpServer, RATES, runInSandbox(), runPipeline(), sessionUsage (+4 more)

### Community 6 - "manifest.json"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 7 - "gen-icons.mjs"
Cohesion: 0.28
Nodes (8): BG, edgeFunction(), GOLD, inTriangle(), makeIcon(), maskBuf, SHARDS, SIZES

### Community 15 - "cli.js"
Cohesion: 0.27
Nodes (13): checkAgyLogin(), checkAndInstallDependencies(), checkClaudeLogin(), checkCodexLogin(), connectWebSocket(), __dirname, getNetworkIPs(), main() (+5 more)

## Knowledge Gaps
- **60 isolated node(s):** `rl`, `__dirname`, `SHARDS`, `BG`, `GOLD` (+55 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Agent` connect `Agent` to `orchestrator.js`, `server.js`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `main()` connect `orchestrator.js` to `Agent`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `rl`, `__dirname`, `SHARDS` to the rest of the system?**
  _60 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._