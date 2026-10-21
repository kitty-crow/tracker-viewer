import { defineConfig } from 'vite';
import { handleTrackerRequest } from './scripts/runtime-tracker.mts';
import { listenerConfig } from './scripts/server-config.mts';
import { handleSaveRequest, SAVE_PATH } from './scripts/save-tracker.mts';

const listener = listenerConfig({ appRoot: process.cwd() });

export default defineConfig({
  base: './',
  server: { host: listener.ip, port: listener.port, strictPort: true },
  preview: { host: listener.ip, port: listener.port, strictPort: true },
  // Runtime tracker files are served only by the local scanner, never bundled or published.
  publicDir: false,
  build: { target: 'es2022', cssCodeSplit: false },
  plugins: [{
    name: 'live-local-trackers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (new URL(req.url ?? '/', listener.browserUrl).pathname === SAVE_PATH) {
          void handleSaveRequest(req, res, { root: process.cwd() }, new URL(listener.browserUrl).origin);
          return;
        }
        if (!handleTrackerRequest(req, res, { root: process.cwd() })) next();
      });
    },
  }],
});
