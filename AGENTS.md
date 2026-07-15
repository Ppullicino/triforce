## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Cross-platform client roadmap

The canonical implementation and handoff plan for the Android, Windows, and macOS
clients is `CROSS_PLATFORM_CLIENT_PLAN.md`.

Before working on the cross-platform clients, every agent must:

1. Run `graphify query "What is the current cross-platform client roadmap status and next incomplete step?"`.
2. Read `CROSS_PLATFORM_CLIENT_PLAN.md` completely.
3. Run `git status --short`, `git log -5 --oneline`, and `git branch --show-current` to verify the recorded status against Git.
4. Resume the first step whose status is not `COMPLETE`; do not repeat completed work unless its acceptance criteria are no longer satisfied.

For each roadmap step:

- Work on only that step and its stated acceptance criteria.
- Preserve unrelated user changes and never discard another agent's work.
- Run the tests listed for that step plus relevant existing regression tests.
- Update the roadmap status, evidence, decisions, and `Next action` before committing.
- Run `graphify update .` after code and documentation changes.
- Commit with the exact step prefix documented in the roadmap, followed by a concise description of the completed work.
- Push the commit to the current upstream branch immediately after committing.
- Mark a step `COMPLETE` only when its acceptance criteria pass and its commit has been pushed. If push fails, leave it `IN PROGRESS` and record the blocker and local commit SHA.
- Do not begin the next step until the current step's push succeeds.

If an agent must stop early because of context, credit, or time limits, it must leave the
current step as `IN PROGRESS`, record completed work, test results, blockers, relevant
paths, and the exact next command or edit under `Next action`, then run `graphify update .`
and commit and push that handoff when possible.
