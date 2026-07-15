# Graph Report - triforce  (2026-07-15)

## Corpus Check
- 49 files · ~25,842 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 397 nodes · 451 edges · 35 communities (25 shown, 10 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0936b0c5`
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
- devDependencies
- compilerOptions
- package.json
- package.json
- compilerOptions
- compilerOptions
- index.ts
- Client Architecture and Development
- tsconfig.json
- index.d.ts
- scripts

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `files` - 16 edges
3. `Triforce Cross-Platform Client Plan` - 15 edges
4. `RunRegistry` - 14 edges
5. `Agent` - 14 edges
6. `compilerOptions` - 12 edges
7. `scripts` - 9 edges
8. `main()` - 9 edges
9. `setupWizard()` - 7 edges
10. `compilerOptions` - 7 edges

## Surprising Connections (you probably didn't know these)
- `runReviewer()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `promptLoop()` --calls--> `readTask()`  [EXTRACTED]
  cli.js → cli-input.js
- `runInSandbox()` --calls--> `runSandboxed()`  [EXTRACTED]
  orchestrator.js → sandbox.js
- `runArchitect()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `runDeveloper()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js

## Import Cycles
- None detected.

## Communities (35 total, 10 thin omitted)

### Community 0 - "orchestrator.js"
Cohesion: 0.18
Nodes (17): loadConfig(), main(), PROVIDER_ENV, runArchitect(), runDeveloper(), runInSandbox(), runReviewer(), runSandbox() (+9 more)

### Community 1 - "dependencies"
Cohesion: 0.13
Nodes (15): @anthropic-ai/sdk, dotenv, express, @google/genai, openai, dependencies, @anthropic-ai/sdk, dotenv (+7 more)

### Community 2 - "Agent"
Cohesion: 0.20
Nodes (8): Agent, delay(), firstTextBlock(), getErrorStatus(), isRetryableError(), resolveBinPath(), RETRYABLE_STATUSES, withTimeout()

### Community 3 - "package.json"
Cohesion: 0.12
Nodes (16): files, agent.js, cli-input.js, cli.js, install-service.sh, models.config.json, orchestrator.js, packages/protocol/src/ (+8 more)

### Community 4 - "Triforce — Running & Operations"
Cohesion: 0.17
Nodes (11): Access, Android (Chrome), iPhone / iPad (Safari), Mac (Chrome or Edge), Notes, One-time Install, PWA — Install as App, Service Management (+3 more)

### Community 5 - "server.js"
Cohesion: 0.60
Nodes (4): createWorkspace(), parseWorkspaceManifest(), runWorkspaceTest(), safePath()

### Community 6 - "manifest.json"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 7 - "gen-icons.mjs"
Cohesion: 0.28
Nodes (8): BG, edgeFunction(), GOLD, inTriangle(), makeIcon(), maskBuf, SHARDS, SIZES

### Community 15 - "cli.js"
Cohesion: 0.22
Nodes (14): checkAgyLogin(), checkAndInstallDependencies(), checkClaudeLogin(), checkCodexLogin(), connectWebSocket(), __dirname, getNetworkIPs(), readTask() (+6 more)

### Community 16 - "2026-07-15"
Cohesion: 0.20
Nodes (9): 2026-07-15, 2026-07-15 Mode Synchronization Follow-up, Automated regression coverage, Code Review Fix Log, Dependencies, deployment, and operations, Original Finding Resolution Index, Pipeline correctness and configuration, Provider process and response reliability (+1 more)

### Community 19 - "cli-input.test.js"
Cohesion: 0.12
Nodes (15): Agent handoff contract, Current handoff, Objective, Per-step completion procedure, Product decisions, Step 1 — Monorepo and shared-client foundation, Step 2 — Versioned server protocol and resumable run API, Step 3 — Shared connection, authentication, and host profiles (+7 more)

### Community 20 - "devDependencies"
Cohesion: 0.06
Nodes (31): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, jsdom, @testing-library/jest-dom (+23 more)

### Community 21 - "compilerOptions"
Cohesion: 0.08
Nodes (24): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+16 more)

### Community 22 - "package.json"
Cohesion: 0.11
Nodes (17): dependencies, react, react-dom, @triforce/protocol, name, private, scripts, build (+9 more)

### Community 23 - "package.json"
Cohesion: 0.09
Nodes (21): dependencies, zod, devDependencies, typescript, exports, files, import, src (+13 more)

### Community 24 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, allowJs, checkJs, declaration, declarationMap, module, moduleResolution, noUncheckedIndexedAccess (+6 more)

### Community 25 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, allowImportingTsExtensions, composite, module, moduleResolution, noEmit, skipLibCheck, include (+2 more)

### Community 26 - "index.ts"
Cohesion: 0.07
Nodes (31): App(), agentConfigurationSchema, agentRoleSchema, capabilities, capabilitiesCommandSchema, clientCommandSchema, isCompatibleProtocol(), pipelineConfigurationSchema (+23 more)

### Community 27 - "Client Architecture and Development"
Cohesion: 0.40
Nodes (4): Client Architecture and Development, Commands, Packages, Protocol and run recovery

### Community 32 - "index.d.ts"
Cohesion: 0.15
Nodes (12): AgentConfiguration, AgentRole, CapabilitiesCommand, ClientCommand, PipelineConfiguration, PipelineMode, RunCommand, ServerEvent (+4 more)

### Community 33 - "scripts"
Cohesion: 0.09
Nodes (22): bin, triforce, description, devDependencies, pngjs, main, name, scripts (+14 more)

## Knowledge Gaps
- **218 isolated node(s):** `Packages`, `Protocol and run recovery`, `Commands`, `Objective`, `Agent handoff contract` (+213 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `package.json`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `files` connect `package.json` to `scripts`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Why does `dependencies` connect `dependencies` to `scripts`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `Packages`, `Protocol and run recovery`, `Commands` to the rest of the system?**
  _218 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `cli-input.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._