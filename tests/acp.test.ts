import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { CopilotAcpClient, type TimelineEvent } from '../src/acp/client.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('ACP client', () => {
  it('streams events and forwards the original prompt byte-for-byte', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'oscope-acp-'));
    temporary.push(cwd);
    const output = join(cwd, 'prompt.txt');
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-agent.mjs');
    const events: TimelineEvent[] = [];
    const client = new CopilotAcpClient({
      cwd,
      command: process.execPath,
      commandArgs: [fixture, output],
      onEvent: (event) => events.push(event),
    });
    const prompt = 'first line\r\n  second line  \nΩ';

    await client.connect();
    const response = await client.sendPrompt(prompt);
    const commandResponse = await client.sendPrompt('/plan');
    await client.close();

    expect(response.stopReason).toBe('end_turn');
    expect(commandResponse.stopReason).toBe('end_turn');
    expect(await readFile(output, 'utf8')).toBe(`${prompt}/plan`);
    expect(events).toContainEqual(expect.objectContaining({ type: 'update' }));
  });
});
