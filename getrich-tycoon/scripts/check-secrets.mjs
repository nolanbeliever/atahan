// Fails if something that looks like a secret is tracked in this project.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const patterns = [
  // Credentials in a connection string, except obvious placeholders (USER:PASSWORD, user:pass) and local test DBs.
  { name: 'Postgres URL with password', re: /postgres(ql)?:\/\/(?!(user|USER):(pass|password|PASSWORD)@)[^\s:@/]+:[^\s@/]+@(?!127\.0\.0\.1|localhost|HOST|host)/ },
  { name: 'Private key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Generic API key assignment', re: /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i },
];
const problems = [];
for (const f of files) {
  if (f.endsWith('package-lock.json') || f.startsWith('node_modules/')) continue;
  if (!fs.existsSync(f) || fs.statSync(f).size > 1_000_000) continue;
  if (f === '.env' || f.endsWith('/.env')) problems.push(`${f}: .env files must never be committed`);
  const text = fs.readFileSync(f, 'utf8');
  for (const p of patterns) if (p.re.test(text)) problems.push(`${f}: ${p.name}`);
}
if (problems.length) {
  console.error('Possible secrets found:\n' + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log(`No secrets found in ${files.length} tracked files.`);
