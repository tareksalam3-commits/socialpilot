import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';

export function MarkdownRenderer({ content }: { content: string }) {
  return <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{parseMarkdown(content)}</div>;
}

function parseMarkdown(text: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3);
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push(<CodeBlock key={key++} code={codeLines.join('\n')} lang={lang} />);
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const cls =
        level === 1
          ? 'text-xl font-bold text-slate-900 dark:text-white'
          : level === 2
            ? 'text-lg font-bold text-slate-900 dark:text-white'
            : level === 3
              ? 'text-base font-semibold text-slate-900 dark:text-white'
              : 'text-sm font-semibold text-slate-800 dark:text-slate-200';
      blocks.push(
        <p key={key++} className={cls}>
          {renderInline(text)}
        </p>,
      );
      i++;
      continue;
    }

    // List
    if (line.match(/^[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[-*]\s+/)) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (line.match(/^\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i++;
      }
      blocks.push(
        <ol key={key++} className="list-decimal space-y-1 pl-5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].trim().startsWith('```') && !lines[i].match(/^(#{1,4})\s+/) && !lines[i].match(/^[-*]\s+/) && !lines[i].match(/^\d+\.\s+/)) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++}>{renderInline(paraLines.join(' '))}</p>);
  }

  return blocks;
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  const patterns: { regex: RegExp; render: (m: RegExpExecArray) => ReactNode }[] = [
    { regex: /\*\*(.+?)\*\*/, render: (m) => <strong key={key++} className="font-semibold text-slate-900 dark:text-white">{m[1]}</strong> },
    { regex: /\*(.+?)\*/, render: (m) => <em key={key++}>{m[1]}</em> },
    { regex: /`(.+?)`/, render: (m) => <code key={key++} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-800 dark:bg-slate-800 dark:text-slate-200">{m[1]}</code> },
    { regex: /\[(.+?)\]\((.+?)\)/, render: (m) => <a key={key++} href={m[2]} target="_blank" rel="noopener noreferrer" className="text-sky-600 underline hover:text-sky-700 dark:text-sky-400">{m[1]}</a> },
  ];

  while (remaining.length > 0) {
    let earliestMatch: { match: RegExpExecArray; render: (m: RegExpExecArray) => ReactNode } | null = null;
    for (const p of patterns) {
      const m = p.regex.exec(remaining);
      if (m && (earliestMatch === null || m.index < earliestMatch.match.index)) {
        earliestMatch = { match: m, render: p.render };
      }
    }
    if (earliestMatch) {
      if (earliestMatch.match.index > 0) {
        nodes.push(remaining.slice(0, earliestMatch.match.index));
      }
      nodes.push(earliestMatch.render(earliestMatch.match));
      remaining = remaining.slice(earliestMatch.match.index + earliestMatch.match[0].length);
    } else {
      nodes.push(remaining);
      break;
    }
  }

  return nodes;
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{lang || 'code'}</span>
        <button onClick={handleCopy} className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200" aria-label="Copy code">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="overflow-x-auto bg-slate-900 p-3 text-xs text-slate-100 dark:bg-slate-950">
        <code>{code}</code>
      </pre>
    </div>
  );
}
