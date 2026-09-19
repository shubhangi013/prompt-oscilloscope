import { describe, expect, it } from 'vitest';

import {
  appendTimelineItem,
  isCopilotSlashCommand,
  isTerminalControlInput,
  signalColor,
  updateToTimelineItem,
} from '../src/ui/presentation.js';

describe('timeline presentation', () => {
  it('coalesces streamed Copilot text chunks into one response', () => {
    const first = appendTimelineItem([], { kind: 'assistant', text: 'Hi! What' });
    const second = appendTimelineItem(first, { kind: 'assistant', text: ' would you like?' });

    expect(second).toEqual([{ kind: 'assistant', text: 'Hi! What would you like?' }]);
  });

  it('suppresses low-value ACP metadata updates', () => {
    expect(
      updateToTimelineItem({
        sessionUpdate: 'session_info_update',
        title: 'Prompt Oscilloscope',
      }),
    ).toBeUndefined();
    expect(
      updateToTimelineItem({
        sessionUpdate: 'usage_update',
        used: 10,
        size: 100,
      }),
    ).toBeUndefined();
    expect(
      updateToTimelineItem({
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'review', description: 'Review changes' }],
      }),
    ).toBeUndefined();
    expect(
      updateToTimelineItem({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'toolu_internal_id',
        status: 'completed',
      }),
    ).toBeUndefined();
  });

  it('rejects terminal cursor-position replies without rejecting normal input', () => {
    expect(isTerminalControlInput('\u001B[42;1R')).toBe(true);
    expect(isTerminalControlInput('[42;1R')).toBe(true);
    expect(isTerminalControlInput('Summarize this repository')).toBe(false);
  });

  it('identifies Copilot slash commands without matching normal prompts', () => {
    expect(isCopilotSlashCommand('/plan top 3 features')).toBe(true);
    expect(isCopilotSlashCommand('  /allow-all')).toBe(true);
    expect(isCopilotSlashCommand('summarize /plan behavior')).toBe(false);
  });
});

describe('signal presentation', () => {
  it('colors semantic outcomes rather than confidence magnitude', () => {
    expect(signalColor('goalClarity', 'unclear')).toBe('red');
    expect(signalColor('goalClarity', 'clear')).toBe('green');
    expect(signalColor('taskType', 'implementation')).toBe('cyan');
    expect(signalColor('taskType', 'unknown')).toBe('yellow');
    expect(signalColor('risk', 'destructive')).toBe('red');
    expect(signalColor('risk', 'none')).toBe('green');
  });
});
