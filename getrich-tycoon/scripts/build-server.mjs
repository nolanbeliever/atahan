// Bundles the TypeScript server (+ shared code) into dist/server/index.js.
// Runtime dependencies stay external and are resolved from node_modules.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/index.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  banner: { js: '// GetRich Tycoon server bundle' },
});
