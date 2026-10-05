// Runs the game server (tsx watch) and the Vite dev server together.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'server/index.ts'], { stdio: 'inherit', shell: process.platform === 'win32' }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && stop());
console.log('\n  GetRich Tycoon dev: open http://localhost:5173 (game server on :3000)\n');
