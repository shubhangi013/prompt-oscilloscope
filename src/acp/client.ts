import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'busy';

export type TimelineEvent =
  | { readonly type: 'connection'; readonly state: ConnectionState; readonly detail?: string }
  | { readonly type: 'session'; readonly sessionId: string }
  | { readonly type: 'update'; readonly update: acp.SessionUpdate }
  | { readonly type: 'stderr'; readonly text: string };

export type PermissionHandler = (
  request: acp.RequestPermissionRequest,
) => Promise<acp.RequestPermissionResponse>;

export interface CopilotAcpOptions {
  readonly cwd: string;
  readonly command?: string;
  readonly commandArgs?: readonly string[];
  readonly permissionHandler?: PermissionHandler;
  readonly onEvent?: (event: TimelineEvent) => void;
}

export class CopilotAcpClient {
  readonly #cwd: string;
  readonly #command: string;
  readonly #commandArgs: readonly string[];
  readonly #permissionHandler: PermissionHandler;
  readonly #onEvent: (event: TimelineEvent) => void;
  #child: ChildProcessWithoutNullStreams | undefined;
  #connection: acp.ClientConnection | undefined;
  #sessionId: string | undefined;
  #state: ConnectionState = 'disconnected';

  constructor(options: CopilotAcpOptions) {
    this.#cwd = resolve(options.cwd);
    this.#command =
      options.command ??
      process.env.OSCOPE_COPILOT_COMMAND ??
      (process.platform === 'win32' ? 'copilot.exe' : 'copilot');
    this.#commandArgs = options.commandArgs ?? ['--acp', '--stdio'];
    this.#permissionHandler =
      options.permissionHandler ?? (() => Promise.resolve({ outcome: { outcome: 'cancelled' } }));
    this.#onEvent = options.onEvent ?? (() => undefined);
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  async connect(resumeSessionId?: string): Promise<string> {
    if (this.#connection) return this.#requireSession();
    this.#setState('connecting');
    const child = spawn(this.#command, [...this.#commandArgs], {
      cwd: this.#cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#child = child;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => this.#onEvent({ type: 'stderr', text: chunk }));

    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const app = acp
      .client({ name: 'prompt-oscilloscope' })
      .onRequest(acp.methods.client.session.requestPermission, ({ params }) =>
        this.#permissionHandler(params),
      )
      .onRequest(acp.methods.client.fs.readTextFile, ({ params }) => this.#readTextFile(params))
      .onRequest(acp.methods.client.fs.writeTextFile, ({ params }) => this.#writeTextFile(params))
      .onNotification(acp.methods.client.session.update, ({ params }) => {
        if (!this.#sessionId || params.sessionId === this.#sessionId) {
          this.#onEvent({ type: 'update', update: params.update });
        }
      });

    const connection = app.connect(stream);
    this.#connection = connection;
    connection.closed.finally(() => this.#setState('disconnected')).catch(() => undefined);

    await connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
      clientInfo: { name: 'prompt-oscilloscope', version: '0.1.0' },
    });

    if (resumeSessionId) {
      await connection.agent.request(acp.methods.agent.session.resume, {
        sessionId: resumeSessionId,
        cwd: this.#cwd,
        mcpServers: [],
      });
      this.#sessionId = resumeSessionId;
    } else {
      const response = await connection.agent.request(acp.methods.agent.session.new, {
        cwd: this.#cwd,
        mcpServers: [],
      });
      this.#sessionId = response.sessionId;
    }
    this.#setState('connected');
    this.#onEvent({ type: 'session', sessionId: this.#sessionId });
    return this.#sessionId;
  }

  async sendPrompt(prompt: string): Promise<acp.PromptResponse> {
    const connection = this.#requireConnection();
    const sessionId = this.#requireSession();
    this.#setState('busy');
    try {
      return await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      });
    } finally {
      if (this.#connection) this.#setState('connected');
    }
  }

  async cancel(): Promise<void> {
    if (!this.#connection || !this.#sessionId) return;
    await this.#connection.agent.notify(acp.methods.agent.session.cancel, {
      sessionId: this.#sessionId,
    });
  }

  async close(): Promise<void> {
    const connection = this.#connection;
    const sessionId = this.#sessionId;
    const child = this.#child;
    this.#connection = undefined;
    this.#sessionId = undefined;
    this.#child = undefined;
    if (connection && sessionId) {
      try {
        await connection.agent.request(acp.methods.agent.session.close, { sessionId });
      } catch {
        // Older agents may not advertise session/close; closing the transport is sufficient.
      }
      connection.close();
    }
    if (child) {
      const closed =
        child.exitCode === null
          ? new Promise<void>((resolve) => {
              child.once('close', () => resolve());
            })
          : undefined;
      child.kill();
      await closed;
    }
    this.#setState('disconnected');
  }

  async #readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    const path = this.#workspacePath(params.path);
    const content = await readFile(path, 'utf8');
    const line = Math.max(1, params.line ?? 1);
    const limit = Math.max(1, params.limit ?? Number.MAX_SAFE_INTEGER);
    return {
      content: content
        .split(/\r?\n/u)
        .slice(line - 1, line - 1 + limit)
        .join('\n'),
    };
  }

  async #writeTextFile(params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    const path = this.#workspacePath(params.path);
    await writeFile(path, params.content, 'utf8');
    return {};
  }

  #workspacePath(path: string): string {
    const absolute = resolve(path);
    const offset = relative(this.#cwd, absolute);
    if (
      !isAbsolute(path) ||
      offset === '..' ||
      offset.startsWith(`..${sep}`) ||
      isAbsolute(offset)
    ) {
      throw new Error(`ACP file access is outside the workspace: ${path}`);
    }
    return absolute;
  }

  #requireConnection(): acp.ClientConnection {
    if (!this.#connection) throw new Error('Copilot ACP is not connected');
    return this.#connection;
  }

  #requireSession(): string {
    if (!this.#sessionId) throw new Error('Copilot ACP session is not initialized');
    return this.#sessionId;
  }

  #setState(state: ConnectionState, detail?: string): void {
    this.#state = state;
    this.#onEvent({ type: 'connection', state, ...(detail ? { detail } : {}) });
  }
}
