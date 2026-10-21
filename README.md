# Tracker Viewer

A fast, local weekly Projects & Enquiries Excel tracker editor with a TypeScript frontend and a **Bun-powered standalone Windows executable**.

## Install and build on Windows

Install [Bun](https://bun.com/docs/installation) and, if you want the `npm.cmd` command, Node.js/npm on your development computer. Then, in PowerShell:

```powershell
bun install; if ($LASTEXITCODE -eq 0) { npm.cmd run build }
```

You can also use `bun run build` directly. If that exact `release/TrackerViewer.exe` is already running, the build stops it before packaging, because Windows cannot replace a running executable. The build validates TypeScript, runs the no-nested-`if` / no-explicit-`any` / no-JavaScript-source guard, runs Bun tests, builds the Vite frontend and packages `release/TrackerViewer.exe` with Bun's compiler.

**The EXE does not require Bun, Node.js or npm on the computer running it.** Double-click it. By default it listens on `127.0.0.1:59413`, creates a Windows Internet Shortcut (`TrackerViewer.url`) beside the EXE, and opens that **shortcut file** using your default browser; it has **no Command Prompt window** (`windows.hideConsole: true`). Windows may warn about an unsigned application. Relaunching the EXE finds the process holding the local port, confirms it is another `TrackerViewer.exe`, terminates only that older application and then starts a fresh server. If another program owns the port, it is left untouched and the error is logged. If the EXE directory is not writable, the shortcut is created under `%LOCALAPPDATA%\TrackerViewer`. To stop the app, click **Quit application** in the top bar; this saves the browser draft when auto-save is enabled and shuts down the local server. Alternatively, use Task Manager or run `Get-Process TrackerViewer -ErrorAction SilentlyContinue | Stop-Process` in PowerShell. If the browser does not launch, open `http://127.0.0.1:59413/` manually. If startup fails, check `TrackerViewer.log` beside the executable, when writable.

To run the app without packaging, build the frontend first and use `bun run start`. For frontend development use `bun run dev`.

## Browse every weekly workbook in the tracker folder

The pill bar lists **all** `.xlsx` workbooks directly inside `TRACKER_FOLDER` (excluding Excel `~# Tracker Viewer

A fast, local weekly Projects & Enquiries Excel tracker editor with a TypeScript frontend and a **Bun-powered standalone Windows executable**.

## Install and build on Windows

Install [Bun](https://bun.com/docs/installation) and, if you want the `npm.cmd` command, Node.js/npm on your development computer. Then, in PowerShell:

```powershell
bun install; if ($LASTEXITCODE -eq 0) { npm.cmd run build }
```

You can also use `bun run build` directly. If that exact `release/TrackerViewer.exe` is already running, the build stops it before packaging, because Windows cannot replace a running executable. The build validates TypeScript, runs the no-nested-`if` / no-explicit-`any` / no-JavaScript-source guard, runs Bun tests, builds the Vite frontend and packages `release/TrackerViewer.exe` with Bun's compiler.

**The EXE does not require Bun, Node.js or npm on the computer running it.** Double-click it. By default it listens on `127.0.0.1:59413`, creates a Windows Internet Shortcut (`TrackerViewer.url`) beside the EXE, and opens that **shortcut file** using your default browser; it has **no Command Prompt window** (`windows.hideConsole: true`). Windows may warn about an unsigned application. Relaunching the EXE finds the process holding the local port, confirms it is another `TrackerViewer.exe`, terminates only that older application and then starts a fresh server. If another program owns the port, it is left untouched and the error is logged. If the EXE directory is not writable, the shortcut is created under `%LOCALAPPDATA%\TrackerViewer`. To stop the app, click **Quit application** in the top bar; this saves the browser draft when auto-save is enabled and shuts down the local server. Alternatively, use Task Manager or run `Get-Process TrackerViewer -ErrorAction SilentlyContinue | Stop-Process` in PowerShell. If the browser does not launch, open `http://127.0.0.1:59413/` manually. If startup fails, check `TrackerViewer.log` beside the executable, when writable.

To run the app without packaging, build the frontend first and use `bun run start`. For frontend development use `bun run dev`.

 temporary files), ordered by filename/date. Each date pill switches to that file; multiple worksheets inside a file have a separate worksheet row. Auto-save always targets the selected source workbook, not whichever workbook was most recently modified. Switching away from unsaved changes waits for auto-save to finish, or is blocked with a warning. The bar refreshes with the folder scan every 30 seconds and after creating a dated file. Choosing an older file pauses automatic switching to new weeks; click **Latest** to resume. 

## Live folder discovery: no rebuild needed

The server scans for the newest `.xlsx` **every time the page requests the current manifest**. By default it uses `public/` beside the EXE, or `public/` in the source project when running from that directory. Put Excel trackers there at any time. The browser checks for a changed tracker every 30 seconds and offers to open it if you have an edited draft, or automatically opens it if there are no unsaved edits to protect.

To configure another location, place an `.env` alongside `TrackerViewer.exe` (or in the project root) containing:

```dotenv
IP=127.0.0.1
PORT=59413
TRACKER_FOLDER="./public"
```

`IP` and `PORT` are read when the server starts, without recompiling the EXE. The default browser shortcut and port-replacement check use the configured address and port. `bun run dev` and `bun run start` use the same settings. Use `127.0.0.1` for local-only access; setting a LAN address or `0.0.0.0` exposes the tracker and its spreadsheets to other devices on that network without authentication. LAN clients can open `http://<server-LAN-IP>:59413/` and save directly to the configured workbook; the save endpoint permits requests to the machine's assigned IPv4 addresses at the configured port. This does not provide access control: everyone who can reach that port can read or alter the tracker. Restart the app after changing either setting.

Paths are relative to the directory containing that `.env`; absolute paths also work. Latest means **last modified timestamp**, not the date in the filename. Excel temporary files beginning `~$` and the old `latest-tracker.xlsx` snapshot are ignored. The scanner does not watch subfolders recursively.

A new workbook does **not** need another `npm run build`, nor a server restart. You can use **Latest** to request an immediate scan. In Chrome/Edge you may also use **Connect folder**, which gives the browser direct read-only folder access.

**Security:** Workbook files are not copied into `dist/` or embedded in the EXE. Vite's public-directory copying is disabled intentionally. The runtime HTTP endpoint is bound to the configured IP address; with `IP=0.0.0.0` it accepts unauthenticated connections from other devices on your network. Never forward this port to the public Internet. Auto-save (enabled by default) writes changes asynchronously back to the original `.xlsx` selected from the runtime folder or through a browser file handle. A recovery draft is also cached in IndexedDB. The first runtime write creates a `.tracker-viewer-original.bak` copy beside the source; saves are written to a temporary file and replaced atomically. Concurrent/external edits or locked files stop the write and leave the draft intact, with an on-screen error. **Export Excel** is optional and downloads a separate copy. Supported cell edits update the original `.xlsx` without requiring Export.

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

## Writing directly to Excel files

The **Auto-save** toggle is on by default and performs real, asynchronous writes to the original Excel file for supported edits while preserving the original worksheet layout. Adding/removing individual rows and some structural or section-wide formatting changes in complex worksheets are deliberately blocked rather than risking damage to the Excel template; those edits remain in the browser recovery draft until a layout-safe mapping is implemented. The local HTTP server accepts a same-origin, revision-checked XLSX upload and replaces **only** the current workbook in `TRACKER_FOLDER`. A `.tracker-viewer-original.bak` recovery copy is created before the first overwrite (not overwritten subsequently).

**Open file** and **Connect folder** in Chrome/Edge request the File System Access API write permission and can save the selected file directly. A legacy file upload picker is read-only and cannot write to the source; the app explicitly warns about this rather than claiming Excel was saved. Browser storage still holds a recovery draft, not the primary copy. Files already open in Excel may be locked, in which case the write fails visibly and the recovery draft remains.

**New sheet** creates a new, dated `.xlsx` file in the configured tracker folder by copying the source workbook and changing its meeting date. The previous file remains intact. **Export Excel** downloads a separate copy; when an original workbook is available, export also uses layout-preserving cell patches.

## Starting a new weekly workbook

**New sheet** duplicates the current week's data and uses the date on which you click it (your computer's local date), not the next Monday. It creates a **new Excel file** in `TRACKER_FOLDER` using the current workbook's name, for example `Weekly Projects Tracker (2026-10-21).xlsx`. The previous file is not modified by creating a new week. If the dated filename already exists, a numbered suffix is added rather than overwriting it. The newly created file becomes the active auto-save target. This automatic file creation requires the active workbook to have been opened from the configured server folder (use **Latest**); a browser-only file picker cannot create a sibling file without additional folder access.


## Preserving the existing Excel layout

The original XLSX remains the layout source of truth. Saves modify only mapped worksheet cells in its OpenXML parts, preserving existing merge ranges, table parts, widths, heights, styles and non-worksheet content. The server independently rejects candidate XLSX files that modify workbook structure or formatting definitions; it will not accept older clients' re-generated workbooks. If you edit a row that cannot be mapped safely or insert/delete rows, the app reports an error and retains the browser recovery draft instead of changing the XLSX. Do not use the earlier builds that regenerated entire workbooks for production data. Existing backups are not altered by the new version.
