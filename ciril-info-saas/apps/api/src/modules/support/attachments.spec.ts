import { attachmentDisposition, isPlainText, safeFileName, sniffAttachment } from './attachments.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

describe('attachment rules', () => {
  it('recognises allowed files by their content, whatever they are called', () => {
    expect(sniffAttachment(PNG, 'screenshot.exe')?.contentType).toBe('image/png');
    expect(sniffAttachment(PDF, 'invoice')?.contentType).toBe('application/pdf');
    expect(sniffAttachment(Buffer.from('line one\nline two\n'), 'error.LOG')).toEqual({ contentType: 'text/plain', ext: 'log' });
    expect(sniffAttachment(Buffer.from('a,b\n1,2\n'), 'data.csv')?.contentType).toBe('text/plain');
  });

  it('refuses everything else', () => {
    expect(sniffAttachment(Buffer.from('MZ\x90\x00\x03\x00\x00\x00'), 'tool.png')).toBeNull(); // an executable renamed
    expect(sniffAttachment(Buffer.from('PK\x03\x04rest'), 'archive.zip')).toBeNull();
    expect(sniffAttachment(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'logo.svg')).toBeNull();
    expect(sniffAttachment(Buffer.from('<html><script>alert(1)</script></html>'), 'page.html')).toBeNull();
    expect(sniffAttachment(Buffer.from('echo hi'), 'script.sh')).toBeNull();
    expect(sniffAttachment(Buffer.from('plain words'), 'notes')).toBeNull(); // text needs a text extension
    expect(sniffAttachment(Buffer.alloc(0), 'empty.txt')).toEqual({ contentType: 'text/plain', ext: 'txt' }); // an empty text file is harmless
  });

  it('does not accept binary data named as text', () => {
    expect(isPlainText(Buffer.from([0x68, 0x69, 0x00, 0x01]))).toBe(false);
    expect(isPlainText(Buffer.from([0xff, 0xfe, 0xfd]))).toBe(false); // not UTF-8
    expect(sniffAttachment(Buffer.from([0x68, 0x00, 0x69]), 'fake.txt')).toBeNull();
  });

  it('makes file names safe and keeps the extension honest', () => {
    const png = { contentType: 'image/png', ext: 'png' };
    expect(safeFileName('C:\\Users\\me\\Desktop\\My Screenshot.PNG', png)).toBe('My Screenshot.png');
    expect(safeFileName('../../etc/passwd', png)).toBe('passwd.png');
    expect(safeFileName('evil".png', png)).toBe('evil.png');
    expect(safeFileName('a\u0000b\nc.png', png)).toBe('abc.png');
    expect(safeFileName('.hidden', png)).toBe('hidden.png');
    expect(safeFileName('', png)).toBe('file.png');
    expect(safeFileName('x'.repeat(300) + '.png', png).length).toBeLessThanOrEqual(104);
    expect(safeFileName('photo.exe', png)).toBe('photo.png'); // a misleading extension is replaced
  });

  it('forces a download and copes with non-ASCII names', () => {
    const h = attachmentDisposition('résumé "final".pdf');
    expect(h.startsWith('attachment;')).toBe(true);
    expect(h).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22.pdf");
    expect(h).not.toMatch(/filename="[^"]*"[^;]*"/); // no stray quote that could end the value early
  });
});
