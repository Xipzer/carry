// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
for (const group of ['dependencies', 'devDependencies']) {
  for (const [name, version] of Object.entries(manifest[group] ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(version) || lock.packages[''][group]?.[name] !== version) throw new Error(`Unpinned or unsynchronised dependency: ${name}`);
  }
}
if (manifest.overrides) throw new Error('Dependency overrides require a separate compatibility review, not an advisory bypass.');
for (const args of [['ls', '--all', '--json'], ['audit', '--include=dev', '--json'], ['audit', '--omit=dev', '--json']]) {
  const result = spawnSync('npm', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 4_000_000 });
  if (result.error) throw result.error;
  const report = JSON.parse(result.stdout || '{}');
  if (result.status !== 0 || report.error || (args[0] === 'ls' && report.problems?.length) || (args[0] === 'audit' && report.metadata?.vulnerabilities?.total !== 0)) {
    console.error(result.stdout, result.stderr);
    throw new Error(`Dependency release gate failed: npm ${args.join(' ')}`);
  }
  console.log(args[0] === 'audit' ? `npm ${args.join(' ')}: 0 known vulnerabilities` : 'Installed dependency tree matches the pinned lockfile');
}
