import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const webRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(webRoot, '..', '..');
const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  // 素材目录即静态根：/cards/*.png、/characters/*、/cards-manifest.json 等
  publicDir: resolve(projectRoot, 'assets'),
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
