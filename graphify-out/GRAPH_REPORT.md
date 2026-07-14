# Graph Report - triforce  (2026-07-14)

## Corpus Check
- 19 files · ~15,184 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 114 nodes · 119 edges · 16 communities (8 shown, 8 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2f513d63`
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
- usage.js

## God Nodes (most connected - your core abstractions)
1. `Agent` - 8 edges
2. `main()` - 6 edges
3. `Triforce — Running & Operations` - 5 edges
4. `runPipeline()` - 4 edges
5. `Systemd Service (Always-On)` - 4 edges
6. `PWA — Install as App` - 4 edges
7. `stripCodeFences()` - 3 edges
8. `runSandbox()` - 3 edges
9. `inTriangle()` - 3 edges
10. `scripts` - 3 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Import Cycles
- None detected.

## Communities (16 total, 8 thin omitted)

### Community 0 - "orchestrator.js"
Cohesion: 0.24
Nodes (11): loadConfig(), main(), PROVIDER_ENV, runArchitect(), runDeveloper(), runInSandbox(), runSandbox(), stripCodeFences() (+3 more)

### Community 1 - "dependencies"
Cohesion: 0.13
Nodes (15): @anthropic-ai/sdk, dotenv, express, @google/genai, @homebridge/node-pty-prebuilt-multiarch, openai, dependencies, @anthropic-ai/sdk (+7 more)

### Community 2 - "Agent"
Cohesion: 0.29
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
- **56 isolated node(s):** `graphify`, `Workflow: graphify`, `graphify`, `graphify`, `SYSTEM_PROMPTS` (+51 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `graphify`, `Workflow: graphify`, `graphify` to the rest of the system?**
  _56 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._