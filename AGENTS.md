# AGENTS.md - Horus (Fork do VS Code)

## O que e o Horus

Horus e um fork do VS Code (como Cursor) para gerenciar, versionar e acompanhar prompts Markdown usados com agentes de IA. Migra as funcionalidades do projeto Thoth (ASP.NET Core + React em `C:\repos\Thoth`) para dentro do VS Code como produto nativo.

## Plano Completo

O plano detalhado e aprovado de todas as fases esta em:
**`C:\Users\dolf\.claude\plans\wise-discovering-kite.md`**

Leia esse arquivo antes de comecar qualquer fase. Ele contem:
- Matriz de paridade Thoth → Horus (controllers, rotas, recursos nativos)
- Arquitetura de processos (Shared Process, IPC, write queue)
- Requisitos de concorrencia SQLite (10 requisitos obrigatorios)
- Schema completo das tabelas
- Estrategia de backup, migrations, checkpoint WAL
- Riscos e mitigacoes
- Roadmap completo (Fases 0-12)

## Estado Atual

**Fase 0 concluida:**
- Fork do microsoft/vscode como psielta/horus
- Branch principal: `horus/main`
- Branding aplicado em `product.json` (Horus.exe funciona)
- Build compila com `npm run compile-client` (0 erros)
- Remotes: `origin` = psielta/horus, `upstream` = microsoft/vscode

**Proximo: Fase 0.5 (spike SQLite)**

## Build (Windows 11)

Variaveis obrigatorias:
```bash
export vs2022_install="C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools"
export npm_config_cache="$HOME/.npm-cache"
```

Compilar:
```bash
npm run compile-client    # VS Code core (sem Copilot)
```

Executar em dev:
```bash
export VSCODE_SKIP_PRELAUNCH=1 NODE_ENV=development VSCODE_DEV=1 VSCODE_CLI=1
".build/electron/Horus.exe" . --skip-getting-started
```

Nota: `npm run compile` falha no `compile-copilot` (bug upstream com Node 24 e glob import). Use `compile-client`.

## Convencao de codigo

Todo codigo Horus vive em:
```
src/vs/platform/horus/           -> Servicos de plataforma (SQLite, IPC)
src/vs/workbench/contrib/horus/  -> Contribuicoes de UI (views, paineis)
```

Modificar o **minimo possivel** de arquivos upstream do VS Code para facilitar rebases.

## Commits

Use Conventional Commits. Faca push apos cada mudanca logica.

---

## Proximas Fases (resumo - detalhes no plano)

### Fase 0.5 - Spike SQLite (PROXIMA)

Objetivo: decidir entre `better-sqlite3` (sync) e `@vscode/sqlite3` (async, ja no VS Code).

Procedimento:
1. Criar branch `spike/sqlite-lib`
2. Estudar como o VS Code ja usa SQLite internamente:
   - `src/vs/base/parts/storage/` - camada de storage
   - `src/vs/platform/storage/` - servico de storage
   - Entender PRAGMAs usados, processo dono, IPC
3. Adicionar `better-sqlite3` ao `package.json`, verificar compilacao
4. Criar script de teste em `src/vs/platform/horus/test/node/sqliteSpike.ts`:
   - Abrir banco em `%APPDATA%\.horus\spike.db`
   - Configurar: `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;`
   - Criar tabela, inserir 1000 rows em transacao, ler concorrentemente
   - Medir tempo, verificar integridade
   - Testar read connection separada (segunda conexao read-only)
5. Repetir teste com `@vscode/sqlite3` (async com Promises)
6. Testar build de producao: `npm run gulp vscode-win32-x64`
7. Documentar resultado em `docs/spike-sqlite.md`

Criterios:
- Compila com MSVC v143 + Spectre libs
- Funciona com Electron do VS Code (ABI match)
- Empacota no build de producao
- Suporta WAL, busy_timeout, foreign_keys
- Transacoes sincronas curtas
- Read connection separada funciona

### Fase 1 - Arquitetura de Persistencia SQLite

Ver plano completo em `C:\Users\dolf\.claude\plans\wise-discovering-kite.md` secao "Fase 1".

Resumo: servico dono do banco no Shared Process, write queue serializada, WAL mode, migrations versionadas com backup, camada Repository/DAO, schema completo.

### Fase 2 - Primeiros Servicos Core

Tipos de dominio TypeScript, HorusStorageService, validacao de @mentions.

### Fase 3 - Primeira UI

Activity bar, sidebar (Workspaces + Prompts), commands, registration.

---

## Projeto de referencia (Thoth)

O Thoth em `C:\repos\Thoth` contem a implementacao de referencia:
- Backend: `backend/src/Thoth.Api/Controllers/` (15 controllers)
- Domain: `backend/src/Thoth.Domain/`
- EF Configs: `backend/src/Thoth.Infrastructure/Persistence/Configurations/`
- Frontend: `frontend/src/` (React + TipTap + Monaco)
- Schemas: `frontend/src/api/schemas.ts`

Regras de negocio que devem ser mantidas:
- Prompts de plano vinculado sao filhos do prompt pai
- Lista do workspace mostra apenas prompts raiz (rootOnly=true)
- Prompt filho abre em drawer, nao navega para rota de edicao
- Mencoes de arquivos validadas
- Planos vinculados com historico versionado
- Prompt arquivado para de monitorar plano vinculado
- Segredos/API keys NUNCA no SQLite - usar SecretStorageService (OS keychain)
