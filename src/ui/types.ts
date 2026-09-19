import type {
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';

import type { TimelineEvent } from '../acp/client.js';

export interface PromptAgent {
  connect(resumeSessionId?: string): Promise<string>;
  sendPrompt(prompt: string): Promise<PromptResponse>;
  cancel(): Promise<void>;
  close(): Promise<void>;
}

export interface AgentHandlers {
  readonly onEvent: (event: TimelineEvent) => void;
  readonly permissionHandler: (
    request: RequestPermissionRequest,
  ) => Promise<RequestPermissionResponse>;
}

export type AgentFactory = (handlers: AgentHandlers) => PromptAgent;
