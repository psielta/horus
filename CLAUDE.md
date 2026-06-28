# CLAUDE.md - Horus

Instrucoes para Claude Code trabalhar neste projeto.

## Antes de Comecar

1. Leia `AGENTS.md` para entender o estado atual e as proximas fases.
2. Leia o plano completo em `C:\Users\dolf\.claude\plans\wise-discovering-kite.md`.
3. Verifique `git status --short` e o branch atual.
4. Entenda se a tarefa pede plano, revisao ou implementacao.

## Sobre o Projeto

Horus e um fork do VS Code (como Cursor) que implementa as funcionalidades do Thoth (prompt management) nativamente dentro do editor. O projeto de referencia esta em `C:\repos\Thoth`.

O diferencial do Horus e ser um IDE completo com:
- Gerenciamento de prompts Markdown com versionamento
- Workspaces conectados a diretorios locais com validacao de @mentions
- Monitoramento de planos Markdown externos (linked plans)
- Workflow/kanban com fases e atores
- Hierarquia de prompts pai-filho
- AI chat integrado (Gemini)
- Notebooks, diagramas e tarefas futuras
- Tudo persistido em SQLite local (local-first)

## Stack

- Base: Fork do VS Code (Electron + TypeScript)
- Persistencia: SQLite embutido (local-first, WAL mode)
- UI: Componentes nativos do VS Code (ViewPane, TreeView, WebviewPanel, Custom Editor)
- Padroes: DI do VS Code (createDecorator, IInstantiationService), IPC channels, Event<T>

## Build

```bash
export vs2022_install="C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools"
export npm_config_cache="$HOME/.npm-cache"
npm run compile-client
```

Executar:
```bash
export VSCODE_SKIP_PRELAUNCH=1 NODE_ENV=development VSCODE_DEV=1 VSCODE_CLI=1
".build/electron/Horus.exe" . --skip-getting-started
```

## Convencao de Codigo

- Todo codigo Horus em `src/vs/platform/horus/` (servicos) e `src/vs/workbench/contrib/horus/` (UI)
- Minimo possivel de mudancas em arquivos upstream do VS Code
- Seguir padroes internos do VS Code: DI, IChannel, Event<T>, createDecorator
- Camada Repository/DAO para SQL - zero SQL espalhado pelo codigo
- Segredos/API keys: SecretStorageService (OS keychain), NUNCA no SQLite

## Regras que Nao Devem Ser Quebradas

- Prompts de plano vinculado sao filhos do prompt pai
- Lista do workspace mostra apenas prompts raiz (rootOnly=true)
- Prompt filho abre em painel lateral, nao navega para rota separada
- Mencoes de arquivos devem ser validadas
- Planos vinculados mantidos com historico versionado
- Prompt arquivado para de monitorar plano vinculado
- Banco SQLite tem unico dono (Shared Process), renderers acessam via IPC
- Escritas serializadas por fila, transacoes curtas
- WAL mode, busy_timeout, foreign_keys obrigatorios

## Commits

- Conventional Commits, sem Co-Authored-By
- Commits separados por mudanca logica
- Push apos cada commit

## Pontos de Atencao

- Se alterar persistencia, atualizar migration e repositorios
- Se alterar servicos IPC, atualizar channel e client
- Se alterar UI, compilar com `npm run compile-client` e testar lancando Horus.exe
- O `npm run compile` falha no `compile-copilot` (bug upstream) - use `compile-client`
- preinstall.ts exige `vs2022_install` apontando para o VS Build Tools instalado
