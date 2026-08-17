import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        waiter: resolve(__dirname, 'waiter.html'),
      },
    },
  },
  server: {
    port: 3000,
    host: true,
    allowedHosts: true
  }
});

