import { signalIds, type AnalysisResult, type SignalResult } from '../src/analysis/types.js';

export function resultWith(
  overrides: Partial<Record<(typeof signalIds)[number], SignalResult>> = {},
): AnalysisResult {
  const neutral: SignalResult = {
    label: 'clear',
    confidence: 0.9,
    probabilities: { clear: 0.9, partial: 0.08, unclear: 0.02 },
  };
  const signals = Object.fromEntries(
    signalIds.map((id) => [id, overrides[id] ?? neutral]),
  ) as unknown as AnalysisResult['signals'];
  return {
    cacheKey: 'key',
    model: 'jev-1.13.0',
    createdAt: '2026-01-01T00:00:00.000Z',
    latencyMs: 12,
    estimatedCostUsd: null,
    usage: { input: 10, output: 5 },
    signals,
    deterministic: [],
    instructionFiles: [],
  };
}
