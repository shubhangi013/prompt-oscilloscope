import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { HistoryStore } from '../src/history/store.js';
import { resultWith } from './helpers.js';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('history store', () => {
  it('migrates, records, lists, and deletes local history', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oscope-history-'));
    temporary.push(root);
    const store = new HistoryStore(join(root, 'history.db'));
    const result = resultWith();
    const id = store.record('exact prompt', result, { required: false, reasons: [] }, true);

    expect(store.list()).toEqual([
      expect.objectContaining({ id, prompt: 'exact prompt', analysis: result, sent: true }),
    ]);
    expect(store.delete(id)).toBe(true);
    expect(store.list()).toEqual([]);
    store.close();
  });
});
