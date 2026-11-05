import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import deployment from './vercel.json' with { type: 'json' };
import { readFileSync } from 'node:fs';

const productionHeaders = Object.fromEntries(deployment.headers[0].headers.map(h => [h.key, h.value]));

export default defineConfig({
  plugins: [react(), {
    name: 'licence-notices',
    generateBundle() {
      for (const name of ['LICENSE', 'NOTICE']) this.emitFile({ type: 'asset', fileName: `legal/${name}.txt`, source: readFileSync(new URL(name, import.meta.url), 'utf8') });
    },
  }],
  server: { headers: { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' } },
  preview: { headers: { ...productionHeaders, 'Cache-Control': 'no-cache' } },
  build: { chunkSizeWarningLimit: 1500 },
});
