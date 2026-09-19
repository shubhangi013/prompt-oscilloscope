import { appendFile } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';

const outputPath = process.argv[2];
const app = acp
  .agent({ name: 'fake-agent' })
  .onRequest(acp.methods.agent.initialize, ({ params }) => ({
    protocolVersion: params.protocolVersion,
    agentCapabilities: { sessionCapabilities: { close: true, resume: true } },
    agentInfo: { name: 'fake-agent', version: '1.0.0' },
  }))
  .onRequest(acp.methods.agent.session.new, () => ({ sessionId: 'fake-session' }))
  .onRequest(acp.methods.agent.session.resume, () => ({ modes: null }))
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const text = params.prompt.find((block) => block.type === 'text')?.text ?? '';
    await appendFile(outputPath, text, 'utf8');
    await client.notify(acp.methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'streamed response' },
      },
    });
    return { stopReason: 'end_turn' };
  })
  .onRequest(acp.methods.agent.session.close, () => ({}));

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const connection = app.connect(stream);
await connection.closed;
