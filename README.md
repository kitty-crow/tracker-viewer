# Tracker Viewer

A fast, local weekly Projects & Enquiries Excel tracker editor with a TypeScript frontend and a **Bun-powered standalone Windows executable**.

## Install and build on Windows

Install [Bun](https://bun.com/docs/installation) and, if you want the `npm.cmd` command, Node.js/npm on your development computer. Then, in PowerShell:

```powershell
bun install; if ($LASTEXITCODE -eq 0) { npm.cmd run build }
```

You can also use `bun run build` directly. The build validates TypeScript, runs the no-nested-`if` / no-explicit-`any` / no-JavaScript-source guard, runs Bun tests, builds the Vite frontend and packages `release/TrackerViewer.exe` with Bun's compiler.

**The EXE does not require Bun, Node.js or npm on the computer running it.** Double-click it. It launches a local-only server on `127.0.0.1:59413`, opens your default browser automatically and has **no Command Prompt window** (`windows.hideConsole: true`). Windows may warn about an unsigned application. To stop the app, click **Quit application** in the top bar; this saves the browser draft when auto-save is enabled and shuts down the local server. Alternatively, use Task Manager or run `Get-Process TrackerViewer -ErrorAction SilentlyContinue | Stop-Process` in PowerShell. If the browser does not launch, open `http://127.0.0.1:59413/` manually. If startup fails, check `TrackerViewer.log` beside the executable, when writable.

To run the app without packaging, build the frontend first and use `bun run start`. For frontend development use `bun run dev`.

## Live folder discovery: no rebuild needed

The server scans for the newest `.xlsx` **every time the page requests the current manifest**. By default it uses `public/` beside the EXE, or `public/` in the source project when running from that directory. Put Excel trackers there at any time. The browser checks for a changed tracker every 30 seconds and offers to open it if you have an edited draft, or automatically opens it if there are no unsaved edits to protect.

To configure another location, place an `.env` alongside `TrackerViewer.exe` (or in the project root) containing:

```dotenv
TRACKER_FOLDER="./public"
```

Paths are relative to the directory containing that `.env`; absolute paths also work. Latest means **last modified timestamp**, not the date in the filename. Excel temporary files beginning `~$` and the old `latest-tracker.xlsx` snapshot are ignored. The scanner does not watch subfolders recursively.

A new workbook does **not** need another `npm run build`, nor a server restart. You can use **Latest** to request an immediate scan. In Chrome/Edge you may also use **Connect folder**, which gives the browser direct read-only folder access.

**Security:** Workbook files are not copied into `dist/` or embedded in the EXE. Vite's public-directory copying is disabled intentionally. The runtime HTTP endpoint is bound to loopback, so only local clients can request the current workbook. The editor auto-saves drafts to the browser's IndexedDB, and **Export Excel** downloads an edited workbook; the original workbook is not silently overwritten.

## Interface

Meeting details and agenda are displayed at the top, followed by Projects & Enquiries, Middle East Region and Miscellaneous in one continuous page. The left-hand menu jumps to each section. Edit cells and note lines directly, flag urgent items, use field filters, and duplicate the weekly sheet with the meeting date advanced by one week. Table cells retain their size during editing, and rows use alternating background colours.

## Developer workflow

```sh
bun install
bun run validate
bun run build
```

Validation follows the guard and test conventions in `xmrig-automator`:

- `bun run typecheck`: TypeScript `tsc --noEmit` using strict compiler flags.
- `bun run guard`: bans explicit `any`, nested `if` statements and `.js` / `.cjs` / `.mjs` source files.
- `bun test`: Bun unit tests for live folder discovery.

The application source is `.ts` / `.mts`. Built frontend JavaScript output in `dist/` is generated and excluded from Git.

Important files: `index.html`, `src/*`, `vite.config.ts`, `scripts/runtime-tracker.mts`, `scripts/standalone.mts`, `scripts/build-exe.mts`, `scripts/guard.mts`, `test/runtime-tracker.test.mts`.
