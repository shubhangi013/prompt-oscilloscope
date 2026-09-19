import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverInstructionContext, extractReferencedPaths } from '../src/context/discovery.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('instruction discovery', () => {
  it('includes repository contribution rules', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oscope-context-'));
    temporary.push(root);
    await mkdir(join(root, '.git'));
    await writeFile(join(root, 'CONTRIBUTING.md'), 'Run focused tests before submitting.');

    const context = await discoverInstructionContext(root, 'Update the parser');

    expect(context.files).toContain('CONTRIBUTING.md');
    expect(context.content).toContain('Run focused tests before submitting.');
  });

  it('loads root and applicable nested AGENTS.md files for an @file target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oscope-context-'));
    temporary.push(root);
    await mkdir(join(root, '.git'));
    await mkdir(join(root, 'src', 'feature'), { recursive: true });
    await writeFile(join(root, 'AGENTS.md'), 'root rule');
    await writeFile(join(root, 'src', 'AGENTS.md'), 'source rule');
    await writeFile(join(root, 'src', 'feature', 'file.ts'), 'export {};');

    const prompt = 'Review @src/feature/file.ts';
    expect(extractReferencedPaths(prompt, root)).toHaveLength(1);
    const context = await discoverInstructionContext(root, prompt);

    expect(context.files).toContain('AGENTS.md');
    expect(context.files).toContain('src/AGENTS.md');
    expect(context.content).toContain('root rule');
    expect(context.content).toContain('source rule');
  });

  it('honors applyTo and reports context truncation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oscope-context-'));
    temporary.push(root);
    await mkdir(join(root, '.git'));
    await mkdir(join(root, '.github', 'instructions'), { recursive: true });
    await writeFile(join(root, 'main.ts'), 'export {};');
    await writeFile(
      join(root, '.github', 'instructions', 'typescript.instructions.md'),
      '---\napplyTo: "**/*.ts"\n---\n' + 'rule '.repeat(100),
    );

    const context = await discoverInstructionContext(root, '@main.ts', { maxContextChars: 80 });
    expect(context.files).toEqual(['.github/instructions/typescript.instructions.md']);
    expect(context.truncated).toBe(true);
    expect(context.content.length).toBe(80);
  });
});
