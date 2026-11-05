import type { ReactNode } from 'react';
import styles from './insights.module.css';

/*
 * The weekly report preview ("as it looks when pasted"): the subset of Markdown the generated draft
 * uses — headings, nested "- " lists and paragraphs — rendered as React text, never as HTML. Text in
 * square brackets ("[ADD PLANS]") is a placeholder still to fill in and stands out.
 */

export type MarkdownBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: MarkdownItem[] };

export interface MarkdownItem {
  text: string;
  children: MarkdownItem[];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^(\s*)[-*+]\s+(.*)$/;

/** Splits the draft into blocks. Nesting follows indentation (two spaces or a tab per level). */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: { root: MarkdownItem[]; stack: { indent: number; items: MarkdownItem[] }[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', items: list.root });
    list = null;
  };

  for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = HEADING.exec(line.trim());
    if (heading && !/^\s/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      flushParagraph();
      const indent = item[1]!.replace(/\t/g, '  ').length;
      const entry: MarkdownItem = { text: item[2]!.trim(), children: [] };
      if (!list) list = { root: [], stack: [] };
      const current = list;
      while (current.stack.length > 0 && current.stack[current.stack.length - 1]!.indent >= indent) current.stack.pop();
      const parent = current.stack[current.stack.length - 1];
      const siblings = parent ? (parent.items[parent.items.length - 1]?.children ?? current.root) : current.root;
      siblings.push(entry);
      current.stack.push({ indent, items: siblings });
      continue;
    }
    if (list) {
      // A continuation line of the last item.
      const current = list;
      const top = current.stack[current.stack.length - 1];
      const last = top?.items[top.items.length - 1];
      if (last) {
        last.text = `${last.text} ${line.trim()}`;
        continue;
      }
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

/** Text with `[PLACEHOLDERS]` marked. */
export function InlineText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /\[([^\]\n]+)\]/g;
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <mark key={match.index} className={styles.placeholder}>
        {match[0]}
      </mark>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function Items({ items, nested = false }: { items: readonly MarkdownItem[]; nested?: boolean }) {
  return (
    <ul className={nested ? styles.mdNested : styles.mdList}>
      {items.map((item, index) => (
        <li key={index}>
          <InlineText text={item.text} />
          {item.children.length > 0 ? <Items items={item.children} nested /> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The draft as formatted text. The first heading is the report title (h3 under the panel's h2);
 * section headings follow one level below it.
 */
export function MarkdownPreview({ source, headingLevel = 3 }: { source: string; headingLevel?: 3 | 4 }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const level = Math.min(6, headingLevel + Math.max(0, block.level - 1));
            const Tag = `h${level}` as 'h3';
            return (
              <Tag key={index} className={block.level === 1 ? styles.mdTitle : styles.mdHeading}>
                <InlineText text={block.text} />
              </Tag>
            );
          }
          case 'paragraph':
            return (
              <p key={index} className={styles.mdParagraph}>
                <InlineText text={block.text} />
              </p>
            );
          case 'list':
            return <Items key={index} items={block.items} />;
        }
      })}
    </div>
  );
}
