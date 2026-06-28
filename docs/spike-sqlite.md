# SQLite Spike

## Decision

Use `@vscode/sqlite3` for Horus persistence.

The spike confirmed that both candidates can use WAL mode, `busy_timeout`, `foreign_keys`, short transactions, and a separate read connection. `better-sqlite3` was slightly faster in the micro-benchmark, but it adds a second native SQLite dependency and was built for Electron ABI during `npm install`, which made it fail under the terminal Node.js runtime. Because `@vscode/sqlite3` is already part of VS Code and is already packaged by upstream, it is the lower-risk choice for the fork.

## Repository Findings

- VS Code already depends on `@vscode/sqlite3` in `package.json`.
- `src/vs/base/parts/storage/node/storage.ts` dynamically imports `@vscode/sqlite3`.
- VS Code storage already supports `PRAGMA journal_mode=WAL` through `useWAL`.
- VS Code storage already supports `PRAGMA busy_timeout=...`.
- Storage access is exposed to renderers through IPC clients/channels in `src/vs/platform/storage/common/storageIpc.ts` and `src/vs/platform/storage/electron-main/storageIpc.ts`.

## Spike Command

The runtime benchmark script lives at:

```powershell
src/vs/platform/horus/test/node/sqliteSpike.cts
```

For the full two-library spike:

```powershell
npm install --no-save better-sqlite3
$env:ELECTRON_RUN_AS_NODE='1'
& .build/electron/Horus.exe --experimental-strip-types src/vs/platform/horus/test/node/sqliteSpike.cts
Remove-Item Env:\ELECTRON_RUN_AS_NODE
npm uninstall better-sqlite3
```

## Measured Result

Environment:

- Runtime: `.build/electron/Horus.exe` with `ELECTRON_RUN_AS_NODE=1`
- Node reported by Electron runtime: `v24.15.0`
- Platform: `win32 x64`
- Database directory: `%APPDATA%\.horus`
- Rows inserted per transaction: `1000`

Results:

| Library | Version | WAL | `foreign_keys` | Read During Write | Rows | Elapsed |
|---------|---------|-----|----------------|-------------------|------|---------|
| `@vscode/sqlite3` | `5.1.12-vscode` | `wal` | `1` | `0` rows in `20ms` | `1000` | `166ms` |
| `better-sqlite3` | `12.11.1` | `wal` | `1` | `0` rows in `25ms` | `1000` | `137ms` |

Both libraries allowed a separate read-only connection to read the last committed snapshot while an uncommitted write transaction was open.

## `better-sqlite3` ABI Result

After `npm install better-sqlite3 --save`, running the script with terminal Node failed:

```text
The module ... better_sqlite3.node was compiled against a different Node.js version using NODE_MODULE_VERSION 146.
This version of Node.js requires NODE_MODULE_VERSION 137.
```

The same script worked when run through `.build/electron/Horus.exe` with `ELECTRON_RUN_AS_NODE=1`, which indicates the module was built for the Electron runtime ABI. That is acceptable for product runtime, but it adds friction for scripts/tests and increases packaging risk.

## Build Verification

`npm run compile-client` was attempted after the spike. It failed inside upstream `extensions/simple-browser/esbuild.webview.mts` with a Go/esbuild memory allocation failure:

```text
fatal error: runtime: cannot allocate memory
```

No TypeScript error from Horus code was reached in that run. Because the compile failed before product packaging, `npm run gulp vscode-win32-x64` was not a useful validation point for the additional native dependency. This reinforces the decision to avoid adding `better-sqlite3` to the final dependency tree.

## Implementation Implications

- Use one Horus-owned write connection with serialized writes.
- Use a separate read connection for short read transactions where useful.
- Apply these PRAGMAs on each connection:
  - `PRAGMA journal_mode = WAL`
  - `PRAGMA busy_timeout = 5000`
  - `PRAGMA foreign_keys = ON`
  - `PRAGMA synchronous = NORMAL`
  - `PRAGMA wal_autocheckpoint = 1000`
- Keep all SQL behind repositories/DAOs.
- Keep secrets out of SQLite and use VS Code secret storage/keychain.
