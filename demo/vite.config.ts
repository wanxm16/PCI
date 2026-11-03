import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 7321, strictPort: true },
  preview: { port: 7321, strictPort: true },
  build: { chunkSizeWarningLimit: 3000 },
});
