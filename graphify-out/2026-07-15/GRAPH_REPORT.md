# Graph Report - triforce  (2026-07-15)

## Corpus Check
- 29 files · ~21,374 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 184 nodes · 237 edges · 20 communities (11 shown, 9 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d63a97dc`
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
- 2026-07-15
- sandbox.test.js
- files
- cli-input.test.js

## God Nodes (most connected - your core abstractions)
1. `files` - 14 edges
2. `Agent` - 14 edges
3. `main()` - 9 edges
4. `runPipeline()` - 8 edges
5. `setupWizard()` - 7 edges
6. `track()` - 6 edges
7. `2026-07-15` - 6 edges
8. `Triforce — Running & Operations` - 5 edges
9. `resolveBinPath()` - 5 edges
10. `parseWorkspaceManifest()` - 5 edges

## Surprising Connections (you probably didn't know these)
- `runReviewer()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `runPipeline()` --calls--> `createWorkspace()`  [EXTRACTED]
  server.js → workspace.js
- `runPipeline()` --calls--> `parseWorkspaceManifest()`  [EXTRACTED]
  server.js → workspace.js
- `runPipeline()` --calls--> `runWorkspaceTest()`  [EXTRACTED]
  server.js → workspace.js
- `runInSandbox()` --calls--> `runSandboxed()`  [EXTRACTED]
  orchestrator.js → sandbox.js

## Import Cycles
- None detected.

## Communities (20 total, 9 thin omitted)

### Community 0 - "orchestrator.js"
Cohesion: 0.18
Nodes (17): loadConfig(), main(), PROVIDER_ENV, runArchitect(), runDeveloper(), runInSandbox(), runReviewer(), runSandbox() (+9 more)

### Community 1 - "dependencies"
Cohesion: 0.15
Nodes (13): @anthropic-ai/sdk, dotenv, express, @google/genai, openai, dependencies, @anthropic-ai/sdk, dotenv (+5 more)

### Community 2 - "Agent"
Cohesion: 0.20
Nodes (8): Agent, delay(), firstTextBlock(), getErrorStatus(), isRetryableError(), resolveBinPath(), RETRYABLE_STATUSES, withTimeout()

### Community 3 - "package.json"
Cohesion: 0.13
Nodes (14): bin, triforce, description, devDependencies, pngjs, main, name, scripts (+6 more)

### Community 4 - "Triforce — Running & Operations"
Cohesion: 0.17
Nodes (11): Access, Android (Chrome), iPhone / iPad (Safari), Mac (Chrome or Edge), Notes, One-time Install, PWA — Install as App, Service Management (+3 more)

### Community 5 - "server.js"
Cohesion: 0.13
Nodes (19): ALLOWED_MODELS, app, computeCosts(), __dirname, httpServer, latestUsage, RATES, runInSandbox() (+11 more)

### Community 6 - "manifest.json"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 7 - "gen-icons.mjs"
Cohesion: 0.28
Nodes (8): BG, edgeFunction(), GOLD, inTriangle(), makeIcon(), maskBuf, SHARDS, SIZES

### Community 15 - "cli.js"
Cohesion: 0.29
Nodes (13): checkAgyLogin(), checkAndInstallDependencies(), checkClaudeLogin(), checkCodexLogin(), connectWebSocket(), __dirname, getNetworkIPs(), main() (+5 more)

### Community 16 - "2026-07-15"
Cohesion: 0.20
Nodes (9): 2026-07-15, 2026-07-15 Mode Synchronization Follow-up, Automated regression coverage, Code Review Fix Log, Dependencies, deployment, and operations, Original Finding Resolution Index, Pipeline correctness and configuration, Provider process and response reliability (+1 more)

### Community 18 - "files"
Cohesion: 0.14
Nodes (14): files, agent.js, cli-input.js, cli.js, install-service.sh, models.config.json, orchestrator.js, public/ (+6 more)

## Knowledge Gaps
- **84 isolated node(s):** `Access`, `One-time Install`, `Service Management`, `View Logs`, `Android (Chrome)` (+79 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `files` connect `files` to `package.json`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `Agent` connect `Agent` to `orchestrator.js`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `Access`, `One-time Install`, `Service Management` to the rest of the system?**
  _84 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13405797101449277 - nodes in this community are weakly interconnected._
- **Should `files` be split into smaller, more focused modules?**
  _Cohesion score 0.14285714285714285 - nodes in this community are weakly interconnected._