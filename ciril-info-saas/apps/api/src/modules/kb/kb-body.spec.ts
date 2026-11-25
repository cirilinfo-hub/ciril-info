import { parseKbBody } from './kb-body.js';
import { searchWords } from './kb.service.js';

describe('knowledge base body', () => {
  it('turns headings, paragraphs, bullets and steps into blocks', () => {
    const body = [
      'First line of a paragraph',
      'continues here.',
      '',
      '## Steps',
      '1. Open Invoices.',
      '2) Choose Pay.',
      '',
      '### Notes',
      '- one',
      '* two',
      'After the list.',
    ].join('\r\n');
    expect(parseKbBody(body)).toEqual([
      { type: 'paragraph', text: 'First line of a paragraph continues here.' },
      { type: 'heading', text: 'Steps' },
      { type: 'steps', items: ['Open Invoices.', 'Choose Pay.'] },
      { type: 'heading', text: 'Notes' },
      { type: 'bullets', items: ['one', 'two'] },
      { type: 'paragraph', text: 'After the list.' },
    ]);
  });

  it('keeps markup as plain text (it is never rendered as HTML)', () => {
    expect(parseKbBody('<script>alert(1)</script>')).toEqual([{ type: 'paragraph', text: '<script>alert(1)</script>' }]);
  });

  it('does not treat a single # or a bare number as structure', () => {
    expect(parseKbBody('# not a heading\n2026 was a good year')).toEqual([{ type: 'paragraph', text: '# not a heading 2026 was a good year' }]);
  });

  it('returns nothing for an empty body', () => {
    expect(parseKbBody(' \n \n')).toEqual([]);
  });
});

describe('help search words', () => {
  it('drops filler words, punctuation and repeats', () => {
    expect(searchWords('My e-mail will NOT send, my email!')).toEqual(['mail', 'send', 'email']);
  });
  it('keeps non-English letters and digits, and caps the number of words', () => {
    expect(searchWords('डोमेन ssl 2fa')).toEqual(['डोमेन', 'ssl', '2fa']);
    expect(searchWords('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10')).toHaveLength(8);
  });
  it('returns nothing for filler-only or empty searches', () => {
    expect(searchWords('how do i')).toEqual([]);
    expect(searchWords(undefined)).toEqual([]);
  });
});
