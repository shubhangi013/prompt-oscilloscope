# Prompt Oscilloscope for VS Code

Use Prompt Oscilloscope inside GitHub Copilot Chat without replacing the native chat interface.

## Setup

1. Run **Prompt Oscilloscope: Set TypeSafe API Key** from the Command Palette.
2. Open GitHub Copilot Chat.
3. Enter `@oscope` followed by a prompt.

The key is stored in VS Code SecretStorage and is never written to workspace settings.

Prompt analysis includes bounded repository guidance from `CONTRIBUTING.md`, Copilot instruction files, applicable `AGENTS.md` files, and matching `.github/instructions/*.instructions.md` files. Prompt text and the discovered instruction contents are sent to TypeSafe for analysis.

## Chat commands

- `@oscope <prompt>` analyzes the prompt and sends it to the model selected in Copilot Chat when no confirmation is required.
- `@oscope /analyze <prompt>` displays full diagnostics without invoking the selected model.
- `@oscope /send <prompt>` analyzes and sends unchanged even when the diagnostic thresholds recommend confirmation.

When regular `@oscope` analysis detects ambiguity, conflicting repository guidance, or material risk, the model is not invoked. Review the diagnostics and use `/send` only when you intentionally want to proceed.

## Boundaries

VS Code exposes participant prompts after submission, so the extension cannot analyze text while it is still being typed in the stock Copilot composer. Responses use the model selected in Copilot Chat and appear in the native session with native Markdown rendering.

A chat participant is not the built-in Copilot coding agent. This initial version invokes the selected language model directly and does not inherit the built-in agent's autonomous tool loop. VS Code does not expose Copilot AI-credit balances to extensions.
