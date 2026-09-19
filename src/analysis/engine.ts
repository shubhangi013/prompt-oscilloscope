import { createHash } from 'node:crypto';

import { runDeterministicChecks } from './deterministic.js';
import type { JevAnalyzer } from './jev-client.js';
import type { AnalysisInput, AnalysisResult } from './types.js';

export interface AnalysisEngineOptions {
  readonly debounceMs?: number;
  readonly cacheSize?: number;
  readonly inputCostPerMillionTokens?: number;
  readonly outputCostPerMillionTokens?: number;
}

export class AnalysisEngine {
  readonly #cache = new Map<string, AnalysisResult>();
  readonly #options: {
    readonly debounceMs: number;
    readonly cacheSize: number;
    readonly inputCostPerMillionTokens: number | undefined;
    readonly outputCostPerMillionTokens: number | undefined;
  };
  #active: AbortController | undefined;
  #timer: NodeJS.Timeout | undefined;

  constructor(
    readonly analyzer: JevAnalyzer,
    options: AnalysisEngineOptions = {},
  ) {
    this.#options = {
      debounceMs: options.debounceMs ?? 350,
      cacheSize: options.cacheSize ?? 100,
      inputCostPerMillionTokens: options.inputCostPerMillionTokens,
      outputCostPerMillionTokens: options.outputCostPerMillionTokens,
    };
  }

  analyze(input: AnalysisInput): Promise<AnalysisResult> {
    const cacheKey = createHash('sha256')
      .update(input.prompt)
      .update('\0')
      .update(input.context.hash)
      .digest('hex');
    const cached = this.#cache.get(cacheKey);
    if (cached) return Promise.resolve(cached);

    this.cancel('Superseded by a newer prompt');
    const controller = new AbortController();
    this.#active = controller;

    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Analysis cancelled', 'AbortError'));
      controller.signal.addEventListener('abort', abort, { once: true });
      this.#timer = setTimeout(() => {
        controller.signal.removeEventListener('abort', abort);
        void this.#run(input, cacheKey, controller).then(resolve, reject);
      }, this.#options.debounceMs);
    });
  }

  cancel(reason = 'Cancelled'): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#active?.abort(reason);
    this.#active = undefined;
  }

  async #run(
    input: AnalysisInput,
    cacheKey: string,
    controller: AbortController,
  ): Promise<AnalysisResult> {
    const started = performance.now();
    const response = await this.analyzer.analyze(input, controller.signal);
    const result: AnalysisResult = {
      cacheKey,
      model: response.model,
      createdAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - started),
      estimatedCostUsd: this.#estimateCost(response.usage.input, response.usage.output),
      usage: response.usage,
      signals: response.signals,
      deterministic: runDeterministicChecks(input.prompt),
      instructionFiles: input.context.files,
    };
    this.#cache.set(cacheKey, result);
    while (this.#cache.size > this.#options.cacheSize) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    if (this.#active === controller) this.#active = undefined;
    return result;
  }

  #estimateCost(inputTokens: number, outputTokens: number): number | null {
    const inputRate = this.#options.inputCostPerMillionTokens;
    const outputRate = this.#options.outputCostPerMillionTokens;
    if (inputRate === undefined || outputRate === undefined) return null;
    return (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
  }
}
