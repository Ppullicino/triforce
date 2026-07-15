# Graph Report - triforce  (2026-07-15)

## Corpus Check
- 23 files · ~18,852 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 154 nodes · 189 edges · 19 communities (11 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e939a1ed`
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
- usage.js

## God Nodes (most connected - your core abstractions)
1. `Agent` - 15 edges
2. `setupWizard()` - 7 edges
3. `main()` - 7 edges
4. `2026-07-15` - 6 edges
5. `runPipeline()` - 6 edges
6. `Triforce — Running & Operations` - 5 edges
7. `resolveBinPath()` - 5 edges
8. `Systemd Service (Always-On)` - 4 edges
9. `PWA — Install as App` - 4 edges
10. `resolveBinPath()` - 4 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (19 total, 8 thin omitted)

### Community 0 - "orchestrator.js"
Cohesion: 0.24
Nodes (11): loadConfig(), main(), PROVIDER_ENV, runArchitect(), runDeveloper(), runInSandbox(), runSandbox(), stripCodeFences() (+3 more)

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
Cohesion: 0.14
Nodes (15): activeRuns, ALLOWED_MODELS, app, computeCosts(), __dirname, httpServer, latestUsage, RATES (+7 more)

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
Cohesion: 0.22
Nodes (8): 2026-07-15, Automated regression coverage, Code Review Fix Log, Dependencies, deployment, and operations, Original Finding Resolution Index, Pipeline correctness and configuration, Provider process and response reliability, Server boundary and execution isolation

## Knowledge Gaps
- **68 isolated node(s):** `Provider process and response reliability`, `Server boundary and execution isolation`, `Pipeline correctness and configuration`, `Dependencies, deployment, and operations`, `Automated regression coverage` (+63 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Agent` connect `Agent` to `orchestrator.js`, `server.js`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `Provider process and response reliability`, `Server boundary and execution isolation`, `Pipeline correctness and configuration` to the rest of the system?**
  _68 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13725490196078433 - nodes in this community are weakly interconnected._