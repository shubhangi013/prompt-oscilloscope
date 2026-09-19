import type { PromptResponse, RequestPermissionResponse } from '@agentclientprotocol/sdk';

import type { AnalysisInput, SignalId, SignalResult } from '../analysis/types.js';
import type { JevAnalyzer, JevResponse } from '../analysis/jev-client.js';
import type { AgentHandlers, PromptAgent } from '../ui/types.js';

function signal(label: string, probabilities: Record<string, number>): SignalResult {
  return { label, confidence: probabilities[label] ?? 0, probabilities };
}

const defaultSignals: Record<SignalId, SignalResult> = {
  goalClarity: signal('clear', { clear: 0.86, partial: 0.1, unclear: 0.04 }),
  taskType: signal('question', {
    question: 0.62,
    investigation: 0.08,
    implementation: 0.08,
    debugging: 0.04,
    review: 0.04,
    planning: 0.03,
    operation: 0.03,
    mixed: 0.06,
    unknown: 0.02,
  }),
  targetContext: signal('identified', { identified: 0.72, partial: 0.23, missing: 0.05 }),
  constraints: signal('partial', { explicit: 0.12, partial: 0.62, missing: 0.26 }),
  successCriteria: signal('implied', { explicit: 0.12, implied: 0.76, missing: 0.12 }),
  goalCompatibility: signal('single', { single: 0.9, multiple: 0.08, conflicting: 0.02 }),
  expectedBehavior: signal('read', {
    answer: 0.22,
    search: 0.08,
    read: 0.54,
    edit: 0.02,
    test: 0.02,
    git: 0.01,
    network: 0.02,
    external_side_effect: 0.01,
    mixed: 0.06,
    unknown: 0.02,
  }),
  risk: signal('none', {
    none: 0.86,
    destructive: 0.04,
    credential: 0.03,
    deployment: 0.03,
    privacy: 0.03,
    multiple: 0.01,
  }),
  instructionConflict: signal('aligned', { aligned: 0.86, uncertain: 0.11, conflicting: 0.03 }),
};

export class DemoJevAnalyzer implements JevAnalyzer {
  async analyze(input: AnalysisInput, signal: AbortSignal): Promise<JevResponse> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 180);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Cancelled', 'AbortError'));
      });
    });
    const risky = /\b(delete|deploy|token|password)\b/iu.test(input.prompt);
    return {
      model: 'jev-1.13.0-demo',
      usage: { input: 128, output: 42 },
      signals: {
        ...defaultSignals,
        risk: risky
          ? {
              label: 'destructive',
              confidence: 0.78,
              probabilities: {
                none: 0.1,
                destructive: 0.78,
                credential: 0.03,
                deployment: 0.05,
                privacy: 0.02,
                multiple: 0.02,
              },
            }
          : defaultSignals.risk,
      },
    };
  }
}

export class DemoAgent implements PromptAgent {
  constructor(readonly handlers: AgentHandlers) {}

  connect(): Promise<string> {
    this.handlers.onEvent({ type: 'connection', state: 'connected', detail: 'demo' });
    this.handlers.onEvent({ type: 'session', sessionId: 'demo-session' });
    return Promise.resolve('demo-session');
  }

  sendPrompt(prompt: string): Promise<PromptResponse> {
    this.handlers.onEvent({ type: 'connection', state: 'busy' });
    this.handlers.onEvent({
      type: 'update',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: `Demo received ${prompt.length} unchanged characters.` },
      },
    });
    this.handlers.onEvent({ type: 'connection', state: 'connected' });
    return Promise.resolve({ stopReason: 'end_turn' });
  }

  cancel(): Promise<void> {
    this.handlers.onEvent({ type: 'connection', state: 'connected', detail: 'cancelled' });
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.handlers.onEvent({ type: 'connection', state: 'disconnected' });
    return Promise.resolve();
  }
}

export function cancelledPermission(): RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}
