import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(directory, 'src/extension.ts')],
  outfile: join(directory, 'dist/extension.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  sourcesContent: false,
});
