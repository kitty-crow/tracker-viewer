# Tracker Viewer

A fast, local-first TypeScript editor for weekly Excel projects and enquiries trackers. No backend, account, database or Excel installation is required. The UI uses a proper HTML shell with modular TypeScript and CSS, and exports a professionally styled `.xlsx` workbook.

## Get started

```sh
bun install
bun run dev
```

Alternatively use `npm install` and `npm run dev`. Open the local URL shown by Vite. For a production build:

```sh
bun run build
bun run preview
```

`npm run build` also works. The finished website is in `dist/` and can be hosted as static files. Excel processing is loaded only when needed.

## Local static server (production build)

Build first, then serve the finished `dist/` directory using the included dependency-free Node.js server:

```powershell
npm.cmd run build; if ($LASTEXITCODE -eq 0) { npm.cmd start }
```

Open http://127.0.0.1:59413/. The server binds exclusively to `127.0.0.1`, not your network interfaces. Optional: set `PORT` to another TCP port in the range 1 to 65535. Port `79413` is not valid. The server reads `dist/` only, does not run a backend API and does not save browser edits automatically.

## Auto-load a folder

Copy `.env.example` to `.env`, then configure the folder **on the machine that builds the site**:

```env
TRACKER_FOLDER="C:/Users/YourName/Documents/Trackers"
```

Run `bun run build` (or `bun run dev`). The newest `.xlsx` file in that directory, selected by modification time, is included as the initial snapshot. Files starting with `~$` are ignored. The folder path is **not** exposed in the generated site. Rebuild to update that snapshot. **Privacy warning:** this places a copy of the workbook into `dist/latest-tracker.xlsx`. Anyone who can access your hosted static site can download that file. Do not publish this build publicly if the workbook contains confidential business information. For sensitive files, leave `TRACKER_FOLDER` empty and use the browser folder connector on your local machine instead.

For live local folder loading without rebuilding, use **Connect folder** in Chrome or Edge on `localhost` or HTTPS. Give permission when prompted; the permissioned folder handle is retained in the browser's IndexedDB. The editor attempts to open the newest workbook from that folder on future visits when permission remains granted. **Latest** checks again. Browsers will not allow a static website to silently access arbitrary local filesystem paths from an environment variable.

## Editing workflow

1. Open an `.xlsx` tracker, connect a folder, or use the embedded build-time snapshot.
2. Use the left navigation for **Projects & enquiries**, **Middle East region**, **Miscellaneous**, and **Meeting details**.
3. Click any cell to edit. Use **Enter** to save a short text field, or press **Enter** to add a new bullet in longer notes. Click outside a cell to save it.
4. Add projects or enquiries, sort headers, search or combine field filters.
5. Use **!** on a row or section to mark it urgent. The **☷** notes editor marks individual lines urgent with red foreground. The urgent-only filter finds flagged items.
6. **Export Excel** downloads a new workbook. The original is never overwritten.

### Excel compatibility

The supplied weekly template contains a main tabular section, a block-form Middle East region, miscellaneous notes, and meeting information, including merged cells. All these logical sections are imported. Export normalises the content into consistently styled `Projects`, `Middle East`, `Miscellaneous` and `Meeting` sheets, with Excel AutoFilters and a hidden `_TrackerViewer` sheet to round-trip urgency flags. This deliberately does **not** reproduce the original merged-cell page layout, which makes future editing easier.

Other workbooks with equivalent `Client`, `Project No`, `Overview` and/or `Updates` headers are supported; arbitrary unrelated spreadsheets or `.xls` binaries are not. Excel macros are not preserved. Formula evaluation is intentionally not implemented.

## Project structure

- `index.html`: accessible application skeleton
- `src/main.ts`: file loading, exporting, initialisation
- `src/folder.ts`: browser folder permissions and automatic latest-file discovery
- `src/workbook.ts`: Excel import, template adaptation and export
- `src/types.ts`: typed tracker model and shared helpers
- `src/state.ts`: in-memory state, dirty tracking and filtering state
- `src/ui.ts`: rendering, direct cell edits, notes and urgency interactions
- `src/styles.css`: responsive visual design
- `scripts/stage-latest.mjs`: build-time folder handling with no server

## Privacy

Everything runs locally in the user's browser. A configured build folder is accessed only by the local build script. Opening or exporting a workbook never uploads it to a backend. As with other purely client-side editors, changes live in memory until **Export Excel**; do not close the page with unsaved changes.
