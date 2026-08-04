# Grünerator für Excel

AI sidebar add-in for Microsoft Excel, built for Bündnis 90/Die Grünen. This is [netzbegruenung](https://github.com/netzbegruenung)'s fork of [Pi for Excel](https://github.com/tmustier/pi-for-excel), wired up to the [Grünerator](https://github.com/netzbegruenung/Gruenerator) backend so party staff can sign in with their existing Grünerator access instead of bringing their own API keys.

Grünerator für Excel is an AI agent that lives inside Excel. It reads your workbook, makes changes, and does research — through the Grünerator gateway by default, or with your own provider credentials if you prefer.

Deployed at `https://excel.gruenerator.eu`. See [DEPLOYMENT.md](DEPLOYMENT.md) for how the taskpane, the Grünerator backend, and the Docker/Salt rollout fit together, and [docs/upstream-divergences.md](docs/upstream-divergences.md) for where this fork intentionally departs from upstream Pi behavior.

## Features

**Core spreadsheet tools** — 16 built-in tools that the AI can call to interact with your workbook:

| Tool | What it does |
|---|---|
| `get_workbook_overview` | Structural blueprint — sheets, headers, named ranges, tables, charts, pivots |
| `read_range` | Read cells in compact (markdown), CSV, or detailed (with formatting) mode |
| `write_cells` | Write values/formulas with overwrite protection and auto-verification |
| `fill_formula` | AutoFill a formula across a range (relative refs adjust automatically) |
| `search_workbook` | Find text, values, or formula references across all sheets |
| `modify_structure` | Insert/delete rows/columns, add/rename/delete/hide sheets |
| `format_cells` | Apply formatting — fonts, colors, number formats, borders, named styles |
| `conditional_format` | Add or clear conditional formatting rules |
| `trace_dependencies` | Trace formula lineage (precedents upstream or dependents downstream) |
| `explain_formula` | Plain-language formula explanation with cited cell references |
| `view_settings` | Gridlines, headings, freeze panes, tab color, sheet visibility |
| `comments` | Read, add, update, reply, resolve/reopen cell comments |
| `workbook_history` | List/restore automatic in-between-saves backups for workbook mutations |
| `instructions` | Persistent user-level and workbook-level guidance for the AI |
| `conventions` | Configurable formatting defaults (currency, negatives, zeros, decimal places) |
| `skills` | Bundled Agent Skills for task-specific workflows |

**Grünerator gateway** — signs in against the Grünerator backend (`https://gruenerator.eu/api/v1`) so party staff don't need their own model API keys. A custom OpenAI-compatible gateway can still be configured in `/settings` for other providers, and BYO-key/OAuth for Anthropic, OpenAI, Google Gemini, and GitHub Copilot remain available.

**Session management** — multiple session tabs per workbook, auto-save/restore, session history, `/resume` to pick up where you left off.

**Auto-context injection** — the AI automatically receives the workbook blueprint, your current selection, and recent cell changes before every turn. No need to manually describe what you're looking at.

**Workbook recovery** — automatic checkpoints before every mutation. One-click revert from the sidebar if something goes wrong.

**Formatting conventions** — define your house style once (currency symbol, negative style, decimal places) and the AI follows it automatically.

**Slash commands** — `/model`, `/login`, `/settings`, `/rules`, `/extensions`, `/tools`, `/export`, `/compact`, `/new`, `/resume`, `/history`, `/shortcuts`, and more.

**Extensions** — install sidebar extensions (mini-apps) from chat. The AI can generate and install extension code directly via the `extensions_manager` tool. Extensions run in an iframe sandbox by default.

**Integrations** — opt-in external tool integrations:
- **Web Search** (Jina default, Serper/Tavily/Brave) + `fetch_page` — find and read external sources without leaving Excel
- **MCP Gateway** — connect to user-configured MCP servers for custom tool access

**Bridge + advanced controls** (managed via `/experimental`):
- Tmux bridge settings — configure bridge URL/token and run health checks
- Python / LibreOffice bridge settings — configure bridge URL/token
- Files workspace write/delete gate — shared artifact storage across sessions (assistant built-in docs under `assistant-docs/` are always available read-only)
- Advanced extension controls — remote URL opt-in, permission enforcement, sandbox rollback, and Widget API v2

(Web Search + MCP are managed in `/tools`, or `/extensions` → Connections.)

## Install

1. Download [`manifest.prod.xml`](https://excel.gruenerator.eu/manifest.prod.xml)
2. Add it to Excel — see [**install guide**](docs/install.md) for step-by-step instructions (macOS + Windows)
3. Click **Open Grünerator** in the ribbon
4. Sign in with your Grünerator account, or configure a different provider/gateway in `/settings`
5. Start chatting — try `What sheets do I have?` or `Summarize my current selection`

## Developer Quick Start

### Prerequisites

- **Node.js ≥ 22.19.0** (or ≥24), matching `package.json` engines
- **mkcert** — for local HTTPS (required by Office.js)

### Setup

```bash
git clone https://github.com/netzbegruenung/gruenerator-excel.git
cd gruenerator-excel
npm install

# Generate local HTTPS certs (Office.js requires HTTPS)
mkcert -install   # one-time CA setup
mkcert localhost   # creates localhost.pem + localhost-key.pem
mv localhost-key.pem key.pem
mv localhost.pem cert.pem
```

### Run

```bash
npm run dev        # Vite dev server on https://localhost:3141
```

> **Note:** the dev port is `3141` (π) — deliberately off the crowded `:3000`.
> If you sideloaded a manifest before the move from `:3000`, re-copy
> `manifest.xml` into Excel's `wef` folder and fully restart Excel.

> **Optional:** prefer a stable named URL (`https://pi-excel.localhost`, no mkcert, no fixed port)? See [docs/portless.md](./docs/portless.md) for the opt-in [portless](https://portless.sh) flow.

Then sideload the dev manifest into Excel:

**macOS** ([Microsoft docs](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac)):
```bash
cp manifest.xml ~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/
```
Then open Excel → **Insert** → **My Add-ins** → **Grünerator für Excel**.

**Windows** ([Microsoft docs](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins)):

Windows desktop Excel can't upload a manifest directly — it installs from a trusted shared-folder catalog:

1. Share a local folder (folder **Properties** → **Sharing** → **Share**) and note its network path.
2. In Excel: **File** → **Options** → **Trust Center** → **Trust Center Settings** → **Trusted Add-in Catalogs** → add the network path as **Catalog Url**, tick **Show in Menu**, restart Excel.
3. Copy `manifest.xml` into the shared folder.
4. **Home** → **Add-ins** → **Advanced** → **SHARED FOLDER** → **Grünerator für Excel**.

**Excel on the web** ([Microsoft docs](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-office-add-ins-for-testing)):

**Home** → **Add-ins** → **More Settings** → **Upload My Add-in** → select `manifest.xml`.

The dev manifest points to `https://localhost:3141`. The production manifest (`manifest.prod.xml`) points to the hosted deployment at `https://excel.gruenerator.eu`.

### Useful commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server (port 3141, HTTPS) |
| `npm run dev:portless` | Opt-in: dev server behind portless — [docs/portless.md](./docs/portless.md) |
| `npm run build` | Production build → `dist/` |
| `npm run check` | Lint + typecheck + CSS theme checks |
| `npm run typecheck` | TypeScript type checking only |
| `npm run lint` | ESLint |
| `npm run test:models` | Unit tests — model ordering |
| `npm run test:context` | Unit tests — tools, context, sessions, extensions, integrations |
| `npm run test:security` | Security policy tests — proxy, CORS, sandbox, OAuth |
| `npm run proxy:https` | CORS proxy for OAuth flows (default `https://localhost:3003`; random port only if 3003 is busy and no healthy default proxy is already running) |
| `npm run validate` | Validate the Office add-in manifest |

### CORS proxy

Some OAuth token endpoints are blocked by CORS inside Office webviews. If OAuth login fails:

1. Dev/source setup command: `npm run proxy:https` (defaults to `https://localhost:3003`; if 3003 is busy for another service, copy the random port printed in the terminal)
2. In the sidebar → `/settings` → **Proxy** → enable and set the printed URL
3. Retry login

API-key auth and the Grünerator gateway generally work without the proxy.

### Local bridges (Python / tmux)

Real-mode prerequisites:

- `python3` must be installed for `python_run` / `python_transform_range`
- LibreOffice (`soffice` or `libreoffice`) is required for `libreoffice_convert`
- `tmux` is required for the tmux bridge real mode

Run from a source checkout via `npm run python:bridge:https` and `npm run tmux:bridge:https`. Configure `/experimental ...-bridge-url` only when you need a non-default URL.

To force safe simulated mode instead:

- `PYTHON_BRIDGE_MODE=stub npm run python:bridge:https`
- `TMUX_BRIDGE_MODE=stub npm run tmux:bridge:https`

## Architecture

Grünerator für Excel is a single-page Office taskpane add-in built with:

- **[Vite](https://vite.dev/)** — dev server + production bundler
- **[Lit](https://lit.dev/)** — web components for the sidebar UI
- **[pi-agent-core](https://www.npmjs.com/package/@earendil-works/pi-agent-core)** — agent runtime (tool loop, streaming, state management)
- **[pi-ai](https://www.npmjs.com/package/@earendil-works/pi-ai)** — multi-provider LLM abstraction (Anthropic, OpenAI, Google, GitHub Copilot, plus the Grünerator gateway)
- **[pi-web-ui](https://www.npmjs.com/package/@earendil-works/pi-web-ui)** — shared web UI components (message rendering, storage, settings dialogs)
- **[Office.js](https://learn.microsoft.com/en-us/office/dev/add-ins/)** — Excel workbook API

### Source layout

```
src/
├── taskpane/          # App init, session management, tab layout, context injection
├── taskpane.html      # Entry HTML (loads Office.js + taskpane.ts)
├── taskpane.ts        # Entry script
├── boot.ts            # Pre-mount setup (CSS, patches)
├── tools/             # 16 core tools + feature-flagged tools + registry
├── prompt/            # System prompt builder
├── context/           # Workbook blueprint cache, selection/change tracking
├── auth/              # OAuth providers, API proxy, credential restore, Grünerator gateway
├── models/            # Model ordering + version scoring
├── ui/                # Sidebar component, tool renderers, theme CSS
│   └── theme/         # Design tokens, component styles
├── commands/          # Slash command registry + builtins
├── extensions/        # Extension store, sandbox runtime, permissions
├── integrations/      # Web Search + MCP Gateway integration catalog
├── skills/            # Agent Skills catalog + runtime loader
├── experiments/       # Feature flag definitions + toggle logic
├── workbook/          # Workbook identity (hashed), session association, coordinator
├── conventions/       # Formatting defaults (currency, negatives, dp)
├── rules/             # Persistent user/workbook rules store
├── compaction/        # Auto-compaction thresholds + logic
├── storage/           # IndexedDB initialization
├── files/             # Files workspace (read/list always on; write/delete feature-gated)
├── audit/             # Workbook change audit log
├── messages/          # Message conversion helpers
├── debug/             # Debug mode utilities
├── stubs/             # Browser stubs for CSP/Node-only deps (Ajv, Bedrock, stream, etc.)
├── compat/            # Compatibility patches (Lit, marked, model selector)
└── utils/             # Shared helpers (HTML escape, type guards, errors)

scripts/               # Dev helpers — CORS proxy, tmux/python bridges, manifest gen
pkg/proxy/             # Publishable npm CLI package: `pi-for-excel-proxy`
pkg/python-bridge/     # Publishable npm CLI package: `pi-for-excel-python-bridge`
pkg/tmux-bridge/       # Publishable npm CLI package: `pi-for-excel-tmux-bridge`
tests/                 # Unit + security tests
docs/                  # Current docs (install/deploy/features/policy) + archive/ for historical plans
skills/                # Bundled Agent Skill definitions (web-search, mcp-gateway, tmux-bridge, python-bridge)
public/assets/         # Add-in icons (16/32/80/128px)
```

### Key design patterns

- **Tool registry as single source of truth** — `src/tools/registry.ts` defines all core tool names and construction. UI renderers, input humanizers, and prompt docs all derive from it.
- **Workbook coordinator** — serializes mutating tool calls per-workbook to prevent concurrent writes from multiple session tabs.
- **Auto-context** — the workbook blueprint, selection state, and recent changes are injected before each user message so the AI always knows what it's looking at.
- **Execution policy** — each tool is classified as `read/none` or `mutate/content|structure` to determine locking and checkpoint behavior.
- **Recovery checkpoints** — mutations automatically snapshot affected cells before writing, enabling one-click rollback.
- **Extension sandbox** — untrusted extensions (inline code, remote URLs) run in an iframe sandbox by default; built-in/local modules run on the host.

## Deployment

The production build is a static Vite bundle, containerized (`Dockerfile`, `docker/`) and shipped via GitHub Actions (`.github/workflows/build-image.yml`) to `ghcr.io/netzbegruenung/gruenerator-excel`, then rolled out through the `gruenerator-docker` Salt state to `https://excel.gruenerator.eu`.

Model access goes to the Grünerator backend (`netzbegruenung/Gruenerator`, repo) at `https://gruenerator.eu/api/v1` — cross-origin from the taskpane, so both the CSP `connect-src` and the backend CORS allowlist must include `excel.gruenerator.eu`. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full rollout, allowlist, and API-key details.

Users install by downloading `manifest.prod.xml` and uploading it in Excel — the manifest points to the hosted deployment. Updates are automatic (close and reopen the taskpane).

## Documentation

| Doc | Description |
|---|---|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Grünerator-specific rollout: hosting, CORS/CSP allowlists, Salt states, API keys |
| [docs/install.md](docs/install.md) | Non-technical install guide |
| [docs/upstream-divergences.md](docs/upstream-divergences.md) | Where this fork intentionally diverges from upstream Pi behavior |
| [docs/extensions.md](docs/extensions.md) | Extension authoring guide |
| [docs/integrations-external-tools.md](docs/integrations-external-tools.md) | Web Search + MCP integration setup |
| [docs/security-threat-model.md](docs/security-threat-model.md) | Security threat model |
| [docs/compaction.md](docs/compaction.md) | Session compaction (`/compact`) |
| [src/tools/DECISIONS.md](src/tools/DECISIONS.md) | Tool behavior decisions log |
| [src/ui/README.md](src/ui/README.md) | UI architecture + Tailwind v4 notes |
| [ROLLOUT.md](ROLLOUT.md) | Rollout plan / status |

## Credits

This is a fork of [Pi for Excel](https://github.com/tmustier/pi-for-excel) by [@tmustier](https://github.com/tmustier) (Thomas Mustier), adapted for Bündnis 90/Die Grünen with a Grünerator-backed gateway and a Docker/Salt deployment instead of Vercel. See [docs/upstream-divergences.md](docs/upstream-divergences.md) for the details.

- [Pi](https://github.com/badlogic/pi-mono) by [@badlogic](https://github.com/badlogic) (Mario Zechner) — the agent framework powering this project. Uses pi-agent-core, pi-ai, and pi-web-ui for the agent loop, LLM abstraction, and session storage.
- [whimsical.ts](https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/whimsical.ts) by [@mitsuhiko](https://github.com/mitsuhiko) (Armin Ronacher) — the rotating "Working…" messages are adapted from his Pi extension, rewritten for a spreadsheet/finance audience.

## License

[MIT](LICENSE) © Thomas Mustier, with modifications by netzbegruenung
