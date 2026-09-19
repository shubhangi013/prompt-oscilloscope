#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';

import { render } from 'ink';

import { CopilotAcpClient } from './acp/client.js';
import { AnalysisEngine } from './analysis/engine.js';
import { TypeSafeJevAnalyzer } from './analysis/jev-client.js';
import { DemoAgent, DemoJevAnalyzer } from './demo/services.js';
import { HistoryStore } from './history/store.js';
import { App } from './ui/app.js';
import type { AgentFactory } from './ui/types.js';

function loadLocalEnvironment(): void {
  try {
    loadEnvFile(resolve(process.cwd(), '.env'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function renderInteractive(app: React.ReactNode): void {
  const alternateScreen = process.stdout.isTTY;
  if (alternateScreen) process.stdout.write('\u001B[?1049h\u001B[2J\u001B[H');
  const instance = render(app);
  void instance.waitUntilExit().finally(() => {
    if (alternateScreen) process.stdout.write('\u001B[?1049l');
  });
}

function printHelp(): void {
  console.log(`Prompt Oscilloscope

Usage:
  oscope                 Start with TypeSafe Jev and GitHub Copilot CLI
  oscope --offline       Start with simulated local analysis and responses
  oscope --history       Print recent local history
  oscope --delete-history [id|all]
  oscope --help

Environment:
  TYPESAFE_API_KEY       Required in normal live mode
  OSCOPE_COPILOT_COMMAND Override the Copilot CLI command
  OSCOPE_INPUT_COST_PER_MILLION and OSCOPE_OUTPUT_COST_PER_MILLION
`);
}

function rate(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function assertPrerequisites(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) throw new Error(`Node.js 22+ is required; found ${process.version}`);
  if (!process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY is required');
  const command =
    process.env.OSCOPE_COPILOT_COMMAND ??
    (process.platform === 'win32' ? 'copilot.exe' : 'copilot');
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error('GitHub Copilot CLI was not found. Install it and authenticate first.');
  }
}

function historyCommand(args: readonly string[]): boolean {
  if (!args.includes('--history') && !args.includes('--delete-history')) return false;
  const history = new HistoryStore();
  try {
    if (args.includes('--history')) {
      for (const entry of history.list()) {
        console.log(
          `${entry.createdAt} ${entry.id} ${entry.sent ? 'sent' : 'not-sent'} ${JSON.stringify(entry.prompt)}`,
        );
      }
      return true;
    }
    const index = args.indexOf('--delete-history');
    const target = args[index + 1];
    if (!target) throw new Error('--delete-history requires an entry id or "all"');
    const count = target === 'all' ? history.deleteAll() : history.delete(target) ? 1 : 0;
    console.log(`Deleted ${count} history ${count === 1 ? 'entry' : 'entries'}.`);
    return true;
  } finally {
    history.close();
  }
}

function main(): void {
  loadLocalEnvironment();
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) return printHelp();
  if (historyCommand(args)) return;

  const offline = args.includes('--offline') || args.includes('--demo');
  if (!offline) assertPrerequisites();
  const analyzer = offline ? new DemoJevAnalyzer() : new TypeSafeJevAnalyzer();
  const inputRate = rate('OSCOPE_INPUT_COST_PER_MILLION');
  const outputRate = rate('OSCOPE_OUTPUT_COST_PER_MILLION');
  const engine = new AnalysisEngine(analyzer, {
    ...(inputRate === undefined ? {} : { inputCostPerMillionTokens: inputRate }),
    ...(outputRate === undefined ? {} : { outputCostPerMillionTokens: outputRate }),
  });
  const createAgent: AgentFactory = offline
    ? (handlers) => new DemoAgent(handlers)
    : (handlers) => new CopilotAcpClient({ cwd: process.cwd(), ...handlers });
  renderInteractive(
    <App
      cwd={process.cwd()}
      engine={engine}
      history={new HistoryStore()}
      createAgent={createAgent}
      mode={offline ? 'offline' : 'live'}
    />,
  );
}

try {
  main();
} catch (error) {
  console.error(`oscope: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
