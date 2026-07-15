# Graph Report - triforce  (2026-07-15)

## Corpus Check
- 19 files · ~15,302 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 115 nodes · 135 edges · 15 communities (8 shown, 7 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `87ca49ff`
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

## God Nodes (most connected - your core abstractions)
1. `Agent` - 11 edges
2. `main()` - 9 edges
3. `track()` - 6 edges
4. `runPipeline()` - 5 edges
5. `Triforce — Running & Operations` - 5 edges
6. `Systemd Service (Always-On)` - 4 edges
7. `PWA — Install as App` - 4 edges
8. `inTriangle()` - 3 edges
9. `stripCodeFences()` - 3 edges
10. `runArchitect()` - 3 edges

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

## Communities (15 total, 7 thin omitted)

### Community 0 - "orchestrator.js"
Cohesion: 0.20
Nodes (16): loadConfig(), main(), PROVIDER_ENV, runArchitect(), runDeveloper(), runInSandbox(), runReviewer(), runSandbox() (+8 more)

### Community 1 - "dependencies"
Cohesion: 0.13
Nodes (15): @anthropic-ai/sdk, dotenv, express, @google/genai, @homebridge/node-pty-prebuilt-multiarch, openai, dependencies, @anthropic-ai/sdk (+7 more)

### Community 2 - "Agent"
Cohesion: 0.27
Nodes (4): Agent, delay(), getErrorStatus(), RETRYABLE_STATUSES

### Community 3 - "package.json"
Cohesion: 0.17
Nodes (11): description, devDependencies, pngjs, main, name, scripts, cli, start (+3 more)

### Community 4 - "Triforce — Running & Operations"
Cohesion: 0.17
Nodes (11): Access, Android (Chrome), iPhone / iPad (Safari), Mac (Chrome or Edge), Notes, One-time Install, PWA — Install as App, Service Management (+3 more)

### Community 5 - "server.js"
Cohesion: 0.21
Nodes (11): app, computeCosts(), httpServer, RATES, runInSandbox(), runPipeline(), sessionUsage, stripCodeFences() (+3 more)

### Community 6 - "manifest.json"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 7 - "gen-icons.mjs"
Cohesion: 0.28
Nodes (8): BG, edgeFunction(), GOLD, inTriangle(), makeIcon(), maskBuf, SHARDS, SIZES

## Knowledge Gaps
- **56 isolated node(s):** `SHARDS`, `BG`, `GOLD`, `SIZES`, `maskBuf` (+51 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Agent` connect `Agent` to `orchestrator.js`, `server.js`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `main()` connect `orchestrator.js` to `Agent`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **What connects `SHARDS`, `BG`, `GOLD` to the rest of the system?**
  _56 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._