import { describe, expect, it, vi } from 'vitest';

import { runDeterministicChecks } from '../src/analysis/deterministic.js';
import { AnalysisEngine } from '../src/analysis/engine.js';
import type { JevAnalyzer } from '../src/analysis/jev-client.js';
import { confirmationDecision } from '../src/analysis/thresholds.js';
import type { AnalysisInput, InstructionContext } from '../src/analysis/types.js';
import { DemoJevAnalyzer } from '../src/demo/services.js';
import { resultWith } from './helpers.js';

const context: InstructionContext = { content: '', files: [], hash: 'empty', truncated: false };

describe('demo analysis', () => {
  it('uses question-specific signal labels', async () => {
    const result = await new DemoJevAnalyzer().analyze(
      { prompt: 'Summarize this repository briefly', context },
      new AbortController().signal,
    );

    expect(result.signals.targetContext.label).toBe('identified');
    expect(result.signals.constraints.label).toBe('partial');
    expect(result.signals.successCriteria.label).toBe('implied');
    expect(result.signals.expectedBehavior.label).toBe('read');
  });
});

describe('deterministic checks', () => {
  it('detects empty prompts and common credential forms outside Jev', () => {
    expect(runDeterministicChecks('   ')).toContainEqual(expect.objectContaining({ id: 'empty' }));
    expect(runDeterministicChecks('token=abcdefghijklmnopqrstuvwxyz')).toContainEqual(
      expect.objectContaining({ id: 'possible-secret', level: 'risk' }),
    );
  });
});

describe('confirmation thresholds', () => {
  it('requires confirmation when aggregate risk crosses the threshold', () => {
    const result = resultWith({
      risk: {
        label: 'none',
        confidence: 0.7,
        probabilities: {
          none: 0.7,
          destructive: 0.06,
          credential: 0.06,
          deployment: 0.06,
          privacy: 0.06,
          multiple: 0.06,
        },
      },
    });
    expect(confirmationDecision(result)).toEqual({ required: true, reasons: ['risk'] });
  });
});

describe('analysis engine', () => {
  it('cancels a stale debounced request and caches the fresh result', async () => {
    const analyze = vi.fn((input: AnalysisInput) =>
      Promise.resolve({
        model: 'jev-1.13.0',
        usage: { input: input.prompt.length, output: 1 },
        signals: resultWith().signals,
      }),
    );
    const engine = new AnalysisEngine({ analyze } satisfies JevAnalyzer, { debounceMs: 5 });
    const stale = engine.analyze({ prompt: 'old', context });
    const fresh = engine.analyze({ prompt: 'new', context });

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    const first = await fresh;
    const cached = await engine.analyze({ prompt: 'new', context });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(cached).toBe(first);
  });
});
