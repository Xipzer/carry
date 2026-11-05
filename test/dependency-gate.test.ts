// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { mkdtempSync, writeFileSync, chmodSync, rmSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';

// A local fake npm makes the online gate's failure modes reproducible without
// contacting the registry, changing the lockfile, or installing bad packages.
const directory = mkdtempSync(join(tmpdir(), 'carry-dependency-gate-'));
const npm = join(directory, 'npm');
writeFileSync(npm, `#!${process.execPath}
const mode = process.env.CARRY_TEST_NPM_MODE, args = process.argv.slice(2);
if (mode === 'malformed') { console.log('not JSON'); process.exit(0); }
if (mode === 'network' && args[0] === 'audit') { console.log(JSON.stringify({ error: { code: 'EAI_AGAIN' } })); process.exit(1); }
if (args[0] === 'ls') { console.log(JSON.stringify(['tree', 'tree-exit-zero'].includes(mode) ? { problems: ['invalid dependency'] } : { dependencies: {} })); process.exit(mode === 'tree' ? 1 : 0); }
const total = mode === 'advisory' || (mode === 'production' && args.includes('--omit=dev')) ? 1 : 0;
console.log(JSON.stringify({ metadata: { vulnerabilities: { low: total, total } } }));
// Deliberately exit 0 even with a low-severity advisory, as an audit-level
// configuration could do. The release gate must inspect the actual report.
`);
chmodSync(npm, 0o700);
afterAll(() => { rmSync(npm); rmdirSync(directory); });

function gate(mode: string) {
  return spawnSync(process.execPath, ['scripts/check-dependencies.mjs'], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, CARRY_TEST_NPM_MODE: mode },
  });
}
describe('dependency release gate fails closed', () => {
  it('accepts a consistent tree and two clean advisory responses', () => {
    const result = gate('clean'); expect(result.status).toBe(0); expect(result.stdout.match(/0 known vulnerabilities/g)).toHaveLength(2);
  });
  it.each(['advisory', 'production', 'network', 'malformed', 'tree', 'tree-exit-zero'])('rejects %s even without moving funds or changing installed dependencies', mode => {
    const result = gate(mode); expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
  });
});
