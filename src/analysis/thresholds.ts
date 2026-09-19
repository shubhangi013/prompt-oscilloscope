import type { AnalysisResult, ConfirmationDecision } from './types.js';

export interface ConfirmationThresholds {
  readonly ambiguity: number;
  readonly conflict: number;
  readonly risk: number;
}

export const defaultThresholds: ConfirmationThresholds = {
  ambiguity: 0.55,
  conflict: 0.35,
  risk: 0.25,
};

function probability(
  result: AnalysisResult,
  signal: keyof AnalysisResult['signals'],
  label: string,
) {
  return result.signals[signal].probabilities[label] ?? 0;
}

export function confirmationDecision(
  result: AnalysisResult,
  thresholds: ConfirmationThresholds = defaultThresholds,
): ConfirmationDecision {
  const ambiguity = Math.max(
    probability(result, 'goalClarity', 'unclear'),
    probability(result, 'targetContext', 'missing'),
    probability(result, 'successCriteria', 'missing'),
  );
  const conflict = Math.max(
    probability(result, 'goalCompatibility', 'conflicting'),
    probability(result, 'instructionConflict', 'conflicting'),
  );
  const riskLabels = ['destructive', 'credential', 'deployment', 'privacy', 'multiple'];
  const risk = riskLabels.reduce((total, label) => total + probability(result, 'risk', label), 0);
  const reasons: ConfirmationDecision['reasons'][number][] = [];
  if (ambiguity >= thresholds.ambiguity) reasons.push('ambiguity');
  if (conflict >= thresholds.conflict) reasons.push('conflict');
  if (risk >= thresholds.risk || result.deterministic.some((finding) => finding.level === 'risk')) {
    reasons.push('risk');
  }
  return { required: reasons.length > 0, reasons };
}
