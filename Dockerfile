# Triforce runtime image: Node 22 + the three local model CLIs (claude, codex, agy).
#
# Triforce's setup wizard only CHECKS for these CLIs (it deliberately never installs
# or pipes remote scripts), so the image installs them. Authentication is done once,
# separately, with the credential volume mounted -- see DOCKER.md.
#
# LIMITATION: no systemd in this container, so the generated-code sandbox used by
# Mode 1 & Mode 2 pipeline execution is unavailable. Use this image for CLI login,
# the dashboard, and chat-style use; run on a systemd host for full pipeline runs.

FROM node:22-bookworm-slim

# curl + ca-certificates for the Antigravity installer; git for the model CLIs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (`claude`) and OpenAI Codex CLI (`codex`). Installed globally into
# /usr/local so the $HOME credential volume mounted at runtime cannot shadow them.
# Swap the codex package here if your distribution channel differs.
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# Antigravity CLI (`agy`). The official installer is written to a file first rather
# than piped straight into a shell, so the build layer stays inspectable; the script
# verifies the binary's SHA-512 against Google's signed manifest internally.
RUN curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh \
 && bash /tmp/agy-install.sh --dir /usr/local/bin \
 && rm -f /tmp/agy-install.sh \
 && agy --version || true

WORKDIR /app
EXPOSE 3000

# Run unprivileged as the image's built-in uid 1000 user; its home holds the
# ~/.claude, ~/.codex and agy credential/config dirs, persisted via a named volume.
USER node
ENV PORT=3000 NODE_ENV=production
CMD ["node", "server.js"]
