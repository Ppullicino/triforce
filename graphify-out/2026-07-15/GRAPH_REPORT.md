# Graph Report - triforce  (2026-07-15)

## Corpus Check
- 75 files · ~37,281 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 607 nodes · 751 edges · 52 communities (38 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 6 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0307c8a0`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- orchestrator.js
- dependencies
- Agent
- package.json
- Triforce — Running & Operations
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
- server-protocol.test.js
- files
- package.json
- default.json
- lib.rs
- Triforce Desktop
- files
- App.tsx
- Triforce Android
- App.tsx
- MainActivity
- String
- WebView

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `files` - 16 edges
3. `Agent` - 15 edges
4. `Triforce Cross-Platform Client Plan` - 15 edges
5. `RunRegistry` - 14 edges
6. `TriforceConnection` - 13 edges
7. `compilerOptions` - 12 edges
8. `scripts` - 10 edges
9. `main()` - 9 edges
10. `runPipeline()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `runInSandbox()` --calls--> `runSandboxed()`  [EXTRACTED]
  orchestrator.js → sandbox.js
- `runReviewer()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `promptLoop()` --calls--> `readTask()`  [EXTRACTED]
  cli.js → cli-input.js
- `runArchitect()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `runDeveloper()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js

## Import Cycles
- None detected.

## Communities (52 total, 14 thin omitted)

### Community 0 - "orchestrator.js"
Cohesion: 0.20
Nodes (16): loadConfig(), main(), PROVIDER_ENV, runArchitect(), runDeveloper(), runInSandbox(), runReviewer(), runSandbox() (+8 more)

### Community 1 - "dependencies"
Cohesion: 0.20
Nodes (6): android, WebView, MainActivitySecurityTest, CredentialVault, String, SecretKey

### Community 2 - "Agent"
Cohesion: 0.20
Nodes (8): Agent, delay(), firstTextBlock(), getErrorStatus(), isRetryableError(), resolveBinPath(), RETRYABLE_STATUSES, withTimeout()

### Community 3 - "package.json"
Cohesion: 0.12
Nodes (7): ConnectionOptions, ConnectionState, EventListener, SocketLike, StateListener, MockSocket, TriforceConnection

### Community 4 - "Triforce — Running & Operations"
Cohesion: 0.17
Nodes (11): Access, Android (Chrome), iPhone / iPad (Safari), Mac (Chrome or Edge), Notes, One-time Install, PWA — Install as App, Service Management (+3 more)

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
Nodes (33): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, jsdom, @testing-library/jest-dom (+25 more)

### Community 21 - "compilerOptions"
Cohesion: 0.07
Nodes (26): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+18 more)

### Community 22 - "package.json"
Cohesion: 0.09
Nodes (21): dependencies, react, react-dom, @tauri-apps/api, @tauri-apps/plugin-opener, @triforce/protocol, name, private (+13 more)

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
Nodes (35): agentConfigurationSchema, agentRoleSchema, capabilities, capabilitiesCommandSchema, clientCommandSchema, isCompatibleProtocol(), pipelineConfigurationSchema, pipelineModeSchema (+27 more)

### Community 27 - "Client Architecture and Development"
Cohesion: 0.29
Nodes (6): Client Architecture and Development, Commands, Hosts, credentials, and connections, Packages, Protocol and run recovery, Shared interface

### Community 32 - "index.d.ts"
Cohesion: 0.15
Nodes (12): AgentConfiguration, AgentRole, CapabilitiesCommand, ClientCommand, PipelineConfiguration, PipelineMode, RunCommand, ServerEvent (+4 more)

### Community 33 - "scripts"
Cohesion: 0.05
Nodes (39): @anthropic-ai/sdk, dotenv, express, @google/genai, openai, bin, triforce, dependencies (+31 more)

### Community 34 - "server-protocol.test.js"
Cohesion: 0.07
Nodes (18): NormalizedHostUrl, normalizeHostUrl(), BrowserHostStorage, CredentialStorage, HostProfile, HostRepository, HostStorage, isHostProfile() (+10 more)

### Community 35 - "files"
Cohesion: 0.08
Nodes (25): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+17 more)

### Community 36 - "package.json"
Cohesion: 0.15
Nodes (12): devDependencies, @tauri-apps/cli, name, private, scripts, build, check, dev (+4 more)

### Community 37 - "default.json"
Cohesion: 0.18
Nodes (10): description, identifier, permissions, $schema, windows, core:default, main, opener:allow-open-url (+2 more)

### Community 38 - "lib.rs"
Cohesion: 0.29
Nodes (6): credential_delete(), credential_get(), credential_set(), String, Option, Result

### Community 39 - "Triforce Desktop"
Cohesion: 0.50
Nodes (3): Development, Prerequisites, Triforce Desktop

### Community 42 - "files"
Cohesion: 0.12
Nodes (16): files, agent.js, cli-input.js, cli.js, install-service.sh, models.config.json, orchestrator.js, packages/protocol/src/ (+8 more)

### Community 48 - "App.tsx"
Cohesion: 0.17
Nodes (12): App(), defaultConfig, roles, installNativeIntegration(), bounded(), emptyUsage, initialPipelineState(), mapStatus() (+4 more)

### Community 49 - "MainActivity"
Cohesion: 0.24
Nodes (7): Bundle, MainActivity, ComponentActivity, CredentialVault, String, TextView, WebView

## Knowledge Gaps
- **277 isolated node(s):** `Requirements and commands`, `rl`, `__dirname`, `name`, `version` (+272 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `promptLoop()` connect `cli.js` to `package.json`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `Agent` connect `Agent` to `orchestrator.js`, `index.ts`?**
  _High betweenness centrality (0.016) - this node is a cross-community bridge._
- **What connects `Requirements and commands`, `rl`, `__dirname` to the rest of the system?**
  _277 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `package.json` be split into smaller, more focused modules?**
  _Cohesion score 0.11666666666666667 - nodes in this community are weakly interconnected._
- **Should `cli-input.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.06060606060606061 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.07407407407407407 - nodes in this community are weakly interconnected._