import { defineConfig } from 'vite';
import { handleTrackerRequest } from './scripts/runtime-tracker.mts';

export default defineConfig({
  base: './',
  // Runtime tracker files are served only by the local scanner, never bundled or published.
  publicDir: false,
  build: { target: 'es2022', cssCodeSplit: false },
  plugins: [{
    name: 'live-local-trackers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!handleTrackerRequest(req, res, { root: process.cwd() })) next();
      });
    },
  }],
});
