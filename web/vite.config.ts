import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // The API is same-origin in the browser, so no CORS dance during development.
    proxy: { '/api': { target: 'http://127.0.0.1:5174', changeOrigin: true } },
  },
});
