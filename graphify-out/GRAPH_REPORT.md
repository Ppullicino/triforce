# Graph Report - triforce  (2026-09-10)

## Corpus Check
- 110 files · ~94,364 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1033 nodes · 1412 edges · 105 communities (65 shown, 25 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 17 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `84b90283`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.js
- MainActivity.kt
- agent.js
- scripts
- Triforce — Running & Operations
- manifest.json
- gen-icons.mjs
- AGENTS.md
- rules/graphify.md
- workflows/graphify.md
- CLAUDE.md
- install-service.sh
- sw.js
- triforce-phase0-prompt.md
- cli.js
- 2026-07-15
- package.test.js
- RunRegistry
- Triforce Cross-Platform Client Plan
- devDependencies
- compilerOptions
- dependencies
- protocol/package.json
- compilerOptions
- compilerOptions
- package.json
- Client Architecture and Development
- shared/tsconfig.json
- index.d.ts
- files
- Triforce — Three‑Mode Redesign Plan
- tauri.conf.json
- desktop/package.json
- default.json
- lib.rs
- Triforce Desktop
- index.js
- NetworkPolicyTest
- Triforce Android
- Remote Client Security Review
- sync-version.mjs
- Release Signing and Store Delivery
- Triforce Remote 0.1.0 Release Notes
- Triforce Remote Operations Guide
- 0.1.0-rc.1 Validation Record
- dependencies
- App.tsx
- install-service.test.js
- platform-credentials.ts
- pipeline.ts
- Dashboard
- definitions
- definitions
- properties
- properties
- permissions
- permissions
- webviews
- CapabilityRemote
- CapabilityRemote
- webviews
- Capability
- Capability
- desktop-schema.json
- linux-schema.json
- description
- description
- workspaces
- SubscriptionLedger
- triforce-desktop
- TriforceConnection
- entrypoint.sh
- workspace.js
- connection.ts
- pipeline.js
- fs-browser.js
- credit-extender.js
- verified-chat.js
- scripts
- shared/package.json
- @eslint/js
- Running Triforce in Docker
- eslint-plugin-react-hooks
- globals
- @testing-library/jest-dom
- @testing-library/react
- @types/node
- @types/react-dom
- typescript-eslint
- @vitejs/plugin-react

## God Nodes (most connected - your core abstractions)
1. `TriforceConnection` - 21 edges
2. `files` - 21 edges
3. `runCreditExtender()` - 20 edges
4. `RunRegistry` - 20 edges
5. `executePipeline()` - 18 edges
6. `SubscriptionLedger` - 18 edges
7. `compilerOptions` - 17 edges
8. `Agent` - 15 edges
9. `Triforce Cross-Platform Client Plan` - 15 edges
10. `Triforce — Three‑Mode Redesign Plan` - 14 edges

## Surprising Connections (you probably didn't know these)
- `isCapacitySignal()` --calls--> `getErrorStatus()`  [EXTRACTED]
  credit-extender.js → agent.js
- `runVerifiedChat()` --calls--> `ask()`  [EXTRACTED]
  verified-chat.js → agent.js
- `executePipeline()` --calls--> `Agent`  [EXTRACTED]
  pipeline.js → agent.js
- `runCreditExtender()` --calls--> `parseVerdict()`  [EXTRACTED]
  credit-extender.js → pipeline.js
- `runCreditExtender()` --calls--> `createWorkspace()`  [EXTRACTED]
  credit-extender.js → workspace.js

## Import Cycles
- None detected.

## Communities (105 total, 25 thin omitted)

### Community 0 - "server.js"
Cohesion: 0.10
Nodes (19): app, bearerToken(), chatHistories, cookieToken(), __dirname, FS_ROOTS, httpServer, killLingeringSandboxUnits() (+11 more)

### Community 1 - "MainActivity.kt"
Cohesion: 0.11
Nodes (16): android, Bundle, WebView, MainActivitySecurityTest, CredentialVault, WebView, MainActivity, OnBackPressedCallback (+8 more)

### Community 2 - "agent.js"
Cohesion: 0.12
Nodes (11): Agent, delay(), getErrorStatus(), isRetryableError(), parseClaudeJsonEnvelope(), parseCodexJsonl(), resolveBinPath(), RETRYABLE_STATUSES (+3 more)

### Community 3 - "scripts"
Cohesion: 0.17
Nodes (12): scripts, build, cli, desktop:check, dev:client, lint, start, test (+4 more)

### Community 4 - "Triforce — Running & Operations"
Cohesion: 0.14
Nodes (13): Access, Android (Chrome), iPhone / iPad (Safari), Mac (Chrome or Edge), Modes, Notes, Onboarding (`triforce init`), One-time Install (+5 more)

### Community 6 - "manifest.json"
Cohesion: 0.20
Nodes (9): background_color, description, display, icons, name, orientation, short_name, start_url (+1 more)

### Community 7 - "gen-icons.mjs"
Cohesion: 0.28
Nodes (8): BG, edgeFunction(), GOLD, inTriangle(), makeIcon(), maskBuf, SHARDS, SIZES

### Community 15 - "cli.js"
Cohesion: 0.18
Nodes (21): checkAgyLogin(), checkAndInstallDependencies(), checkClaudeLogin(), checkCodexLogin(), connectWebSocket(), __dirname, ensureEnvToken(), fetchCapabilities() (+13 more)

### Community 16 - "2026-07-15"
Cohesion: 0.20
Nodes (9): 2026-07-15, 2026-07-15 Mode Synchronization Follow-up, Automated regression coverage, Code Review Fix Log, Dependencies, deployment, and operations, Original Finding Resolution Index, Pipeline correctness and configuration, Provider process and response reliability (+1 more)

### Community 19 - "Triforce Cross-Platform Client Plan"
Cohesion: 0.12
Nodes (15): Agent handoff contract, Current handoff, Objective, Per-step completion procedure, Product decisions, Step 1 — Monorepo and shared-client foundation, Step 2 — Versioned server protocol and resumable run API, Step 3 — Shared connection, authentication, and host profiles (+7 more)

### Community 20 - "devDependencies"
Cohesion: 0.13
Nodes (15): devDependencies, eslint, eslint-plugin-react-refresh, jsdom, @types/react, typescript, vite, vitest (+7 more)

### Community 21 - "compilerOptions"
Cohesion: 0.07
Nodes (26): compilerOptions, allowJs, allowSyntheticDefaultImports, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, jsx, lib (+18 more)

### Community 22 - "dependencies"
Cohesion: 0.18
Nodes (11): dependencies, react, react-dom, @tauri-apps/api, @tauri-apps/plugin-opener, @triforce/protocol, react, react-dom (+3 more)

### Community 23 - "protocol/package.json"
Cohesion: 0.10
Nodes (19): dependencies, zod, devDependencies, typescript, exports, files, src, typescript (+11 more)

### Community 24 - "compilerOptions"
Cohesion: 0.13
Nodes (14): compilerOptions, allowJs, checkJs, declaration, declarationMap, module, moduleResolution, noUncheckedIndexedAccess (+6 more)

### Community 25 - "compilerOptions"
Cohesion: 0.18
Nodes (10): compilerOptions, allowImportingTsExtensions, composite, module, moduleResolution, noEmit, skipLibCheck, include (+2 more)

### Community 26 - "package.json"
Cohesion: 0.18
Nodes (10): bin, triforce, description, devDependencies, pngjs, main, name, type (+2 more)

### Community 27 - "Client Architecture and Development"
Cohesion: 0.25
Nodes (7): Client Architecture and Development, Commands, Hosts, credentials, and connections, Modes and the filesystem navigator (protocol 1.2), Packages, Protocol and run recovery, Shared interface

### Community 32 - "index.d.ts"
Cohesion: 0.09
Nodes (21): AgentConfiguration, AgentRole, ApplyCommand, BuildPosition, CancelCommand, CapabilitiesCommand, ChatCommand, ClientCommand (+13 more)

### Community 33 - "files"
Cohesion: 0.10
Nodes (21): files, agent.js, cli-input.js, cli.js, credit-extender.js, fs-browser.js, install-service.sh, models.config.json (+13 more)

### Community 34 - "Triforce — Three‑Mode Redesign Plan"
Cohesion: 0.09
Nodes (22): 0. Current state (branch `remove-api-key-providers`), 10. Phased delivery, 11. Open questions / risks, 12. Graphify maintenance, 1. Vision, 2. The three modes, 3. Filesystem navigator (new capability, shared by all modes), 4. First‑run / onboarding (+14 more)

### Community 35 - "tauri.conf.json"
Cohesion: 0.08
Nodes (25): app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl, frontendDist (+17 more)

### Community 36 - "desktop/package.json"
Cohesion: 0.15
Nodes (12): devDependencies, @tauri-apps/cli, name, private, scripts, build, check, dev (+4 more)

### Community 37 - "default.json"
Cohesion: 0.18
Nodes (10): description, identifier, permissions, $schema, windows, core:default, main, opener:allow-open-url (+2 more)

### Community 38 - "lib.rs"
Cohesion: 0.29
Nodes (6): credential_delete(), credential_get(), credential_set(), Option, Result, String

### Community 39 - "Triforce Desktop"
Cohesion: 0.50
Nodes (3): Development, Prerequisites, Triforce Desktop

### Community 42 - "index.js"
Cohesion: 0.09
Nodes (25): agentConfigurationSchema, agentRoleSchema, applyCommandSchema, buildPositionSchema, cancelCommandSchema, capabilities, capabilitiesCommandSchema, chatCommandSchema (+17 more)

### Community 48 - "Remote Client Security Review"
Cohesion: 0.29
Nodes (6): Compatibility and deployment rules, Filesystem navigator and apply (protocol 1.2), Remote Client Security Review, Review log and verification, Threat model and controls, Trust boundaries and assets

### Community 50 - "sync-version.mjs"
Cohesion: 0.22
Nodes (8): jsonFiles, lock, lockUrl, [major, minor, patch], mismatches, root, textFiles, write

### Community 51 - "Release Signing and Store Delivery"
Cohesion: 0.29
Nodes (6): Android, Apple, Desktop updater, Release Signing and Store Delivery, Shared release procedure, Windows

### Community 52 - "Triforce Remote 0.1.0 Release Notes"
Cohesion: 0.40
Nodes (4): Compatibility, Migration and security changes, ⚠️ Mode semantics changed in protocol 1.2.0, Triforce Remote 0.1.0 Release Notes

### Community 55 - "Triforce Remote Operations Guide"
Cohesion: 0.29
Nodes (6): Data and backup, Deployment and monitoring, Release ownership, Rollback and recovery, Triforce Remote Operations Guide, Upgrade

### Community 56 - "0.1.0-rc.1 Validation Record"
Cohesion: 0.33
Nodes (5): 0.1.0-rc.1 Validation Record, Compatibility matrix, Functional and failure cases, Operations and release, Security and accessibility sign-off

### Community 58 - "dependencies"
Cohesion: 0.22
Nodes (9): dotenv, express, dependencies, dotenv, express, ws, zod, zod (+1 more)

### Community 60 - "App.tsx"
Cohesion: 0.17
Nodes (12): App(), connectHost(), BuildTriad, connectionMessages, defaultConfig, roles, appendUserMessage(), ChatEntry (+4 more)

### Community 62 - "platform-credentials.ts"
Cohesion: 0.06
Nodes (23): NormalizedHostUrl, normalizeHostUrl(), BrowserHostStorage, CredentialStorage, HostProfile, HostRepository, HostStorage, isHostProfile() (+15 more)

### Community 63 - "pipeline.ts"
Cohesion: 0.36
Nodes (7): bounded(), emptyUsage, initialPipelineState(), mapStatus(), PipelineViewState, reducePipeline(), UsageItem

### Community 65 - "definitions"
Cohesion: 0.12
Nodes (16): anyOf, description, definitions, Application, Number, PermissionEntry, Target, Value (+8 more)

### Community 66 - "definitions"
Cohesion: 0.12
Nodes (16): anyOf, description, definitions, Application, Number, PermissionEntry, Target, Value (+8 more)

### Community 67 - "properties"
Cohesion: 0.15
Nodes (13): properties, Identifier, description, oneOf, type, default, description, type (+5 more)

### Community 68 - "properties"
Cohesion: 0.15
Nodes (13): properties, Identifier, description, oneOf, type, default, description, type (+5 more)

### Community 69 - "permissions"
Cohesion: 0.17
Nodes (12): $ref, array, null, description, items, type, uniqueItems, description (+4 more)

### Community 70 - "permissions"
Cohesion: 0.17
Nodes (12): $ref, array, null, description, items, type, uniqueItems, description (+4 more)

### Community 71 - "webviews"
Cohesion: 0.20
Nodes (10): type, webviews, windows, items, description, items, type, description (+2 more)

### Community 72 - "CapabilityRemote"
Cohesion: 0.22
Nodes (9): description, properties, required, type, CapabilityRemote, urls, urls, description (+1 more)

### Community 73 - "CapabilityRemote"
Cohesion: 0.22
Nodes (9): description, properties, required, type, CapabilityRemote, urls, urls, description (+1 more)

### Community 74 - "webviews"
Cohesion: 0.20
Nodes (10): type, webviews, windows, items, description, items, type, description (+2 more)

### Community 75 - "Capability"
Cohesion: 0.33
Nodes (6): description, required, type, Capability, identifier, permissions

### Community 76 - "Capability"
Cohesion: 0.33
Nodes (6): description, required, type, Capability, identifier, permissions

### Community 77 - "desktop-schema.json"
Cohesion: 0.40
Nodes (4): anyOf, description, $schema, title

### Community 78 - "linux-schema.json"
Cohesion: 0.40
Nodes (4): anyOf, description, $schema, title

### Community 79 - "description"
Cohesion: 0.50
Nodes (4): default, description, type, description

### Community 80 - "description"
Cohesion: 0.50
Nodes (4): default, description, type, description

### Community 81 - "workspaces"
Cohesion: 0.50
Nodes (4): workspaces, clients/desktop, clients/shared, packages/*

### Community 82 - "SubscriptionLedger"
Cohesion: 0.25
Nodes (3): emptyCli(), SubscriptionLedger, clockLedger()

### Community 84 - "TriforceConnection"
Cohesion: 0.11
Nodes (3): SocketLike, MockSocket, TriforceConnection

### Community 86 - "workspace.js"
Cohesion: 0.18
Nodes (21): _exec, fakeWorkspaceName(), makeFakeWorkspaces(), applyDiff(), checkGit(), cleanWorkspaceDirectory(), createWorkspace(), createWorkspaceFromDir() (+13 more)

### Community 87 - "connection.ts"
Cohesion: 0.33
Nodes (5): ConnectionOptions, ConnectionState, EventListener, StateListener, PROTOCOL_VERSION

### Community 88 - "pipeline.js"
Cohesion: 0.11
Nodes (27): ALLOWED_MODELS, checkConfigForWarnings(), getCatalog(), getRates(), hasRates(), RATES, warnedModels, __dirname (+19 more)

### Community 89 - "fs-browser.js"
Cohesion: 0.23
Nodes (12): ALWAYS_TEXT_FILES, confinePath(), DENY_NAMES, describe(), list(), looksTextual(), readBudgeted(), roots() (+4 more)

### Community 90 - "credit-extender.js"
Cohesion: 0.22
Nodes (18): ask(), getRetryAfterMs(), cliAgentConfig(), isCapacitySignal(), normalizePool(), runCreditExtender(), routedAsk(), stripCodeFences() (+10 more)

### Community 91 - "verified-chat.js"
Cohesion: 0.24
Nodes (7): CHAT_PROMPTS, cliAgentConfig(), normalizePool(), parseAssessment(), renderHistory(), runVerifiedChat(), tokensOf()

### Community 92 - "scripts"
Cohesion: 0.33
Nodes (6): scripts, build, dev, lint, test, typecheck

### Community 93 - "shared/package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 96 - "Running Triforce in Docker"
Cohesion: 0.20
Nodes (9): Authentication — log in inside the container, Log in to the three CLIs (one time, real terminal), Manage, Manage, Run, Run, Running Triforce in Docker, systemd mode (+1 more)

## Knowledge Gaps
- **472 isolated node(s):** `RETRYABLE_STATUSES`, `rl`, `__dirname`, `name`, `version` (+467 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 576 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **25 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `RunRegistry` connect `RunRegistry` to `server.js`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `TriforceConnection` connect `TriforceConnection` to `App.tsx`, `connection.ts`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Why does `properties` connect `properties` to `description`, `webviews`, `Capability`, `permissions`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **What connects `RETRYABLE_STATUSES`, `rl`, `__dirname` to the rest of the system?**
  _472 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.09782608695652174 - nodes in this community are weakly interconnected._
- **Should `MainActivity.kt` be split into smaller, more focused modules?**
  _Cohesion score 0.10793650793650794 - nodes in this community are weakly interconnected._
- **Should `agent.js` be split into smaller, more focused modules?**
  _Cohesion score 0.11612903225806452 - nodes in this community are weakly interconnected._