# Tracker Viewer

A fast TypeScript interface for weekly Projects & Enquiries Excel trackers, including the Meeting Details / Agenda, Projects, Middle East Region and Miscellaneous sections.

## Windows installation and build

Install Node.js 22 or newer on the **build computer**. In PowerShell, use `npm.cmd` if PowerShell script execution is restricted:

```powershell
npm.cmd install; if ($LASTEXITCODE -eq 0) { npm.cmd run build }
```

On Windows, `npm run build` automatically typechecks the TypeScript, builds the Vite static website, and creates **`release/TrackerViewer.exe`**. This is a Windows single-executable Node SEA containing its own JavaScript runtime, server and the compiled static site. **The executable does not need Node.js or npm on the computer that runs it.** Double-click the EXE to start a loopback-only HTTP server and automatically open the default browser at `http://127.0.0.1:59413/`. Keep the EXE running while using the page, and close its console window to stop the server. Windows may warn about an unsigned executable.

For local development use `npm.cmd run dev`. To run the built `dist/` site using the standalone TypeScript source server and a local Node installation use `npm.cmd start`. Builds on Linux/macOS create `dist/`, but skip the Windows-specific packaging step. The CI workflow tests both platforms and publishes a Windows EXE as a workflow artefact.

## Editing

The workbook displays as one continuous page. Sidebar links jump to Meeting & Agenda, Projects & Enquiries, Middle East Region, and Miscellaneous. Meeting fields are laid out compactly at the top. Click a cell to edit. Enter saves a short field, while Enter inserts a bullet in multiline notes. Individual note lines, entire projects, agenda lines and complete sections may be marked urgent. Existing red Excel text is recognised as urgent during import.

The **+ New sheet** action clones the previous weekly sheet, retaining its projects and notes, while advancing the meeting date seven days. Each week's data remains independently editable. **Export Excel** downloads a workbook containing a separate Excel worksheet for each week, including the meeting agenda. Styling and urgency flags survive the export. The application does not require Excel formulas.

## Live workbook discovery (no rebuild required)

Place trackers directly in `./public`, or configure a different folder in `.env` beside the project (or next to the EXE):

```env
TRACKER_FOLDER="./public"
```

The local server scans the folder **when the application starts**, whenever you click **Latest**, and every 30 seconds while open. It selects the `.xlsx` workbook with the newest file modification timestamp, ignoring Excel lockfiles starting with `~$` and the old bundled `latest-tracker.xlsx` file. It does not use dates embedded in the filenames. **Adding a workbook does not require another build.** The development server, production `.mts` server and Windows EXE use the same runtime scanner. The EXE will also find `../public` when running from the repository's `release` directory.

When a new workbook appears, the viewer opens it automatically if the workspace is empty or is showing an unchanged runtime tracker. If there are active edits or a restored auto-save draft, the viewer instead displays a **Newest** button to protect the existing work. Click it to confirm switching. The server listens only on `127.0.0.1`.

The **Auto-save** slider is enabled by default and saves an editable draft to browser IndexedDB. It does **not** overwrite the source Excel file. Drafts are restored across page reloads, taking precedence over loading a different workbook without confirmation. Export Excel creates a new `.xlsx` file. **Connect folder** remains available for opening a browser-authorised folder manually.

For an entirely static deployment without the Node local server, the build-time workbook snapshot is a fallback. **Confidentiality:** a staged tracker is included in static build files and in the EXE; do not distribute such builds containing sensitive information. Leave the folder empty when building an executable intended for distribution, and point it at a folder when running it instead.

## Structure

- `index.html`: semantic HTML page skeleton
- `src/ui.ts`: continuous scroll UI, inline editing, notes, urgency, agenda, sheet tabs
- `src/workbook.ts`: ExcelJS workbook parsing, red formatting recognition, multiple weekly sheets and export
- `src/state.ts`: workspace state, filters, active sheet, dirty tracking
- `src/types.ts`: typed tracker model and weekly-sheet cloning
- `src/storage.ts`: persistent IndexedDB browser drafts and saved auto-save setting
- `src/folder.ts`: browser folder access and newest file selection
- `src/main.ts`: application initialisation, file import and export
- `src/styles.css`: responsive design and zebra striping
- `server.mts`: minimal TypeScript static server for `npm start`
- `scripts/standalone.cjs`: browser-opening embedded server runtime used by Node SEA
- `scripts/build-exe.mjs`: Windows Node SEA executable packaging
- `scripts/runtime-tracker.cjs`: shared live local-folder discovery and HTTP endpoints
- `scripts/stage-latest.mjs`: optional build-time snapshot fallback

The application serves only on `127.0.0.1` by default. Override with a valid TCP port using `PORT` if needed.
