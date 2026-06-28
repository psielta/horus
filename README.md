# Horus

Horus is a VS Code fork (like Cursor) designed for managing, versioning, and tracking Markdown prompts used with AI development agents (Claude Code, Codex, Grok).

## What is Horus?

Horus is a full IDE built on top of VS Code that adds native prompt engineering capabilities:

- **Prompt Management** - Create, version, and organize Markdown prompts with `@file` mention validation
- **Workspace Integration** - Connect prompts to local directories with file reference validation
- **Linked Plan Monitoring** - Track external Markdown plans with real-time file watching and version history
- **Workflow/Kanban** - Manage prompt lifecycle with customizable phases and actor assignments
- **Parent-Child Prompts** - Hierarchical prompt organization with generation from templates
- **AI Chat** - Integrated Gemini chat for prompt refinement and assistance
- **Notebooks & Diagrams** - Notes and Mermaid/Excalidraw diagram support
- **Local-First Storage** - SQLite embedded database with robust concurrency architecture

## Based on VS Code

Horus is a fork of [Visual Studio Code](https://github.com/microsoft/vscode) and inherits all of VS Code's features: editor, terminal, git integration, extensions, debugging, and more.

## Building from Source

### Prerequisites (Windows 11)

- Node.js (check `.nvmrc` for exact version)
- Python 3.11+
- Visual Studio Build Tools with C++ workload and Spectre-mitigated libraries
- `npm install -g node-gyp gulp-cli`

### Build

```bash
export vs2022_install="C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools"
export npm_config_cache="$HOME/.npm-cache"

npm install
npm run compile-client
```

### Run

```bash
export VSCODE_SKIP_PRELAUNCH=1 NODE_ENV=development VSCODE_DEV=1 VSCODE_CLI=1
".build/electron/Horus.exe" . --skip-getting-started
```

## Project Structure

Horus-specific code lives in dedicated directories:

```
src/vs/platform/horus/           # Platform services (SQLite, IPC)
src/vs/workbench/contrib/horus/  # UI contributions (views, panels)
```

## Development Status

This project is in early development. See `AGENTS.md` for the current phase plan.

## License

[MIT](LICENSE.txt)

## Upstream

This project is a fork of [microsoft/vscode](https://github.com/microsoft/vscode). The upstream remote is maintained for periodic rebases.
