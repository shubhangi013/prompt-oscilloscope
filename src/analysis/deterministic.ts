import type { DeterministicFinding } from './types.js';

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b(?:gh[opsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*['"]?[^\s'"]{12,}/iu,
] as const;

export function runDeterministicChecks(prompt: string): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];
  if (prompt.trim().length === 0) {
    findings.push({ id: 'empty', level: 'warning', label: 'Prompt is empty' });
  }
  if (prompt.length > 12_000) {
    findings.push({ id: 'long', level: 'info', label: 'Prompt exceeds 12,000 characters' });
  }
  if (secretPatterns.some((pattern) => pattern.test(prompt))) {
    findings.push({
      id: 'possible-secret',
      level: 'risk',
      label: 'Prompt may contain a credential or secret',
    });
  }
  return findings;
}
