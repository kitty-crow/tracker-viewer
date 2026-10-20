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

## Auto-save and loading

The **Auto-save** slider is enabled by default. It automatically saves the current editable workspace in this browser's IndexedDB after changes, and restores it on the next visit. This is **browser draft storage, not an automatic overwrite of the original Excel file**. Export Excel to create an `.xlsx` copy or share a workbook. Disabling auto-save leaves existing drafts intact but stops subsequent draft writes.

Open an Excel workbook using **Open file**, or **Connect folder** using Chrome/Edge. The authorised browser folder lets **Latest** find the newest workbook without rebuilding. Browser permissions are needed for direct folder access. To load the latest workbook on each build, copy `.env.example` to `.env` and configure `TRACKER_FOLDER` on the build computer. The build script stages the latest `.xlsx` in `dist/`. That same snapshot is embedded in the compiled Windows EXE. If a saved browser draft exists, it is restored preferentially to protect changes.

**Confidentiality:** embedding the tracker in the website or executable includes the actual workbook bytes. Do not publish or distribute builds containing sensitive workbooks. Leave `TRACKER_FOLDER` empty to use user-authorised file opening without embedding data.

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
- `scripts/stage-latest.mjs`: build-time `.env` tracker discovery

The application serves only on `127.0.0.1` by default. Override with a valid TCP port using `PORT` if needed.
