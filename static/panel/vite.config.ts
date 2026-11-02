import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'build',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    fs: {
      // The panel imports shared DTO types from the app root.
      allow: ['..', '../..', '../../..'],
    },
  },
});
