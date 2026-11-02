import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Two builds from one source:
 *   npm run build      -> static/panel/build       (Forge Custom UI, inside Jira)
 *   npm run build:web  -> static/panel/build-web   (standalone host, plain browser)
 */
const standalone = process.env.VITE_STANDALONE === 'true';

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __STANDALONE__: JSON.stringify(standalone),
  },
  build: {
    outDir: standalone ? 'build-web' : 'build',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    fs: { allow: ['..', '../..', '../../..'] },
  },
});
