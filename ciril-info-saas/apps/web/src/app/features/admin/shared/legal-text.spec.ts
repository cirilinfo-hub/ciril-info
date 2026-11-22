import { sectionsToText, textToSections } from './legal-text';

describe('legal text format', () => {
  const sections = [
    { heading: 'What we collect', body: ['First paragraph.', 'Second paragraph.'], bullets: ['Name', 'Email'] },
    { heading: 'Contact', body: ['Write to us.'], bullets: [] },
  ];

  it('round-trips sections through the editing format', () => {
    expect(textToSections(sectionsToText(sections))).toEqual(sections);
  });

  it('joins wrapped lines into one paragraph and ignores extra blank lines', () => {
    const out = textToSections('## A\n\nline one\nline two\n\n\n\nnext');
    expect(out).toEqual([{ heading: 'A', body: ['line one line two', 'next'], bullets: [] }]);
  });

  it('puts text before the first heading in an Overview section', () => {
    expect(textToSections('Hello')).toEqual([{ heading: 'Overview', body: ['Hello'], bullets: [] }]);
  });

  it('returns nothing for empty text', () => {
    expect(textToSections('  \n ')).toEqual([]);
  });
});
