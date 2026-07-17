# Graph Report - triforce  (2026-07-17)

## Corpus Check
- 88 files · ~44,016 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 664 nodes · 789 edges · 62 communities (48 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 8 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8a7cfdc7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- orchestrator.js
- dependencies
- Agent
- MockSocket
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
- TriforceConnection
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
- workspace.js
- sync-version.mjs
- Release Signing and Store Delivery
- Triforce Remote 0.1.0 Release Notes
- Triforce Remote Operations Guide
- 0.1.0-rc.1 Validation Record
- usage.js
- workspace.js
- sandbox.js

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 17 edges
2. `files` - 16 edges
3. `Triforce Cross-Platform Client Plan` - 15 edges
4. `Agent` - 14 edges
5. `RunRegistry` - 14 edges
6. `TriforceConnection` - 13 edges
7. `scripts` - 12 edges
8. `compilerOptions` - 12 edges
9. `CredentialVault` - 9 edges
10. `executePipeline()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `runPipeline()` --calls--> `executePipeline()`  [EXTRACTED]
  server.js → pipeline.js
- `main()` --calls--> `executePipeline()`  [EXTRACTED]
  orchestrator.js → pipeline.js
- `promptLoop()` --calls--> `readTask()`  [EXTRACTED]
  cli.js → cli-input.js
- `runArchitect()` --calls--> `track()`  [EXTRACTED]
  orchestrator.js → usage.js
- `main()` --calls--> `printSummary()`  [EXTRACTED]
  orchestrator.js → usage.js

## Import Cycles
- None detected.

## Communities (62 total, 14 thin omitted)

### Community 0 - "orchestrator.js"
Cohesion: 0.13
Nodes (19): __dirname, loadConfig(), main(), PROVIDER_ENV, runArchitect(), validateApiKeys(), __dirname, executePipeline() (+11 more)

### Community 1 - "dependencies"
Cohesion: 0.11
Nodes (12): android, Bundle, WebView, MainActivitySecurityTest, CredentialVault, String, String, WebView (+4 more)

### Community 2 - "Agent"
Cohesion: 0.17
Nodes (10): Agent, CLI_PROVIDERS, delay(), firstTextBlock(), getErrorStatus(), getRetryAfterMs(), isRetryableError(), resolveBinPath() (+2 more)

### Community 3 - "MockSocket"
Cohesion: 0.12
Nodes (6): MockSocket, config, messages(), nativeOrigins, startServer(), startServer()

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

### Community 27 - "Client Architecture and Development"
Cohesion: 0.29
Nodes (6): Client Architecture and Development, Commands, Hosts, credentials, and connections, Packages, Protocol and run recovery, Shared interface

### Community 32 - "index.d.ts"
Cohesion: 0.15
Nodes (12): AgentConfiguration, AgentRole, CapabilitiesCommand, ClientCommand, PipelineConfiguration, PipelineMode, RunCommand, ServerEvent (+4 more)

### Community 33 - "scripts"
Cohesion: 0.05
Nodes (42): bin, triforce, description, devDependencies, pngjs, files, main, name (+34 more)

### Community 34 - "server-protocol.test.js"
Cohesion: 0.06
Nodes (30): App(), connectionMessages, defaultConfig, roles, NormalizedHostUrl, normalizeHostUrl(), BrowserHostStorage, CredentialStorage (+22 more)

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
Cohesion: 0.07
Nodes (32): ConnectionOptions, ConnectionState, EventListener, StateListener, agentConfigurationSchema, agentRoleSchema, capabilities, capabilitiesCommandSchema (+24 more)

### Community 48 - "workspace.js"
Cohesion: 0.33
Nodes (5): Compatibility and deployment rules, Remote Client Security Review, Review log and verification, Threat model and controls, Trust boundaries and assets

### Community 50 - "sync-version.mjs"
Cohesion: 0.22
Nodes (8): jsonFiles, lock, lockUrl, [major, minor, patch], mismatches, root, textFiles, write

### Community 51 - "Release Signing and Store Delivery"
Cohesion: 0.29
Nodes (6): Android, Apple, Desktop updater, Release Signing and Store Delivery, Shared release procedure, Windows

### Community 52 - "Triforce Remote 0.1.0 Release Notes"
Cohesion: 0.50
Nodes (3): Compatibility, Migration and security changes, Triforce Remote 0.1.0 Release Notes

### Community 55 - "Triforce Remote Operations Guide"
Cohesion: 0.29
Nodes (6): Data and backup, Deployment and monitoring, Release ownership, Rollback and recovery, Triforce Remote Operations Guide, Upgrade

### Community 56 - "0.1.0-rc.1 Validation Record"
Cohesion: 0.33
Nodes (5): 0.1.0-rc.1 Validation Record, Compatibility matrix, Functional and failure cases, Operations and release, Security and accessibility sign-off

### Community 58 - "usage.js"
Cohesion: 0.13
Nodes (15): @anthropic-ai/sdk, dotenv, express, @google/genai, openai, dependencies, @anthropic-ai/sdk, dotenv (+7 more)

### Community 60 - "workspace.js"
Cohesion: 0.60
Nodes (4): createWorkspace(), parseWorkspaceManifest(), runWorkspaceTest(), safePath()

## Knowledge Gaps
- **312 isolated node(s):** `__dirname`, `SYSTEM_PROMPTS`, `SYSTEM_PROMPTS_MODE2`, `SYSTEM_PROMPTS_WORKSPACE`, `RATES` (+307 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `promptLoop()` connect `cli.js` to `MockSocket`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `TriforceConnection` connect `TriforceConnection` to `files`, `server-protocol.test.js`, `MockSocket`, `files`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `__dirname`, `SYSTEM_PROMPTS`, `SYSTEM_PROMPTS_MODE2` to the rest of the system?**
  _312 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `orchestrator.js` be split into smaller, more focused modules?**
  _Cohesion score 0.13043478260869565 - nodes in this community are weakly interconnected._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.11396011396011396 - nodes in this community are weakly interconnected._
- **Should `MockSocket` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._
- **Should `cli-input.test.js` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._