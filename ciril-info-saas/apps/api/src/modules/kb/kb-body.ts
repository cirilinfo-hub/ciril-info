/**
 * Knowledge base article bodies are plain text, written in the admin portal:
 *
 *   ## A heading
 *   A paragraph. Lines next to each other join into one paragraph.
 *
 *   - a bullet
 *   - another bullet
 *
 *   1. a numbered step
 *   2. the next step
 *
 * The API turns the text into blocks and the website shows them as text, never as HTML,
 * so nothing an editor types can run in a visitor's browser.
 */
export type KbBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullets'; items: string[] }
  | { type: 'steps'; items: string[] };

const HEADING = /^#{2,3}\s+(.+)$/;
const BULLET = /^[-*]\s+(.+)$/;
const STEP = /^\d{1,3}[.)]\s+(.+)$/;

export function parseKbBody(body: string): KbBlock[] {
  const blocks: KbBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ') });
    para = [];
  };
  const pushItem = (type: 'bullets' | 'steps', item: string) => {
    flush();
    const last = blocks[blocks.length - 1];
    if (last && last.type === type) last.items.push(item);
    else blocks.push({ type, items: [item] });
  };

  for (const raw of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    let m: RegExpMatchArray | null;
    if ((m = line.match(HEADING))) { flush(); blocks.push({ type: 'heading', text: m[1]!.trim() }); continue; }
    if ((m = line.match(BULLET))) { pushItem('bullets', m[1]!.trim()); continue; }
    if ((m = line.match(STEP))) { pushItem('steps', m[1]!.trim()); continue; }
    para.push(line);
  }
  flush();
  return blocks;
}
