import { TypeSafeClient, type TypeSafeClientConfig } from '@typesafe-ai/sdk';

import { analysisQuestions } from './questions.js';
import type { AnalysisInput, SignalId, SignalResult, TokenUsage } from './types.js';

export const JEV_MODEL = 'jev-1.13.0';

export interface JevResponse {
  readonly model: string;
  readonly signals: Readonly<Record<SignalId, SignalResult>>;
  readonly usage: TokenUsage;
}

export interface JevAnalyzer {
  analyze(input: AnalysisInput, signal: AbortSignal): Promise<JevResponse>;
}

export class TypeSafeJevAnalyzer implements JevAnalyzer {
  readonly #client: TypeSafeClient;

  constructor(config: TypeSafeClientConfig = {}) {
    this.#client = new TypeSafeClient({ defaultModel: JEV_MODEL, logLevel: 'off', ...config });
  }

  async analyze(input: AnalysisInput, signal: AbortSignal): Promise<JevResponse> {
    const response = await this.#client.systemOne(
      {
        model: JEV_MODEL,
        state: {
          prompt: input.prompt,
          instructionContext: input.context.content,
          instructionFiles: [...input.context.files],
          instructionContextTruncated: input.context.truncated,
        },
        questions: analysisQuestions,
      },
      { signal },
    );

    return {
      model: response.model,
      signals: Object.fromEntries(
        Object.entries(response.answers).map(([id, answer]) => [
          id,
          {
            label: answer.choice,
            confidence: answer.confidence,
            probabilities: answer.probabilities,
          },
        ]),
      ) as unknown as Readonly<Record<SignalId, SignalResult>>,
      usage: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
    };
  }
}
