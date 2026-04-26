import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    // Avoid permission issues when `node_modules/.vite` was created by a different user (e.g. via sudo).
    cacheDir: '.vite-cache',
    plugins: [
      react({
        babel: {
          // Prevent noisy "[BABEL] deoptimised styling" logs for large prebundled deps in dev.
          generatorOpts: { compact: true },
        },
      }),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify - file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      allowedHosts: [
        'dash.sribalaji.eu.org'
      ]
    },
  };
});
