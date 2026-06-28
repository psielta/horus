# Prompt para Codex - Continuar desenvolvimento do Horus

## Contexto

Voce esta trabalhando no repositorio `C:\repos\horus`, que e um fork do VS Code (microsoft/vscode) chamado **Horus**. O objetivo e migrar todas as funcionalidades de um projeto chamado Thoth (ASP.NET Core + React, em `C:\repos\Thoth`) para dentro deste fork do VS Code como produto nativo (nao extensao).

## O que ja foi feito (Fase 0 - completa)

1. Fork criado: github.com/psielta/horus (branch `horus/main`)
2. Build funciona: `npm run compile-client` compila com 0 erros
3. Branding aplicado: `product.json` renomeado para Horus, `Horus.exe` funciona
4. AGENTS.md criado com instrucoes de build e plano

## Plano detalhado

Leia o plano completo em: `C:\Users\dolf\.claude\plans\wise-discovering-kite.md`
Leia tambem: `C:\repos\horus\AGENTS.md`

## Sua tarefa: executar Fase 0.5 e Fases 1-3

### Fase 0.5 - Spike SQLite

Decidir entre `better-sqlite3` (sync, nao esta no VS Code) e `@vscode/sqlite3` (async, ja esta).

1. Criar branch `spike/sqlite-lib` a partir de `horus/main`
2. Estudar como o VS Code usa SQLite internamente:
   - Ler `src/vs/base/parts/storage/` (camada de storage)
   - Ler `src/vs/platform/storage/` (servico de storage)
   - Identificar: PRAGMAs usados, processo dono, como IPC e feito
3. Testar `better-sqlite3`:
   - Adicionar ao `package.json`
   - Rodar `npm install` (use `export vs2022_install="C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools"` e `export npm_config_cache="$HOME/.npm-cache"`)
   - Criar script de teste minimo que:
     - Abre banco em `%APPDATA%\.horus\spike.db`
     - Configura WAL, busy_timeout=5000, foreign_keys=ON
     - Cria tabela, insere 1000 rows em transacao
     - Testa read connection separada (segunda conexao read-only lendo enquanto a primeira escreve)
     - Mede tempo e verifica integridade
4. Testar `@vscode/sqlite3` com o mesmo cenario (async com Promises)
5. Verificar empacotamento: `npm run gulp vscode-win32-x64` (se `better-sqlite3` nao empacotar, descartar)
6. Documentar resultado em `docs/spike-sqlite.md`
7. Fazer merge do resultado para `horus/main`

Criterios de decisao:
- Compila com MSVC v143? Funciona com Electron? Empacota no build?
- Suporta WAL + busy_timeout + foreign_keys?
- Transacoes sincronas curtas funcionam?
- Read connection separada funciona (duas conexoes, WAL)?

Se `better-sqlite3` funciona → usar. Senao → usar `@vscode/sqlite3` com wrapper async.

### Fase 1 - Persistencia SQLite

Criar a camada completa de persistencia. Ver detalhes no plano (`wise-discovering-kite.md` secao "Fase 1").

Pontos criticos:
- Servico dono do banco roda no **Shared Process** (NAO no main, NAO no renderer)
- PRAGMAs: WAL, busy_timeout=5000, foreign_keys=ON, synchronous=NORMAL
- Write queue serializada (async mutex) - todas as escritas passam por ela
- Leituras fora da fila (se read connection separada funcionar no spike)
- Migrations versionadas: `PRAGMA user_version` + tabela `_horus_migrations`
- Backup pre-migration: pausar fila → checkpoint WAL → SQLite backup API → rodar migration → se falhar restaurar
- Repositorios/DAO: um por dominio, zero SQL fora
- Segredos NUNCA no SQLite - usar SecretStorageService
- Schema gerado a partir das EF Configurations em `C:\repos\Thoth\backend\src\Thoth.Infrastructure\Persistence\Configurations\`

Estrutura:
```
src/vs/platform/horus/
  common/horusStorage.ts, horusTypes.ts, horusRepository.ts, horusMigration.ts
  node/horusSQLiteConnection.ts, horusMigrationRunner.ts, horusWriteQueue.ts, horusBackupService.ts
  node/repositories/ (prompt, workspace, linkedDocument, workflow, notebook, diagram, futureTask, chat)
  node/migrations/v001_initial.ts
  electron-main/horusStorageChannel.ts
  electron-sandbox/horusStorageClient.ts
  test/node/ (testes unitarios)
```

### Fase 2 - Servicos Core

- `src/vs/platform/horus/common/horusTypes.ts` - traduzir entidades C# do Thoth para TypeScript
- `src/vs/platform/horus/node/horusStorageService.ts` - servico no Shared Process
- `src/vs/platform/horus/node/horusFileValidationService.ts` - validacao de @mentions

### Fase 3 - Primeira UI

- Registrar ViewContainer na activity bar com icone Horus
- Sidebar com duas secoes: Workspaces e Prompts
- Commands: `Horus: Create Workspace`, `Horus: Create Prompt`
- `src/vs/workbench/contrib/horus/browser/horus.contribution.ts` - entry point
- Import em `src/vs/workbench/workbench.desktop.main.ts`
- Prompts listam apenas raiz (rootOnly=true)

## Regras

1. Use Conventional Commits. Faca push apos cada mudanca logica.
2. Todo codigo Horus em `src/vs/platform/horus/` e `src/vs/workbench/contrib/horus/`
3. Minimo possivel de mudancas em arquivos upstream
4. Use os padroes internos do VS Code (DI, IInstantiationService, createDecorator, IChannel, Event<T>)
5. Compile com `npm run compile-client` e teste lancando `Horus.exe`
6. Para build: `export vs2022_install="C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools"` e `export npm_config_cache="$HOME/.npm-cache"`
