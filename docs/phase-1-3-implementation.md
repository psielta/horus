# Horus Phase 1-3 Implementation

## Scope

Phases 1, 2, and 3 establish the first native Horus slice inside the VS Code fork:

- local SQLite persistence owned by the Shared Process;
- initial Thoth-compatible domain schema;
- migrations and backup primitives;
- repository layer for workspaces and prompts;
- file mention validation scoped to a workspace path;
- Shared Process IPC channel and workbench client;
- Activity Bar container with Workspaces and Prompts views;
- commands to create workspaces and prompts.

## Architecture

The persistence service is registered in the Shared Process and exposed to the workbench through the `horus/storage` IPC channel. The database is created under the product user data path as `horus.db`, which keeps the storage local to the Horus profile.

Writes go through a single in-process queue. SQLite is configured with WAL mode, short explicit transactions, `busy_timeout`, foreign keys, and a separate read connection. This matches the concurrency requirements from the approved plan without introducing a second native SQLite dependency.

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
- `src/vs/workbench/contrib/horus/browser/horus.contribution.ts` registers the initial UI and commands.
- `src/vs/workbench/contrib/horus/electron-browser/horus.contribution.ts` registers the desktop remote service.

## Validation

The following checks passed:

- `node --experimental-strip-types src/vs/platform/horus/test/node/sqliteSpike.cts`
- `npm run typecheck-client`
- `$env:NODE_OPTIONS='--max-old-space-size=8192'; npm run valid-layers-check`
- `npm run compile-client`

`npm run eslint` is not clean because the VS Code header rule requires the standard repository copyright header on new source files. The implementation intentionally does not add copyright or license headers yet; add the repository-standard headers before enforcing full ESLint on this branch.

## Next Phase

The next practical step is to expand the repository/service surface beyond workspaces and prompts:

- linked documents;
- prompt versions and diffs in native editors;
- workflow templates and prompt workflow execution;
- notebooks, diagrams, future tasks, and AI chat persistence.
