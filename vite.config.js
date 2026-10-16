import { defineConfig } from 'vite';

// In development, forward /api requests to the Express server.
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
