// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';

const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
const problems = [];
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['credential', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{32,})\b/],
  ['local home path', /\/(?:home|Users)\/[A-Za-z0-9_.-]+\//],
];
for (const file of files) {
  if (lstatSync(file).isSymbolicLink()) { problems.push(`${file}: symlinks are not release inputs`); continue; }
  if (/(^|\/)(?:\.env(?:\..*)?|credentials\.json|serviceAccount.*\.json)$/.test(file) && file !== '.env.example') problems.push(`${file}: private configuration filename`);
  if (/\.(?:pem|key)$/.test(file)) problems.push(`${file}: key file`);
  const data = readFileSync(file);
  if (data.includes(0)) continue;
  const text = data.toString('utf8');
  for (const [name, pattern] of rules) if (pattern.test(text)) problems.push(`${file}: ${name}`);
  if (/\.(?:md|tsx?|mjs|css|html|py)$/.test(file) && /[\u2013\u2014]/u.test(text)) problems.push(`${file}: typographic dash`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`Checked ${files.length} release files for private configuration, obvious credentials and copy rules.`);
