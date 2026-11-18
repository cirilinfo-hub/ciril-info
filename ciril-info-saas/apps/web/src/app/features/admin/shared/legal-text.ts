export interface LegalSection {
  heading: string;
  body: string[];
  bullets: string[];
}

/**
 * Plain-text editing format for legal pages:
 *   ## Section heading
 *   A paragraph (blank line between paragraphs).
 *   - A bullet point
 */
export function sectionsToText(sections: LegalSection[]): string {
  return sections
    .map((s) => [`## ${s.heading}`, ...s.body.flatMap((p) => ['', p]), ...(s.bullets.length ? [''] : []), ...s.bullets.map((b) => `- ${b}`)].join('\n'))
    .join('\n\n');
}

export function textToSections(text: string): LegalSection[] {
  const sections: LegalSection[] = [];
  let current: LegalSection | null = null;
  let para: string[] = [];
  const flush = () => {
    if (current && para.length) current.body.push(para.join(' '));
    para = [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      current = { heading: heading[1]!.trim(), body: [], bullets: [] };
      sections.push(current);
    } else if (!line) {
      flush();
    } else if (/^[-•*]\s+/.test(line)) {
      flush();
      current ??= pushSection(sections);
      current.bullets.push(line.replace(/^[-•*]\s+/, ''));
    } else {
      current ??= pushSection(sections);
      para.push(line);
    }
  }
  flush();
  return sections;
}

function pushSection(sections: LegalSection[]): LegalSection {
  const s: LegalSection = { heading: 'Overview', body: [], bullets: [] };
  sections.push(s);
  return s;
}
