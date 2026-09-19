import type { SessionUpdate } from '@agentclientprotocol/sdk';

import type { SignalId, SignalResult } from '../analysis/types.js';

export type TimelineItem =
  | { readonly kind: 'assistant'; readonly text: string }
  | { readonly kind: 'user'; readonly text: string }
  | { readonly kind: 'tool' | 'status' | 'error'; readonly text: string };

const positiveLabels: Partial<Record<SignalId, readonly string[]>> = {
  goalClarity: ['clear'],
  targetContext: ['identified'],
  constraints: ['explicit'],
  successCriteria: ['explicit'],
  goalCompatibility: ['single'],
  risk: ['none'],
  instructionConflict: ['aligned'],
};

const warningLabels: Partial<Record<SignalId, readonly string[]>> = {
  goalClarity: ['partial'],
  taskType: ['unknown'],
  targetContext: ['partial'],
  constraints: ['partial'],
  successCriteria: ['implied'],
  goalCompatibility: ['multiple'],
  expectedBehavior: ['unknown', 'network', 'external_side_effect'],
  instructionConflict: ['uncertain'],
};

export function signalColor(id: SignalId, label: string): 'green' | 'yellow' | 'red' | 'cyan' {
  if (positiveLabels[id]?.includes(label)) return 'green';
  if (warningLabels[id]?.includes(label)) return 'yellow';
  if (id === 'taskType' || id === 'expectedBehavior') return 'cyan';
  return 'red';
}

export function updateToTimelineItem(update: SessionUpdate): TimelineItem | undefined {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return update.content.type === 'text'
        ? { kind: 'assistant', text: update.content.text }
        : undefined;
    case 'tool_call':
      return { kind: 'tool', text: update.title };
    case 'tool_call_update':
      return undefined;
    case 'plan':
      return { kind: 'status', text: 'Plan updated' };
    default:
      return undefined;
  }
}

export function appendTimelineItem(
  timeline: readonly TimelineItem[],
  item: TimelineItem,
  limit = 30,
): TimelineItem[] {
  const last = timeline.at(-1);
  if (item.kind === 'assistant' && last?.kind === 'assistant') {
    const merged: TimelineItem = { kind: 'assistant', text: last.text + item.text };
    return [...timeline.slice(0, -1), merged].slice(-limit);
  }
  return [...timeline, item].slice(-limit);
}

export function strongestSignalProbability(signal: SignalResult): number {
  return signal.probabilities[signal.label] ?? signal.confidence;
}

export function isTerminalControlInput(input: string): boolean {
  return (
    input.includes(`${String.fromCharCode(27)}[`) || /^\[\??\d+(?:;\d+)*[A-Za-z~]$/u.test(input)
  );
}

export function isCopilotSlashCommand(input: string): boolean {
  return /^\/\S+/u.test(input.trim());
}
