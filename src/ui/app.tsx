import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

import type { TimelineEvent } from '../acp/client.js';
import { confirmationDecision } from '../analysis/thresholds.js';
import type { AnalysisResult } from '../analysis/types.js';
import { discoverInstructionContext } from '../context/discovery.js';
import type { HistoryStore } from '../history/store.js';
import type { AnalysisEngine } from '../analysis/engine.js';
import type { SignalId } from '../analysis/types.js';
import {
  appendTimelineItem,
  isCopilotSlashCommand,
  isTerminalControlInput,
  signalColor,
  strongestSignalProbability,
  updateToTimelineItem,
  type TimelineItem,
} from './presentation.js';
import { renderTerminalMarkdown } from './terminal-markdown.js';
import type { AgentFactory, PromptAgent } from './types.js';

interface AppProps {
  readonly cwd: string;
  readonly engine: AnalysisEngine;
  readonly history: HistoryStore;
  readonly createAgent: AgentFactory;
  readonly mode: 'offline' | 'live';
}

interface PendingPermission {
  readonly request: RequestPermissionRequest;
  readonly resolve: (response: RequestPermissionResponse) => void;
}

type AnalysisState = 'idle' | 'waiting' | 'analyzing' | 'fresh' | 'error';

function gauge(probability: number, width = 12): string {
  const filled = Math.round(Math.max(0, Math.min(1, probability)) * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function eventItem(event: TimelineEvent): TimelineItem | undefined {
  switch (event.type) {
    case 'connection':
      return event.state === 'disconnected'
        ? {
            kind: 'error',
            text: `Connection lost${event.detail ? `: ${event.detail}` : ''}`,
          }
        : undefined;
    case 'session':
      return undefined;
    case 'stderr':
      return event.text.trim() ? { kind: 'error', text: event.text.trim() } : undefined;
    case 'update':
      return updateToTimelineItem(event.update);
  }
}

function Composer({ value, cursor }: { readonly value: string; readonly cursor: number }) {
  const before = value.slice(0, cursor);
  const current = value[cursor] ?? ' ';
  const after = value.slice(cursor + (cursor < value.length ? 1 : 0));
  return (
    <Box borderStyle="round" borderColor="gray" paddingX={1} minHeight={3}>
      <Text color="green">› </Text>
      <Text wrap="wrap">
        {before}
        <Text inverse>{current}</Text>
        {after}
      </Text>
    </Box>
  );
}

function Signals({
  result,
  expanded,
  compact,
}: {
  readonly result: AnalysisResult;
  readonly expanded: boolean;
  readonly compact: boolean;
}) {
  const visibleSignalIds: readonly SignalId[] = compact
    ? ['goalClarity', 'risk', 'instructionConflict']
    : ['goalClarity', 'targetContext', 'successCriteria', 'risk', 'instructionConflict'];
  const entries = Object.entries(result.signals).filter(
    ([id]) => expanded || visibleSignalIds.includes(id as SignalId),
  );
  return (
    <Box flexDirection="column">
      {entries.map(([id, signal]) => {
        const probability = strongestSignalProbability(signal);
        const color = signalColor(id as SignalId, signal.label);
        return (
          <Box key={id} flexDirection="column">
            <Text>
              <Text dimColor>{id.padEnd(compact ? 20 : 20)}</Text>
              {!compact ? <Text color={color}>{gauge(probability, 8)} </Text> : null}
              <Text bold color={color}>
                {signal.label}
              </Text>{' '}
              <Text dimColor>{(probability * 100).toFixed(0)}%</Text>
            </Text>
            {expanded ? (
              <Text dimColor>
                {'  '}
                {Object.entries(signal.probabilities)
                  .sort((left, right) => right[1] - left[1])
                  .map(([label, probability]) => `${label} ${(probability * 100).toFixed(0)}%`)
                  .join(' · ')}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

export function App({ cwd, engine, history, createAgent, mode }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(stdout.columns ?? 80);
  const [terminalHeight, setTerminalHeight] = useState(stdout.rows ?? 24);
  const [prompt, setPrompt] = useState('');
  const [cursor, setCursor] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult>();
  const [analyzedPrompt, setAnalyzedPrompt] = useState('');
  const [analysisState, setAnalysisState] = useState<AnalysisState>('idle');
  const [analysisError, setAnalysisError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [armed, setArmed] = useState(false);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [connection, setConnection] = useState('connecting');
  const [permission, setPermission] = useState<PendingPermission>();
  const [permissionIndex, setPermissionIndex] = useState(0);
  const agentRef = useRef<PromptAgent | undefined>(undefined);
  const promptRef = useRef(prompt);
  const cursorRef = useRef(cursor);
  promptRef.current = prompt;
  cursorRef.current = cursor;

  const updateComposer = (value: string, position: number) => {
    promptRef.current = value;
    cursorRef.current = position;
    setPrompt(value);
    setCursor(position);
  };

  useEffect(() => {
    const onResize = () => {
      setTerminalWidth(stdout.columns ?? 80);
      setTerminalHeight(stdout.rows ?? 24);
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  const appendTimeline = (item: TimelineItem) => {
    if (item.text) setTimeline((current) => appendTimelineItem(current, item));
  };

  useEffect(() => {
    const agent = createAgent({
      onEvent: (event) => {
        if (event.type === 'connection') setConnection(event.state);
        const item = eventItem(event);
        if (item) appendTimeline(item);
      },
      permissionHandler: (request) =>
        new Promise((resolve) => {
          setPermissionIndex(0);
          setPermission(() => ({ request, resolve }));
        }),
    });
    agentRef.current = agent;
    void agent.connect().catch((error: unknown) => {
      setConnection('disconnected');
      appendTimeline({
        kind: 'error',
        text: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
      });
    });
    return () => {
      void agent.close();
      history.close();
    };
  }, [createAgent, history]);

  useEffect(() => {
    setArmed(false);
    if (prompt.trim().length === 0 || isCopilotSlashCommand(prompt)) {
      engine.cancel();
      setAnalysis(undefined);
      setAnalysisState('idle');
      return;
    }
    let current = true;
    setAnalysisState('waiting');
    void discoverInstructionContext(cwd, prompt)
      .then((context) => {
        if (!current) return undefined;
        setAnalysisState('analyzing');
        return engine.analyze({ prompt, context });
      })
      .then((result) => {
        if (!current || !result) return;
        setAnalysis(result);
        setAnalyzedPrompt(prompt);
        setAnalysisState('fresh');
      })
      .catch((error: unknown) => {
        if (!current || (error instanceof DOMException && error.name === 'AbortError')) return;
        setAnalysisError(error instanceof Error ? error.message : String(error));
        setAnalysisState('error');
      });
    return () => {
      current = false;
    };
  }, [cwd, engine, prompt]);

  const decision = useMemo(
    () => (analysis ? confirmationDecision(analysis) : { required: false, reasons: [] }),
    [analysis],
  );

  const quit = () => {
    void agentRef.current?.close().finally(() => exit());
  };

  const resolvePermission = (option?: PermissionOption) => {
    if (!permission) return;
    permission.resolve({
      outcome: option
        ? { outcome: 'selected', optionId: option.optionId }
        : { outcome: 'cancelled' },
    });
    setPermission(undefined);
  };

  const submit = () => {
    const originalPrompt = promptRef.current;
    if (originalPrompt === '/quit') return quit();
    if (originalPrompt === '/cancel') {
      void agentRef.current?.cancel();
      return;
    }
    if (originalPrompt === '/history') {
      for (const entry of history.list(10).reverse()) {
        appendTimeline({
          kind: 'status',
          text: `History ${entry.id.slice(0, 8)} ${entry.sent ? 'sent' : 'not sent'}: ${entry.prompt}`,
        });
      }
      updateComposer('', 0);
      return;
    }
    if (originalPrompt === '/history clear') {
      appendTimeline({ kind: 'status', text: `Deleted ${history.deleteAll()} history entries` });
      updateComposer('', 0);
      return;
    }
    const copilotCommand = isCopilotSlashCommand(originalPrompt);
    if (
      !copilotCommand &&
      (!analysis || analyzedPrompt !== originalPrompt || analysisState !== 'fresh')
    ) {
      appendTimeline({ kind: 'status', text: 'Analysis must be fresh before sending' });
      return;
    }
    if (!copilotCommand && decision.required && !armed) {
      setArmed(true);
      return;
    }
    const agent = agentRef.current;
    if (!agent) return;
    updateComposer('', 0);
    setAnalysis(undefined);
    setAnalyzedPrompt('');
    setAnalysisState('idle');
    setArmed(false);
    appendTimeline({ kind: 'user', text: originalPrompt });
    void agent
      .sendPrompt(originalPrompt)
      .then((response) => {
        if (analysis) history.record(originalPrompt, analysis, decision, true);
        if (response.stopReason !== 'end_turn') {
          appendTimeline({ kind: 'status', text: `Stopped: ${response.stopReason}` });
        }
      })
      .catch((error: unknown) => {
        if (analysis) history.record(originalPrompt, analysis, decision, false);
        appendTimeline({
          kind: 'error',
          text: `Send error: ${error instanceof Error ? error.message : String(error)}`,
        });
      });
  };

  useInput((input, key) => {
    if (permission) {
      if (key.upArrow) setPermissionIndex((index) => Math.max(0, index - 1));
      else if (key.downArrow)
        setPermissionIndex((index) => Math.min(permission.request.options.length - 1, index + 1));
      else if (key.return) resolvePermission(permission.request.options[permissionIndex]);
      else if (key.escape) resolvePermission();
      return;
    }
    if (key.ctrl && input === 'c') return quit();
    if (key.ctrl && input === 'u') {
      updateComposer('', 0);
      engine.cancel();
      setAnalysis(undefined);
      setAnalyzedPrompt('');
      setAnalysisState('idle');
      setArmed(false);
      return;
    }
    if (isTerminalControlInput(input)) return;
    if (key.escape) {
      setArmed(false);
      void agentRef.current?.cancel();
      return;
    }
    if (key.tab) {
      setExpanded((value) => !value);
      return;
    }
    const currentPrompt = promptRef.current;
    const currentCursor = cursorRef.current;
    if (key.leftArrow) return updateComposer(currentPrompt, Math.max(0, currentCursor - 1));
    if (key.rightArrow)
      return updateComposer(currentPrompt, Math.min(currentPrompt.length, currentCursor + 1));
    if (key.backspace || key.delete) {
      if (currentCursor === 0) return;
      updateComposer(
        currentPrompt.slice(0, currentCursor - 1) + currentPrompt.slice(currentCursor),
        currentCursor - 1,
      );
      return;
    }
    if (key.return) {
      if (key.ctrl || key.meta) {
        updateComposer(
          `${currentPrompt.slice(0, currentCursor)}\n${currentPrompt.slice(currentCursor)}`,
          currentCursor + 1,
        );
      } else submit();
      return;
    }
    if (input) {
      updateComposer(
        currentPrompt.slice(0, currentCursor) + input + currentPrompt.slice(currentCursor),
        currentCursor + input.length,
      );
    }
  });

  const cost = analysis?.estimatedCostUsd;
  const compact = terminalWidth < 76 || terminalHeight < 22;
  const visibleTimeline = timeline.slice(-Math.max(2, Math.floor((terminalHeight - 12) / 4)));
  return (
    <Box
      flexDirection="column"
      width={Math.max(20, terminalWidth)}
      height={Math.max(12, terminalHeight)}
      paddingX={compact ? 0 : 1}
      overflow="hidden"
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold>
          <Text color="green">●</Text> Prompt Oscilloscope
        </Text>
        <Text
          color={
            mode === 'offline'
              ? 'yellow'
              : connection === 'connected'
                ? 'green'
                : connection === 'busy'
                  ? 'yellow'
                  : 'gray'
          }
        >
          {mode === 'offline' ? 'offline' : connection}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden" justifyContent="flex-end">
        {timeline.length === 0 ? (
          <Box flexDirection="column">
            <Text bold>What can I help you build?</Text>
            <Text dimColor>
              {mode === 'offline'
                ? 'Offline mode uses simulated results. Run without --offline for Jev and Copilot.'
                : 'Prompts are analyzed by Jev before Copilot receives them.'}
            </Text>
          </Box>
        ) : null}
        {visibleTimeline.map((item, index) => (
          <Box key={`${index}-${item.text.slice(0, 16)}`} flexDirection="column" marginBottom={1}>
            <Text
              bold
              color={
                item.kind === 'user'
                  ? 'blue'
                  : item.kind === 'assistant'
                    ? 'green'
                    : item.kind === 'error'
                      ? 'red'
                      : item.kind === 'tool'
                        ? 'yellow'
                        : 'gray'
              }
            >
              {item.kind === 'user'
                ? '› You'
                : item.kind === 'assistant'
                  ? '● Copilot'
                  : item.kind === 'tool'
                    ? '◆ Tool'
                    : item.kind === 'error'
                      ? '× Error'
                      : '· Status'}
            </Text>
            <Box paddingLeft={2}>
              {item.kind === 'assistant' ? (
                <Text>{renderTerminalMarkdown(item.text, terminalWidth - 6)}</Text>
              ) : (
                <Text wrap="wrap">{item.text}</Text>
              )}
            </Box>
          </Box>
        ))}
      </Box>
      <Box flexDirection="column" paddingX={1} flexShrink={0}>
        <Text>
          <Text dimColor>Prompt check </Text>
          <Text color={analysisState === 'fresh' ? 'green' : 'yellow'}>{analysisState}</Text>
          {analysisState === 'error' ? ` (${analysisError})` : ''}
        </Text>
        {analysis ? <Signals result={analysis} expanded={expanded} compact={compact} /> : null}
        {analysis && expanded ? (
          <Text dimColor>
            {analysis.latencyMs}ms · {analysis.usage.input + analysis.usage.output} tokens · cost{' '}
            {cost == null ? 'not configured' : `$${cost.toFixed(6)}`} · {analysis.model}
          </Text>
        ) : null}
        {analysis?.instructionFiles.length && expanded ? (
          <Text dimColor>instructions: {analysis.instructionFiles.join(', ')}</Text>
        ) : null}
        {analysis?.deterministic.map((finding) => (
          <Text key={finding.id} color={finding.level === 'risk' ? 'red' : 'yellow'}>
            {finding.label}
          </Text>
        ))}
        {armed ? (
          <Text bold color="yellow">
            Confirm {decision.reasons.join(', ')}: press Enter again
          </Text>
        ) : null}
      </Box>
      {permission ? (
        <Box borderStyle="double" borderColor="yellow" flexDirection="column" paddingX={1}>
          <Text bold>{permission.request.toolCall.title ?? 'Permission required'}</Text>
          {permission.request.options.map((option, index) => (
            <Text key={option.optionId} inverse={index === permissionIndex}>
              {option.name} [{option.kind}]
            </Text>
          ))}
        </Box>
      ) : null}
      <Composer value={prompt} cursor={cursor} />
      <Box justifyContent="space-between">
        <Text dimColor>
          {armed ? 'Enter again to confirm' : 'Enter send · Ctrl+Enter newline · Ctrl+U clear'}
        </Text>
        {!compact ? <Text dimColor>Tab details · Esc cancel · Ctrl+C quit</Text> : null}
      </Box>
    </Box>
  );
}
