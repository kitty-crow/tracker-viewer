import { createRequire } from 'node:module';
import { defineConfig } from 'vite';

const require = createRequire(import.meta.url);
const runtime = require('./scripts/runtime-tracker.cjs') as {
  handleRequest: (req: unknown, res: unknown, options: {root: string}) => boolean;
};

export default defineConfig({
  base: './',
  build: { target: 'es2022', cssCodeSplit: false },
  plugins: [{
    name: 'live-local-trackers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!runtime.handleRequest(req, res, {root: process.cwd()})) next();
      });
    }
  }]
});
