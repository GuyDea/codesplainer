# Codesplainer

Understand any codebase, one diagram at a time.

Ask a question about your code and get a small diagram back, not a wall of text. Click any box to **Explain & expand** it into a deeper diagram, and keep going down to functions and line ranges. Every conversation is a tree of diagrams, and you can always see where you are: in the outline, the breadcrumbs, and the conversation map.

The answers come from AI coding agents already installed on your machine (Kiro CLI, Claude Code, Codex or any [ACP](https://agentclientprotocol.com) agent). They read your code locally, read-only. Codesplainer itself runs on `127.0.0.1` and has no accounts or telemetry.

## Features

- **Diagrams first.** Each answer is one diagram of 3–14 boxes, depending on the detail level. Titles have at most 6 words and box labels 1–3 words. A one-sentence summary gives the answer, and 1–3 highlighted boxes mark where it is in the diagram.
- **Explain & expand.** Double-click a box (or press `E`) to get a diagram of its insides. Big repos start with abstract boxes (subsystems, folders), and each expansion goes one level deeper: module → files → functions → steps with line ranges.
- **Ask anywhere.** Ask a new question, a follow-up about the current diagram, a question about one box, or about lines you selected in the code viewer.
- **Discussion structure.**
  - The outline tree, breadcrumbs, and the conversation map show every diagram as a card.
  - Map edges start at the exact box that was expanded.
  - Boxes that already have child diagrams show a badge.
- **Code level.**
  - Boxes link to files and line ranges, opening in the built-in code viewer (CodeMirror) or in your editor.
  - You can browse the whole workspace in the file explorer.
- **Workspaces** can hold one or more folders, for example a backend and a frontend together.
- **Import / export.**
  - Conversations export as `*.codesplainer.json`, with agent sessions stripped. You can re-import them on another machine and map folders to local paths.
  - They also export as Markdown with Mermaid diagrams.
  - A whole workspace exports as one bundle.
  - Single diagrams export as PNG, SVG, Mermaid or JSON.
- **Live progress.** You see the agent's tool calls ("Reading lib/hooks.js…") while it works, and can cancel, retry, retry with another agent, or retry at another detail level. Several diagrams can generate in parallel.
- **Session reuse.** For Claude Code and Codex, expansions and follow-ups fork the parent diagram's agent session, so the agent doesn't re-read what it already knows.
- **Keyboard first.** Command palette (`Ctrl/⌘ K`), shortcuts for every main action, and light/dark theme.
- **Offline demo provider.** It builds diagrams from folder structure and imports without any AI, so you can try the UI without an agent.

## Quick start

Requires Node.js 22.12+ and at least one agent CLI (see [Agents](#agents)).

```bash
npm install
npm run build
npm start                       # http://127.0.0.1:4777
npm start -- ~/code/my-repo     # open a folder directly (creates a workspace for it)
```

Options: `--port <n>`, `--host <host>`, `--data-dir <dir>`, `--no-open` (env: `CODESPLAINER_PORT`, `CODESPLAINER_HOST`, `CODESPLAINER_HOME`, `CODESPLAINER_NO_OPEN=1`). Settings and conversations live in `~/.codesplainer`.

Development (API on 4777, Vite UI with hot reload on 5173 or the next free port):

```bash
npm run dev
npm run check      # typecheck + lint + all tests
```

Troubleshooting (`npm run doctor` checks both):

- **"Cannot find native binding"** (Vite/rolldown) or a missing `@esbuild/*` package: npm 11.5–11.6 deletes platform-specific packages when `npm install` runs a second time in a workspace ([npm/cli#8536](https://github.com/npm/cli/issues/8536)). Reinstall with `rm -rf node_modules packages/*/node_modules package-lock.json && npm install`, and upgrade npm (`npm install -g npm@11`, or any npm >= 11.7) so it doesn't happen again. `npm run dev`, `build` and `test` refuse to start with a clear message while packages are missing.
- **Out of file watchers** (`EMFILE: too many open files, watch`): `npm run dev` detects this and falls back to polling (file changes are then noticed a moment later). To fix it permanently on Linux, raise the limit: `echo fs.inotify.max_user_instances=512 | sudo tee /etc/sysctl.d/60-inotify.conf && sudo sysctl --system`.

The diagram components have a playground with sample diagrams in both themes: run the web dev server and open `/playground.html`.

## Agents

Codesplainer finds the CLIs on your `PATH`, and also the binaries bundled with the VS Code, Cursor, Kiro and Windsurf extensions. Pick one per question in the ask bar; the default and per-agent options are in **Settings → Providers**. Each agent card has **Test** and **Re-detect** buttons.

| Agent | How it runs | Notes |
|---|---|---|
| **Kiro CLI** | `kiro-cli acp` with a private read-only agent (read, grep and glob tools only, no MCP servers). | Model list comes from the CLI. Log in once with `kiro-cli login`. |
| **Claude Code** | `claude -p --output-format stream-json` with the `Read`/`Grep`/`Glob` tools, `--json-schema` output and `--permission-mode dontAsk`. | Forks sessions for follow-ups. Reports cost. |
| **Codex** | `codex exec --json -s read-only --output-schema …` | Forks sessions for follow-ups. Your Codex MCP servers are switched off per run. |
| **Custom ACP agent** | Any agent that speaks the Agent Client Protocol over stdio, e.g. `opencode acp`. | Only read/search tool permissions are granted, plus shell if you allow it. |
| **Demo (offline)** | No AI: builds diagrams from folders, imports and symbols. | Useful for trying the UI. |

**Codex on Linux:** if its bubblewrap sandbox can't start on your host, Codex shows as unavailable and says why. The **Run without sandbox** switch makes it usable, but then Codex is only *told* to stay read-only; nothing enforces it.

## How it works

```mermaid
flowchart LR
  UI["Web UI<br/>React + React Flow + ELK"] -- "REST + SSE" --> API["Local server<br/>Fastify on 127.0.0.1"]
  API --> Jobs["Generation queue"]
  Jobs -- "prompt + JSON schema" --> Agents["Provider layer"]
  Agents -- "stdio" --> CLIs["kiro-cli · claude · codex · ACP"]
  CLIs -- "read-only tools" --> Code[("Your folders")]
  Jobs -- "normalize + verify refs" --> Store[("~/.codesplainer")]
```

1. A question becomes a diagram entry with an origin (`question`, `expand`, `ask-node`, `ask-graph`, `ask-code`). The origin links it to its parent diagram and box, and that link is what makes a conversation a tree.
2. The prompt includes:
   - the workspace folders;
   - a compact directory tree;
   - the path of questions so far, so the agent keeps the level of detail;
   - the parent diagram and the box being expanded;
   - strict size and word limits.

   The agent explores with read-only tools and answers with one JSON diagram.
3. The server normalizes the answer:
   - it accepts common synonyms and caps sizes;
   - it drops edges that point to boxes that don't exist;
   - it checks every code reference against the file system: missing files are removed and line ranges are clamped.

   If the answer is invalid, the agent gets one repair round. Progress streams to the UI over Server-Sent Events.

## Security model

The server is meant for your machine only:
- It binds to `127.0.0.1` by default and warns you if you bind elsewhere.
- It only accepts requests whose `Host` is localhost and, when an `Origin` header is sent, whose origin is localhost too. This protects against DNS rebinding.
- Every request that changes anything must carry `x-codesplainer: 1`, which stops cross-site form posts.
- File access is limited to your workspace folders: path traversal and symlinks that point outside are rejected.
- Agents run read-only, as described in [Agents](#agents).

There is no authentication, so don't expose the port to a network.

## Project layout

```
packages/
  shared/   zod schemas + types = the contract (diagrams, conversations, API, events, settings),
            diagram normalizer, conversation-tree helpers, Mermaid/Markdown export
  server/   Fastify app
    src/agents/   providers (kiro, claude, codex, acp, mock), prompts, output schema, ACP client
    src/jobs/     queue + generation service     src/fs/  scanning, safe file access, refs
    src/routes/   HTTP API (see shared/src/api.ts) src/storage/  atomic JSON files
  web/      React UI
    src/graph/    diagram canvas, sequence view, conversation map, thumbnails (React Flow + ELK)
    src/panels/   outline, breadcrumbs, inspectors, code viewer, file explorer, ask bar, progress
    src/app, src/screens, src/dialogs, src/store (zustand), src/lib (API client, SSE, router)
```

## Extending

- **New agent CLI:**
  1. Add a module under `packages/server/src/agents/providers/` that implements `AgentProvider` (`detect` + `run`). `acp.ts` and `kiro.ts` show how little an ACP agent needs.
  2. Register it in `agents/registry.ts`.
  3. Add its id to `PROVIDER_IDS` in `packages/shared/src/providers.ts`.
- **New box or edge kind:**
  1. Add it to `packages/shared/src/kinds.ts`, with a hint; the agents see it in the prompt.
  2. Give it an icon and color in `packages/web/src/graph/visuals.ts`.
- **Prompt tuning:** everything the agent is told lives in `packages/server/src/agents/prompt.ts`. The answer's shape is in `agents/schema.ts`.
- **API:** every endpoint is listed in `packages/shared/src/api.ts`, with zod schemas for the request bodies. The server validates requests with those schemas and the web client uses their types.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Ask a question |
| `E` / `Shift E` | Explain & expand the selected box / expand it again |
| `A` | Ask about the selected box |
| Arrow keys, `Enter` | Move between boxes, expand |
| `U` or `Alt ←` | Parent diagram |
| `[` / `]` | Previous / next sibling diagram |
| `M` | Toggle the conversation map |
| `F` | Fit view |
| `Ctrl/⌘ K` | Command palette |
| `Ctrl/⌘ B` | Toggle sidebar |
| `Esc` | Close panel / clear selection |
| `?` | All shortcuts |
