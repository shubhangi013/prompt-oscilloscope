export const signalIds = [
  'goalClarity',
  'taskType',
  'targetContext',
  'constraints',
  'successCriteria',
  'goalCompatibility',
  'expectedBehavior',
  'risk',
  'instructionConflict',
] as const;

export type SignalId = (typeof signalIds)[number];

export interface SignalResult {
  readonly label: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
}

export interface DeterministicFinding {
  readonly id: 'empty' | 'long' | 'possible-secret';
  readonly level: 'info' | 'warning' | 'risk';
  readonly label: string;
}

export interface AnalysisResult {
  readonly cacheKey: string;
  readonly model: string;
  readonly createdAt: string;
  readonly latencyMs: number;
  readonly estimatedCostUsd: number | null;
  readonly usage: TokenUsage;
  readonly signals: Readonly<Record<SignalId, SignalResult>>;
  readonly deterministic: readonly DeterministicFinding[];
  readonly instructionFiles: readonly string[];
}

export interface InstructionContext {
  readonly content: string;
  readonly files: readonly string[];
  readonly hash: string;
  readonly truncated: boolean;
}

export interface AnalysisInput {
  readonly prompt: string;
  readonly context: InstructionContext;
}

export interface ConfirmationDecision {
  readonly required: boolean;
  readonly reasons: readonly ('ambiguity' | 'conflict' | 'risk')[];
}
