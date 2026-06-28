# Horus Phase 1-4 Implementation

## Scope

Phases 1, 2, 3, and 4 establish the first native Horus slice inside the VS Code fork:

- local SQLite persistence owned by the Shared Process;
- initial Thoth-compatible domain schema;
- migrations and backup primitives;
- repository layer for workspaces and prompts;
- file mention validation scoped to a workspace path;
- Shared Process IPC channel and workbench client;
- Activity Bar container with Workspaces, Prompts, and Prompt Details views;
- commands to use the current VS Code workspace and create prompts;
- native custom editor for prompt Markdown with file mention validation.

## Architecture

The persistence service is registered in the Shared Process and exposed to the workbench through the `horus/storage` IPC channel. The database is created under the product user data path as `horus.db`, which keeps the storage local to the Horus profile.

Writes go through a single in-process queue. SQLite is configured with WAL mode, short explicit transactions, `busy_timeout`, foreign keys, and a separate read connection. This matches the concurrency requirements from the approved plan without introducing a second native SQLite dependency.

Horus does not ask the user to create a second workspace concept. The VS Code workspace folders opened by the user are the Horus workspaces. The `workspaces` SQLite table is internal metadata/cache used for foreign keys, counts, settings, and future domain relations. The workbench calls `resolveNativeWorkspaces(...)` to get or create metadata records for the currently open VS Code folders.

Prompt editing is implemented as a native Workbench editor pane, not a React route or extension. Opening a prompt creates a `HorusPromptEditorInput`, loads the prompt through `IHorusStorageService`, validates Markdown file mentions through the Shared Process, and saves updates through `updatePrompt(...)`. Each save increments `current_version`, creates a `prompt_versions` row, updates `row_version`, and replaces persisted `prompt_file_references`.

## Implemented Files

- `src/vs/platform/horus/common/horusTypes.ts` defines the initial domain contracts.
- `src/vs/platform/horus/common/horusStorage.ts` defines `IHorusStorageService` and `horus/storage`.
- `src/vs/platform/horus/node/horusSQLiteConnection.ts` owns SQLite connections and PRAGMAs.
- `src/vs/platform/horus/node/horusWriteQueue.ts` serializes writes.
- `src/vs/platform/horus/node/horusMigrationRunner.ts` applies versioned migrations.
- `src/vs/platform/horus/node/migrations/v001_initial.ts` creates the initial schema.
- `src/vs/platform/horus/node/horusBackupService.ts` implements checkpointed backups and restore primitives.
- `src/vs/platform/horus/node/horusStorageService.ts` composes the persistence service.
- `src/vs/platform/horus/common/horusStorageIpc.ts` exposes the server IPC channel.
- `src/vs/platform/horus/electron-browser/horusStorageClient.ts` exposes the workbench IPC client.
- `src/vs/workbench/contrib/horus/browser/horusNativeWorkspaces.ts` maps VS Code workspace folders to Horus metadata.
- `src/vs/workbench/contrib/horus/browser/horus.contribution.ts` registers the initial UI, context keys, and commands.
- `src/vs/workbench/contrib/horus/browser/editors/promptEditor.ts` implements the native prompt editor.
- `src/vs/workbench/contrib/horus/browser/editors/promptEditorInput.ts` implements serializable prompt editor inputs.
- `src/vs/workbench/contrib/horus/browser/views/promptDetailView.ts` renders the selected prompt details.
- `src/vs/workbench/contrib/horus/electron-browser/horus.contribution.ts` registers the desktop remote service.
- `src/vs/platform/horus/test/node/*.test.ts` covers SQLite, migrations, write queue, repositories, IPC, and file mentions.

## Validation

The following checks passed:

- `node --experimental-strip-types src/vs/platform/horus/test/node/sqliteSpike.cts`
- `npm run test-node -- --runGlob "vs/platform/horus/test/node/*.test.js"`
- `npm run typecheck-client`
- `$env:NODE_OPTIONS='--max-old-space-size=8192'; npm run valid-layers-check`
- `npm run compile-client`

`npm run eslint` is not clean because the VS Code header rule requires the standard repository copyright header on new source files. The implementation intentionally does not add copyright or license headers yet; add the repository-standard headers before enforcing full ESLint on this branch.

## Next Phase

The next practical step is Phase 5:

- linked document monitoring with VS Code file watching;
- prompt versions and diffs in native editors;
- workflow templates and prompt workflow execution;
- notebooks, diagrams, future tasks, and AI chat persistence.
