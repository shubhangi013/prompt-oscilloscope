import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { InstructionContext } from '../analysis/types.js';

const DEFAULT_MAX_CONTEXT_CHARS = 64_000;
const MAX_FILE_CHARS = 16_000;

export interface DiscoveryOptions {
  readonly maxContextChars?: number;
  readonly personalInstructionsPath?: string;
}

function findProjectRoot(cwd: string): string {
  let current = resolve(cwd);
  for (;;) {
    if (existsSync(join(current, '.git')) || existsSync(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

export function extractReferencedPaths(prompt: string, cwd: string): string[] {
  const paths = new Set<string>();
  const reference = /@(?:"([^"]+)"|'([^']+)'|([^\s,;]+))/gu;
  for (const match of prompt.matchAll(reference)) {
    const raw = (match[1] ?? match[2] ?? match[3])?.replace(/#L\d+(?:-L?\d+)?$/u, '');
    if (!raw || raw.includes('://')) continue;
    const absolute = resolve(cwd, raw);
    if (existsSync(absolute)) paths.add(absolute);
  }
  return [...paths];
}

function within(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function agentFilesFor(root: string, target: string): string[] {
  if (!within(root, target)) return [];
  const files: string[] = [];
  let current = existsSync(target) ? dirname(target) : target;
  while (within(root, current)) {
    const file = join(current, 'AGENTS.md');
    if (existsSync(file)) files.push(file);
    if (current === root) break;
    current = dirname(current);
  }
  return files.reverse();
}

async function instructionFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  const visit = async (path: string): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const child = join(path, entry.name);
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile() && entry.name.endsWith('.instructions.md')) files.push(child);
      }),
    );
  };
  await visit(directory);
  return files.sort();
}

function globMatches(pattern: string, path: string): boolean {
  const globstarDirectory = '\u0000';
  const globstar = '\u0001';
  const source = pattern
    .trim()
    .replaceAll('\\', '/')
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replaceAll('**/', globstarDirectory)
    .replaceAll('**', globstar)
    .replaceAll('*', '[^/]*')
    .replaceAll('?', '[^/]')
    .replaceAll(globstarDirectory, '(?:.*/)?')
    .replaceAll(globstar, '.*');
  return new RegExp(`^${source}$`, 'u').test(path.replaceAll('\\', '/'));
}

function appliesTo(content: string, targets: readonly string[]): boolean {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/u.exec(content)?.[1];
  if (!frontmatter) return true;
  const value = /^applyTo:\s*["']?(.+?)["']?\s*$/imu.exec(frontmatter)?.[1];
  if (!value) return true;
  const patterns = value.split(',').map((pattern) => pattern.trim());
  return targets.some((target) => patterns.some((pattern) => globMatches(pattern, target)));
}

function displayPath(root: string, path: string): string {
  if (within(root, path)) return relative(root, path).replaceAll('\\', '/');
  const home = homedir();
  if (within(home, path)) return `~/${relative(home, path).replaceAll('\\', '/')}`;
  return path;
}

export async function discoverInstructionContext(
  cwd: string,
  prompt: string,
  options: DiscoveryOptions = {},
): Promise<InstructionContext> {
  const root = findProjectRoot(cwd);
  const references = extractReferencedPaths(prompt, cwd);
  const targets = references.length > 0 ? references : [cwd];
  const relativeTargets = targets
    .filter((path) => within(root, path))
    .map((path) => relative(root, path));
  const candidates = new Set<string>();

  const personal = options.personalInstructionsPath ?? process.env.OSCOPE_PERSONAL_INSTRUCTIONS;
  if (personal) candidates.add(resolve(personal));
  candidates.add(join(homedir(), '.copilot', 'copilot-instructions.md'));
  candidates.add(join(homedir(), '.github', 'copilot-instructions.md'));
  candidates.add(join(root, 'CONTRIBUTING.md'));
  candidates.add(join(root, '.github', 'copilot-instructions.md'));
  for (const target of targets) {
    for (const file of agentFilesFor(root, target)) candidates.add(file);
  }

  const scoped = await instructionFiles(join(root, '.github', 'instructions'));
  const selected: Array<{ path: string; content: string }> = [];
  for (const path of [...candidates, ...scoped]) {
    if (!existsSync(path)) continue;
    const content = await readFile(path, 'utf8');
    if (scoped.includes(path) && !appliesTo(content, relativeTargets)) continue;
    selected.push({ path, content: content.slice(0, MAX_FILE_CHARS) });
  }

  const maxChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const sections: string[] = [];
  const files: string[] = [];
  let used = 0;
  let truncated = false;
  for (const file of selected) {
    const name = displayPath(root, file.path);
    const section = `## ${name}\n${file.content}`;
    const remaining = maxChars - used;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    sections.push(section.slice(0, remaining));
    files.push(name);
    used += Math.min(section.length, remaining);
    if (section.length > remaining) {
      truncated = true;
      break;
    }
  }

  const content = sections.join('\n\n');
  return {
    content,
    files,
    hash: createHash('sha256').update(content).digest('hex'),
    truncated,
  };
}
