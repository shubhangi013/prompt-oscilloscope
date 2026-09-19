import * as vscode from 'vscode';

import { AnalysisEngine } from '../../../src/analysis/engine.js';
import { TypeSafeJevAnalyzer } from '../../../src/analysis/jev-client.js';
import { confirmationDecision } from '../../../src/analysis/thresholds.js';
import type { AnalysisResult, SignalId } from '../../../src/analysis/types.js';
import { discoverInstructionContext } from '../../../src/context/discovery.js';

const PARTICIPANT_ID = 'prompt-oscilloscope.oscope';
const API_KEY_SECRET = 'promptOscilloscope.typesafeApiKey';

const summarySignals: ReadonlyArray<readonly [string, SignalId]> = [
  ['Clarity', 'goalClarity'],
  ['Context', 'targetContext'],
  ['Success', 'successCriteria'],
  ['Risk', 'risk'],
  ['Conflict', 'instructionConflict'],
];

function confidence(result: AnalysisResult, id: SignalId): number {
  const signal = result.signals[id];
  return signal.probabilities[signal.label] ?? signal.confidence;
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('|', '\\|').replaceAll('_', '\\_');
}

function compactAnalysis(result: AnalysisResult): string {
  const summary = summarySignals
    .map(([name, id]) => {
      const signal = result.signals[id];
      return `**${name}:** ${escapeMarkdown(signal.label)} ${Math.round(confidence(result, id) * 100)}%`;
    })
    .join(' · ');
  return `**Prompt check** · ${result.latencyMs} ms · ${result.model}\n\n${summary}\n\n`;
}

function detailedAnalysis(result: AnalysisResult): string {
  const rows = Object.entries(result.signals)
    .map(([id, signal]) => {
      const probability = signal.probabilities[signal.label] ?? signal.confidence;
      return `| ${escapeMarkdown(id)} | ${escapeMarkdown(signal.label)} | ${Math.round(probability * 100)}% |`;
    })
    .join('\n');
  const findings = result.deterministic.map((finding) => `- ${finding.label}`).join('\n');
  return `${compactAnalysis(result)}| Signal | Outcome | Confidence |\n| --- | --- | ---: |\n${rows}${findings ? `\n\n${findings}` : ''}\n`;
}

function workspaceDirectory(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
}

async function setApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'Prompt Oscilloscope',
    prompt: 'Enter your TypeSafe API key',
    password: true,
    ignoreFocusOut: true,
  });
  if (!value?.trim()) return;
  await context.secrets.store(API_KEY_SECRET, value.trim());
  void vscode.window.showInformationMessage('Prompt Oscilloscope API key saved securely.');
}

function previousMessages(chatContext: vscode.ChatContext): vscode.LanguageModelChatMessage[] {
  const messages: vscode.LanguageModelChatMessage[] = [];
  for (const turn of chatContext.history.slice(-8)) {
    if (turn instanceof vscode.ChatRequestTurn && turn.participant === PARTICIPANT_ID) {
      messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
    }
    if (turn instanceof vscode.ChatResponseTurn && turn.participant === PARTICIPANT_ID) {
      const markdown = turn.response
        .filter(
          (part): part is vscode.ChatResponseMarkdownPart =>
            part instanceof vscode.ChatResponseMarkdownPart,
        )
        .map((part) => part.value.value)
        .join('');
      if (markdown) messages.push(vscode.LanguageModelChatMessage.Assistant(markdown));
    }
  }
  return messages;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('promptOscilloscope.setApiKey', () => setApiKey(context)),
    vscode.commands.registerCommand('promptOscilloscope.clearApiKey', async () => {
      await context.secrets.delete(API_KEY_SECRET);
      void vscode.window.showInformationMessage('Prompt Oscilloscope API key cleared.');
    }),
  );

  const handler: vscode.ChatRequestHandler = async (request, chatContext, stream, token) => {
    if (!request.prompt.trim()) {
      stream.markdown('Enter a prompt after `@oscope`, or use `/analyze` to inspect one.');
      return;
    }

    const apiKey = await context.secrets.get(API_KEY_SECRET);
    if (!apiKey) {
      stream.markdown('A TypeSafe API key is required for prompt analysis.');
      stream.button({
        command: 'promptOscilloscope.setApiKey',
        title: 'Set TypeSafe API Key',
      });
      return;
    }

    stream.progress('Analyzing prompt with Jev...');
    const engine = new AnalysisEngine(new TypeSafeJevAnalyzer({ apiKey }), { debounceMs: 0 });
    const cancellation = token.onCancellationRequested(() => engine.cancel());

    try {
      const instructionContext = await discoverInstructionContext(
        workspaceDirectory(),
        request.prompt,
      );
      const result = await engine.analyze({ prompt: request.prompt, context: instructionContext });
      const decision = confirmationDecision(result);

      stream.markdown(
        request.command === 'analyze' ? detailedAnalysis(result) : compactAnalysis(result),
      );
      if (request.command === 'analyze') return;

      if (decision.required && request.command !== 'send') {
        stream.markdown(
          `**Confirmation required:** ${decision.reasons.join(', ')}. Review the prompt, or run \`@oscope /send ${request.prompt}\` to continue unchanged.`,
        );
        return;
      }

      stream.progress(`Generating with ${request.model.name}...`);
      const messages = previousMessages(chatContext);
      messages.push(vscode.LanguageModelChatMessage.User(request.prompt));
      const response = await request.model.sendRequest(messages, {}, token);
      for await (const fragment of response.text) stream.markdown(fragment);
    } catch (error) {
      if (error instanceof vscode.LanguageModelError) {
        stream.markdown(`**Copilot model error:** ${error.message}`);
        return;
      }
      if (error instanceof Error && error.name === 'AbortError') return;
      stream.markdown(
        `**Prompt analysis failed:** ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      cancellation.dispose();
    }
  };

  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handler);
  context.subscriptions.push(participant);
}

export function deactivate(): void {}
