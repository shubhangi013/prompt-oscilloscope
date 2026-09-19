import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';

export function renderTerminalMarkdown(markdown: string, width: number): string {
  const rendered = marked.parse(markdown, {
    renderer: new TerminalRenderer({
      reflowText: true,
      showSectionPrefix: false,
      tab: 2,
      width: Math.max(20, width),
    }),
  });
  return rendered.trimEnd();
}
