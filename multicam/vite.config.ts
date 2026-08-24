import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  // Tauri serves the built assets from a fixed port in dev.
  server: { port: 1420, strictPort: true },
  build: { target: 'chrome110', sourcemap: false },
  clearScreen: false,
});
