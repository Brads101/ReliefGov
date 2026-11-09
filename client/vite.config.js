import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Never fall back to 5174+: the API only allows the http://localhost:5173
    // origin (CORS), so a second instance on another port would always fail
    // at login. Fail loudly on a port conflict instead of spawning a shadow dev server.
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://localhost:4000',
        changeOrigin: true
      }
    }
  }
});
