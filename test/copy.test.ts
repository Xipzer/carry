// Copyright (c) 2026 Xipz. Licensed under Apache-2.0.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx|css)$/.test(path) ? [path] : [];
  });
}
const files = [...sourceFiles('src'), 'index.html', 'README.md', 'BRAND_ASSETS.md', 'DEPENDENCIES.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', ...sourceDocs('docs')];
function sourceDocs(directory: string): string[] {
  return readdirSync(directory).filter(name => name.endsWith('.md')).map(name => join(directory, name));
}

describe('application wording', () => {
  it('uses plain punctuation in authored copy without changing official artwork', () => {
    const punctuation = /[\u2013\u2014\u2018\u2019\u201c\u201d\u2026\u00b7\u2190-\u2193]/u;
    for (const file of files) expect(readFileSync(file, 'utf8'), file).not.toMatch(punctuation);
  });
  it('does not restore removed slogans or vague fee labels', () => {
    const phrases = ['without the detour', 'one last look', 'right where it belongs', 'a clean slate', 'simple on the surface', 'a little patience', 'no guesswork', 'keep it simple', 'a few simple settings', 'pick up where you left off', 'bridge + delivery fee'];
    const copy = sourceFiles('src').map(file => readFileSync(file, 'utf8').toLowerCase()).join('\n');
    for (const phrase of phrases) expect(copy).not.toContain(phrase);
  });
});
