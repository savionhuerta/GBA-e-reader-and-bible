import { strFromU8, unzipSync } from 'fflate';
import {
  normalizeForGba,
  parseBibleJson,
  ParsedBook,
  ParsedChapter,
  ParsedVerse,
  ParseReport,
} from './bibleParser';

export interface DocumentParseOptions {
  stripGutenbergBoilerplate?: boolean;
  maxChapterBytes?: number;
}

const DEFAULT_MAX_CHAPTER_BYTES = 12_500; // Safe headroom under 64 KB GBA EWRAM buffer & 16k line table

const KNOWN_BOOK_CODES: Array<{ pattern: RegExp; code: string; name?: string }> = [
  { pattern: /\besv\b|english.?standard/i, code: 'ESV', name: 'English Standard Ver.' },
  { pattern: /\bnkjv\b|new.?king.?james/i, code: 'NKJV', name: 'New King James Version' },
  { pattern: /\bkjv\b|king.?james/i, code: 'KJV', name: 'King James Version' },
  { pattern: /\bnasb\b|new.?american.?standard/i, code: 'NASB', name: 'New American Standard' },
  { pattern: /\bniv\b|new.?international/i, code: 'NIV', name: 'New International Ver.' },
  { pattern: /\bweb\b|world.?english/i, code: 'WEB', name: 'World English Bible' },
  { pattern: /meditations/i, code: 'MEDIT' },
  { pattern: /frankenstein/i, code: 'FRANK' },
  { pattern: /odyssey/i, code: 'ODYSS' },
  { pattern: /iliad/i, code: 'ILIAD' },
  { pattern: /dracula/i, code: 'DRACU' },
  { pattern: /pride.?and.?prejudice/i, code: 'PRIDE' },
  { pattern: /moby.?dick/i, code: 'MOBY' },
  { pattern: /sherlock/i, code: 'HOLMS' },
  { pattern: /republic/i, code: 'REPUB' },
  { pattern: /handbook|manual|guide/i, code: 'GUIDE' },
];

export function inferVolumeMeta(
  fileName: string,
  report: ParseReport,
  existingCount: number
): { code: string; name: string } {
  const cleanFileBase = fileName
    .replace(/\.(json|txt|md|markdown|epub|html|htm)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const preferredTitle =
    report.books.length === 1 &&
    report.books[0].name &&
    report.books[0].name !== 'Unknown' &&
    report.books[0].name !== 'Main Text'
      ? report.books[0].name
      : cleanFileBase;

  const probe = `${cleanFileBase} ${preferredTitle}`;
  for (const known of KNOWN_BOOK_CODES) {
    if (known.pattern.test(probe)) {
      return {
        code: known.code,
        name: (known.name ?? (preferredTitle || cleanFileBase)).slice(0, 23),
      };
    }
  }

  // Derive crisp 4-5 char shelf code from title words
  const words = (preferredTitle || cleanFileBase)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !['THE', 'A', 'AN', 'OF'].includes(w));

  let code = '';
  if (words.length >= 2) {
    code = words
      .slice(0, 5)
      .map((w) => w[0])
      .join('');
    if (code.length < 3) {
      code = words[0].slice(0, 5);
    }
  } else if (words.length === 1) {
    code = words[0].slice(0, 5);
  }
  code = (code || `BK${existingCount + 1}`).replace(/[^A-Z0-9_-]/g, '').slice(0, 7);

  const name = (preferredTitle || cleanFileBase || `Book ${existingCount + 1}`).slice(0, 23);
  return { code, name };
}

function makeAccent(text: string): string {
  const clean = normalizeForGba(text);
  return clean ? `\x01${clean}\x02` : '';
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&ldquo;/gi, '\u201C')
    .replace(/&rdquo;/gi, '\u201D')
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&mdash;/gi, '\u2014')
    .replace(/&ndash;/gi, '\u2013')
    .replace(/&hellip;/gi, '\u2026')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    });
}

function stripGutenbergWrapper(raw: string): { text: string; stripped: boolean; title?: string; author?: string } {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let startIdx = -1;
  let endIdx = lines.length;
  let title: string | undefined;
  let author: string | undefined;

  const headScanLimit = Math.min(lines.length, 160);
  for (let i = 0; i < headScanLimit; i++) {
    const line = lines[i].trim();
    if (!title && /^Title:\s*(.+)$/i.test(line)) {
      title = line.replace(/^Title:\s*/i, '').trim();
    }
    if (!author && /^Author:\s*(.+)$/i.test(line)) {
      author = line.replace(/^Author:\s*/i, '').trim();
    }
    if (/\*\*\*\s*START OF (THIS|THE) PROJECT GUTENBERG/i.test(line)) {
      startIdx = i + 1;
      break;
    }
  }

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 450); i--) {
    const line = lines[i].trim();
    if (/\*\*\*\s*END OF (THIS|THE) PROJECT GUTENBERG/i.test(line)) {
      endIdx = i;
      break;
    }
  }

  if (startIdx >= 0 || endIdx < lines.length) {
    const sliced = lines.slice(Math.max(0, startIdx), endIdx).join('\n').trim();
    return { text: sliced, stripped: true, title, author };
  }

  return { text: lines.join('\n'), stripped: false, title, author };
}

function chunkParagraphsIntoChapters(
  sections: Array<{ title: string; paragraphs: string[] }>,
  maxChapterBytes: number
): ParsedChapter[] {
  const chapters: ParsedChapter[] = [];
  let chapterNum = 1;

  for (const section of sections) {
    const cleanParas = section.paragraphs.map((p) => p.trim()).filter((p) => p.length > 0);
    if (cleanParas.length === 0) continue;

    let currentVerses: ParsedVerse[] = [];
    let currentBytes = 0;
    let chunkPart = 1;

    const pushChunk = (isSplitCont: boolean) => {
      if (currentVerses.length === 0) return;
      const versesOut: ParsedVerse[] = [];
      let vNum = 1;
      const heading = isSplitCont
        ? `${section.title} (Cont. ${chunkPart})`
        : section.title;
      if (heading && !heading.startsWith('Section ')) {
        const accented = makeAccent(heading);
        if (accented) {
          versesOut.push({ verse: vNum++, text: accented });
        }
      }
      for (const item of currentVerses) {
        versesOut.push({ verse: vNum++, text: item.text });
      }
      chapters.push({
        chapter: chapterNum++,
        verses: versesOut,
      });
      currentVerses = [];
      currentBytes = 0;
      chunkPart++;
    };

    for (const para of cleanParas) {
      const byteCost = para.length + 12;
      if (currentVerses.length > 0 && currentBytes + byteCost > maxChapterBytes) {
        pushChunk(chunkPart > 1);
      }

      // Guard single giant wall-of-text paragraph (> maxChapterBytes) by splitting cleanly at sentence/word boundaries
      if (para.length > maxChapterBytes - 400) {
        let rest = para;
        while (rest.length > 0) {
          if (rest.length <= maxChapterBytes - 400) {
            currentVerses.push({ verse: currentVerses.length + 1, text: rest });
            currentBytes += rest.length + 12;
            break;
          }
          const sliceLimit = maxChapterBytes - 600;
          let cut = rest.lastIndexOf('. ', sliceLimit);
          if (cut < sliceLimit * 0.4) cut = rest.lastIndexOf(' ', sliceLimit);
          if (cut < 100) cut = sliceLimit;
          else cut += 1;
          const part = rest.slice(0, cut).trim();
          rest = rest.slice(cut).trim();
          if (part) {
            currentVerses.push({ verse: currentVerses.length + 1, text: part });
            pushChunk(chunkPart > 1);
          }
        }
      } else {
        currentVerses.push({ verse: currentVerses.length + 1, text: para });
        currentBytes += byteCost;
      }
    }

    if (currentVerses.length > 0) {
      pushChunk(chunkPart > 1);
    }
  }

  return chapters;
}

const TXT_CHAPTER_HEADING_RE =
  /^(?:CHAPTER|Chapter|PART|Part|BOOK|Book|ACT|Act|LETTER|Letter|CANTO|Canto|SECTION|Section)\s+(?:[IVXLCDM]+|\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve)\b.*$|^(?:PROLOGUE|Prologue|EPILOGUE|Epilogue|PREFACE|Preface|INTRODUCTION|Introduction|APPENDIX|Appendix)\b.*$|^[IVXLCDM]{1,6}\.?$/;

function unwrapTextBlockToParagraphs(blockLines: string[]): string[] {
  const out: string[] = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length === 0) return;
    const joined = normalizeForGba(buf.join(' '));
    if (joined) out.push(joined);
    buf = [];
  };

  for (const rawLine of blockLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flush();
      continue;
    }
    // Preserve explicit list items or dialogue/verse markers on new paragraphs
    if (/^(?:[-*•]|\d+[.)])\s+/.test(trimmed)) {
      flush();
      const normalized = normalizeForGba(trimmed.replace(/^[-*]\s+/, '\u2022 '));
      if (normalized) out.push(normalized);
      continue;
    }
    buf.push(trimmed);
  }
  flush();
  return out;
}

function finalizeBookReport(
  books: ParsedBook[],
  sourceName: string,
  detectedFormat: string,
  rawSample: string,
  warnings: string[],
  author?: string,
  libraryMode: 'book' | 'bible' = 'book'
): ParseReport {
  const cleanBooks = books.filter((b) => b.chapters.length > 0);
  if (cleanBooks.length === 0) {
    throw new Error(`No readable paragraphs or chapters could be extracted from "${sourceName}".`);
  }

  let totalChapters = 0;
  let totalVerses = 0;
  let totalBytes = 0;
  for (const b of cleanBooks) {
    totalChapters += b.chapters.length;
    for (const c of b.chapters) {
      totalVerses += c.verses.length;
      for (const v of c.verses) {
        totalBytes += v.text.length + 4;
      }
    }
  }

  return {
    books: cleanBooks,
    totalBooks: cleanBooks.length,
    totalChapters,
    totalVerses,
    totalBytes,
    detectedFormat,
    warnings,
    sourceName,
    rawPreview: rawSample.slice(0, 1200),
    libraryMode,
    author,
  };
}

export function parsePlainTextDocument(
  rawText: string,
  sourceName: string,
  options: DocumentParseOptions = {}
): ParseReport {
  const warnings: string[] = [];
  const maxBytes = options.maxChapterBytes ?? DEFAULT_MAX_CHAPTER_BYTES;
  const shouldStripGut = options.stripGutenbergBoilerplate !== false;

  let working = rawText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let detectedTitle = sourceName.replace(/\.txt$/i, '').replace(/[_-]+/g, ' ').trim();
  let author: string | undefined;

  if (shouldStripGut) {
    const gut = stripGutenbergWrapper(working);
    working = gut.text;
    if (gut.title) detectedTitle = gut.title;
    if (gut.author) author = gut.author;
    if (gut.stripped) {
      warnings.push('Stripped Project Gutenberg header/license footer automatically.');
    }
  }

  const lines = working.split('\n');
  const sections: Array<{ title: string; paragraphs: string[] }> = [];
  let currentTitle = 'Opening';
  let currentBlock: string[] = [];

  const flushSection = () => {
    const rawParas = currentBlock.join('\n').split(/\n\s*\n/);
    const paras: string[] = [];
    for (const block of rawParas) {
      paras.push(...unwrapTextBlockToParagraphs(block.split('\n')));
    }
    if (paras.length > 0) {
      sections.push({ title: currentTitle, paragraphs: paras });
    }
    currentBlock = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      currentBlock.push('');
      continue;
    }

    const prevBlank = i === 0 || lines[i - 1].trim() === '';
    const nextBlank = i === lines.length - 1 || lines[i + 1].trim() === '';
    const explicitChapterDelimiter =
      /^(?:CHAPTER|Chapter|PART|Part|BOOK|Book|ACT|Act|LETTER|Letter|CANTO|Canto|SECTION|Section)\s+(?:[IVXLCDM]+|\d+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve)\s*(?:$|[:.\-\u2013\u2014])/.test(
        trimmed
      );
    if (
      prevBlank &&
      (nextBlank || explicitChapterDelimiter) &&
      trimmed.length <= 72 &&
      TXT_CHAPTER_HEADING_RE.test(trimmed)
    ) {
      flushSection();
      currentTitle = trimmed.replace(/\s+/g, ' ').slice(0, 48);
      continue;
    }

    currentBlock.push(lines[i]);
  }
  flushSection();

  if (sections.length === 0) {
    throw new Error(`Plain text file "${sourceName}" appears empty.`);
  }

  if (sections.length === 1 && sections[0].title === 'Opening') {
    sections[0].title = detectedTitle || 'Section 1';
  }

  const chapters = chunkParagraphsIntoChapters(sections, maxBytes);
  const bookName = (detectedTitle || sourceName.replace(/\.txt$/i, '') || 'Document').slice(0, 23);
  const book: ParsedBook = {
    name: bookName,
    abbrev: bookName.slice(0, 4).toUpperCase(),
    testament: 'Other',
    chapters,
  };

  return finalizeBookReport(
    [book],
    sourceName,
    'Plain Text (.txt)',
    rawText,
    warnings,
    author,
    'book'
  );
}

function cleanMarkdownInline(line: string): string {
  let s = line
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1');

  // Preserve short **bold** highlights using GBA accent tokens (\x01...\x02)
  const segments: Array<{ accent: boolean; text: string }> = [];
  const boldRe = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = boldRe.exec(s)) !== null) {
    if (m.index > lastIdx) {
      segments.push({ accent: false, text: s.slice(lastIdx, m.index) });
    }
    const inner = (m[1] ?? m[2] ?? '').trim();
    if (inner) {
      segments.push({ accent: inner.length <= 28, text: inner });
    }
    lastIdx = boldRe.lastIndex;
  }
  if (lastIdx < s.length) {
    segments.push({ accent: false, text: s.slice(lastIdx) });
  }

  const normalized = segments
    .map((seg) => {
      const clean = normalizeForGba(seg.text.replace(/\*([^*]+)\*/g, '$1').replace(/_([^_]+)_/g, '$1'));
      if (!clean) return '';
      return seg.accent ? `\x01${clean}\x02` : clean;
    })
    .filter(Boolean)
    .join(' ');

  return normalized.replace(/\s{2,}/g, ' ').trim();
}

export function parseMarkdownDocument(
  rawMd: string,
  sourceName: string,
  options: DocumentParseOptions = {}
): ParseReport {
  const maxBytes = options.maxChapterBytes ?? DEFAULT_MAX_CHAPTER_BYTES;
  let working = rawMd.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let docTitle = sourceName.replace(/\.(md|markdown)$/i, '').replace(/[_-]+/g, ' ').trim();
  let author: string | undefined;

  // Extract optional YAML frontmatter
  if (working.startsWith('---\n')) {
    const endFm = working.indexOf('\n---\n', 4);
    if (endFm > 0) {
      const fm = working.slice(4, endFm);
      const tMatch = fm.match(/^title:\s*["']?(.+?)["']?$/m);
      const aMatch = fm.match(/^author:\s*["']?(.+?)["']?$/m);
      if (tMatch?.[1]) docTitle = tMatch[1].trim();
      if (aMatch?.[1]) author = aMatch[1].trim();
      working = working.slice(endFm + 5);
    }
  }

  const lines = working.split('\n');
  let h1Count = 0;
  let h2Count = 0;
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCode = !inCode;
      continue;
    }
    if (inCode) continue;
    if (/^#\s+/.test(line)) h1Count++;
    else if (/^##\s+/.test(line)) h2Count++;
  }

  // If there are multiple H1s AND multiple H2s, H1 = Part/Book & H2 = Chapter; otherwise split cleanly at top headings
  const splitPartsByH1 = h1Count >= 2 && h2Count >= 2;

  interface MdSection {
    partName: string;
    chapTitle: string;
    paragraphs: string[];
  }
  const sections: MdSection[] = [];
  let curPart = docTitle || 'Document';
  let curChap = docTitle || 'Overview';
  let paraBuf: string[] = [];
  let curParas: string[] = [];
  inCode = false;

  const flushPara = () => {
    if (paraBuf.length === 0) return;
    const cleaned = cleanMarkdownInline(paraBuf.join(' '));
    if (cleaned) curParas.push(cleaned);
    paraBuf = [];
  };

  const flushSection = () => {
    flushPara();
    if (curParas.length > 0) {
      sections.push({ partName: curPart, chapTitle: curChap, paragraphs: curParas });
    }
    curParas = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (/^```/.test(trimmed)) {
      flushPara();
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      const codeNorm = normalizeForGba(rawLine);
      if (codeNorm) curParas.push(codeNorm);
      continue;
    }

    if (!trimmed || /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      continue;
    }

    const hMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const headingText = hMatch[2].replace(/\s+#*$/, '').trim();
      if (splitPartsByH1 && level === 1) {
        flushSection();
        curPart = normalizeForGba(headingText).slice(0, 23) || curPart;
        curChap = headingText;
        continue;
      }
      if ((splitPartsByH1 && level === 2) || (!splitPartsByH1 && level <= 2)) {
        flushSection();
        if (level === 1 && h1Count === 1 && !docTitle) docTitle = headingText;
        curChap = headingText;
        continue;
      }
      // Sub-heading H3/H4 inside chapter
      flushPara();
      const acc = makeAccent(headingText);
      if (acc) curParas.push(acc);
      continue;
    }

    // Bullet / ordered list / blockquote
    if (/^[-*+]\s+/.test(trimmed)) {
      flushPara();
      const item = cleanMarkdownInline(`\u2022 ${trimmed.replace(/^[-*+]\s+/, '')}`);
      if (item) curParas.push(item);
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      flushPara();
      const item = cleanMarkdownInline(trimmed);
      if (item) curParas.push(item);
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      flushPara();
      const quote = cleanMarkdownInline(trimmed.replace(/^>\s?/, ''));
      if (quote) curParas.push(quote);
      continue;
    }

    paraBuf.push(trimmed);
  }
  flushSection();

  if (sections.length === 0) {
    throw new Error(`Markdown file "${sourceName}" has no readable text.`);
  }

  // Group sections by partName
  const partOrder: string[] = [];
  const partMap = new Map<string, Array<{ title: string; paragraphs: string[] }>>();
  for (const s of sections) {
    if (!partMap.has(s.partName)) {
      partMap.set(s.partName, []);
      partOrder.push(s.partName);
    }
    partMap.get(s.partName)!.push({ title: s.chapTitle, paragraphs: s.paragraphs });
  }

  const books: ParsedBook[] = partOrder.map((pName) => {
    const chaps = chunkParagraphsIntoChapters(partMap.get(pName)!, maxBytes);
    return {
      name: pName.slice(0, 23),
      abbrev: pName.slice(0, 4).toUpperCase() || 'DOC',
      testament: 'Other',
      chapters: chaps,
    };
  });

  return finalizeBookReport(
    books,
    sourceName,
    'Markdown (.md)',
    rawMd,
    [],
    author,
    'book'
  );
}

function extractHtmlSectionsFallback(html: string): { title?: string; sections: Array<{ title: string; paragraphs: string[] }> } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const docTitle = titleMatch ? normalizeForGba(decodeHtmlEntities(titleMatch[1])) : undefined;

  let body = html;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) body = bodyMatch[1];

  body = body
    .replace(/<(script|style|head|svg|nav)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n');

  const sections: Array<{ title: string; paragraphs: string[] }> = [];
  let curTitle = docTitle || 'Section 1';
  let curParas: string[] = [];

  const blockRe = /<(h[1-4]|p|li|blockquote|pre|div)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(body)) !== null) {
    const tag = match[1].toLowerCase();
    const innerRaw = match[2];
    // Skip wrapper divs that contain nested paragraphs/headings
    if (tag === 'div' && /<(h[1-6]|p|div|li|blockquote)\b/i.test(innerRaw)) continue;
    const text = normalizeForGba(decodeHtmlEntities(innerRaw.replace(/<[^>]+>/g, ' ')));
    if (!text) continue;

    if (tag === 'h1' || tag === 'h2') {
      if (curParas.length > 0) {
        sections.push({ title: curTitle, paragraphs: curParas });
        curParas = [];
      }
      curTitle = text;
    } else if (tag === 'h3' || tag === 'h4') {
      const acc = makeAccent(text);
      if (acc) curParas.push(acc);
    } else if (tag === 'li') {
      curParas.push(normalizeForGba(`\u2022 ${text}`));
    } else {
      curParas.push(text);
    }
  }

  if (curParas.length > 0) {
    sections.push({ title: curTitle, paragraphs: curParas });
  }

  // Fallback if HTML used flat text without <p> tags
  if (sections.length === 0) {
    const stripped = decodeHtmlEntities(body.replace(/<[^>]+>/g, '\n'));
    const paras = stripped
      .split(/\n\s*\n/)
      .map((p) => normalizeForGba(p))
      .filter(Boolean);
    if (paras.length > 0) {
      sections.push({ title: curTitle, paragraphs: paras });
    }
  }

  return { title: docTitle, sections };
}

function extractHtmlSections(html: string): { title?: string; sections: Array<{ title: string; paragraphs: string[] }> } {
  if (typeof DOMParser === 'undefined') {
    return extractHtmlSectionsFallback(html);
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const docTitle = doc.title ? normalizeForGba(doc.title) : undefined;
    const body = doc.body;
    if (!body) return extractHtmlSectionsFallback(html);

    body.querySelectorAll('script, style, svg, nav').forEach((el) => el.remove());

    const sections: Array<{ title: string; paragraphs: string[] }> = [];
    let curTitle = docTitle || 'Section 1';
    let curParas: string[] = [];

    const walk = (node: Element) => {
      const tag = node.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2') {
        const text = normalizeForGba(node.textContent ?? '');
        if (text) {
          if (curParas.length > 0) {
            sections.push({ title: curTitle, paragraphs: curParas });
            curParas = [];
          }
          curTitle = text;
        }
        return;
      }
      if (tag === 'h3' || tag === 'h4') {
        const text = makeAccent(node.textContent ?? '');
        if (text) curParas.push(text);
        return;
      }
      if (tag === 'p' || tag === 'blockquote' || tag === 'pre') {
        const text = normalizeForGba(node.textContent ?? '');
        if (text) curParas.push(text);
        return;
      }
      if (tag === 'li') {
        const text = normalizeForGba(`\u2022 ${node.textContent ?? ''}`);
        if (text) curParas.push(text);
        return;
      }

      if (node.children.length === 0) {
        const text = normalizeForGba(node.textContent ?? '');
        if (text) curParas.push(text);
        return;
      }

      for (const child of Array.from(node.children)) {
        walk(child);
      }
    };

    for (const child of Array.from(body.children)) {
      walk(child);
    }

    if (curParas.length > 0) {
      sections.push({ title: curTitle, paragraphs: curParas });
    }

    if (sections.length === 0) {
      return extractHtmlSectionsFallback(html);
    }
    return { title: docTitle, sections };
  } catch {
    return extractHtmlSectionsFallback(html);
  }
}

export function parseHtmlDocument(
  rawHtml: string,
  sourceName: string,
  options: DocumentParseOptions = {}
): ParseReport {
  const maxBytes = options.maxChapterBytes ?? DEFAULT_MAX_CHAPTER_BYTES;
  const extracted = extractHtmlSections(rawHtml);
  const cleanTitle = (
    extracted.title ||
    sourceName.replace(/\.(html?|xhtml)$/i, '').replace(/[_-]+/g, ' ').trim() ||
    'HTML Book'
  ).slice(0, 23);

  const chapters = chunkParagraphsIntoChapters(extracted.sections, maxBytes);
  const book: ParsedBook = {
    name: cleanTitle,
    abbrev: cleanTitle.slice(0, 4).toUpperCase() || 'HTML',
    testament: 'Other',
    chapters,
  };

  return finalizeBookReport(
    [book],
    sourceName,
    'HTML Document',
    rawHtml,
    [],
    undefined,
    'book'
  );
}

function resolveZipPath(baseDir: string, href: string): string {
  const cleanHref = decodeURIComponent(href.split('#')[0]).replace(/^\.\//, '');
  if (!baseDir || cleanHref.startsWith('/')) {
    return cleanHref.replace(/^\/+/, '');
  }
  const combined = `${baseDir}/${cleanHref}`.split('/');
  const resolved: string[] = [];
  for (const part of combined) {
    if (!part || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  return resolved.join('/');
}

function getZipEntryText(entries: Record<string, Uint8Array>, targetPath: string): string | null {
  if (entries[targetPath]) return strFromU8(entries[targetPath]);
  const lower = targetPath.toLowerCase();
  for (const key of Object.keys(entries)) {
    if (key.toLowerCase() === lower) {
      return strFromU8(entries[key]);
    }
  }
  return null;
}

function parseXmlAttr(tag: string, attrName: string): string | undefined {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = tag.match(re);
  return m ? decodeHtmlEntities((m[1] ?? m[2] ?? '').trim()) : undefined;
}

export function parseEpubBytes(
  epubBytes: Uint8Array,
  sourceName: string,
  options: DocumentParseOptions = {}
): ParseReport {
  const maxBytes = options.maxChapterBytes ?? DEFAULT_MAX_CHAPTER_BYTES;
  const warnings: string[] = [];

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(epubBytes);
  } catch (err) {
    throw new Error(
      `Failed to unzip EPUB "${sourceName}": ${err instanceof Error ? err.message : 'Invalid ZIP archive'}`
    );
  }

  // Locate OPF path from META-INF/container.xml (or scan for *.opf)
  let opfPath: string | undefined;
  const containerXml = getZipEntryText(entries, 'META-INF/container.xml');
  if (containerXml) {
    const rootfileMatch = containerXml.match(/<rootfile\b[^>]*>/i);
    if (rootfileMatch) {
      opfPath = parseXmlAttr(rootfileMatch[0], 'full-path');
    }
  }
  if (!opfPath) {
    opfPath = Object.keys(entries).find((k) => /\.opf$/i.test(k));
  }
  if (!opfPath) {
    throw new Error(`EPUB "${sourceName}" is missing an OPF package manifest.`);
  }

  const opfText = getZipEntryText(entries, opfPath);
  if (!opfText) {
    throw new Error(`EPUB "${sourceName}" referenced "${opfPath}" which could not be read.`);
  }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const titleMatch = opfText.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const authorMatch = opfText.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const bookTitle = (
    (titleMatch ? normalizeForGba(decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, ''))) : '') ||
    sourceName.replace(/\.epub$/i, '').replace(/[_-]+/g, ' ').trim() ||
    'EPUB Book'
  ).slice(0, 23);
  const author = authorMatch
    ? normalizeForGba(decodeHtmlEntities(authorMatch[1].replace(/<[^>]+>/g, '')))
    : undefined;

  // Build manifest map: id -> { href, mediaType, properties }
  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  const itemTagRe = /<item\b[^>]*>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemTagRe.exec(opfText)) !== null) {
    const tag = itemMatch[0];
    const id = parseXmlAttr(tag, 'id');
    const href = parseXmlAttr(tag, 'href');
    const mediaType = parseXmlAttr(tag, 'media-type') ?? '';
    const properties = parseXmlAttr(tag, 'properties') ?? '';
    if (id && href) {
      manifest.set(id, { href, mediaType, properties });
    }
  }

  // Extract spine reading order
  const spineIds: string[] = [];
  const spineItemRe = /<itemref\b[^>]*>/gi;
  let sMatch: RegExpExecArray | null;
  while ((sMatch = spineItemRe.exec(opfText)) !== null) {
    const idref = parseXmlAttr(sMatch[0], 'idref');
    const linear = parseXmlAttr(sMatch[0], 'linear');
    if (idref && linear !== 'no') {
      spineIds.push(idref);
    }
  }

  const sections: Array<{ title: string; paragraphs: string[] }> = [];
  let rawSample = '';

  const spinePaths =
    spineIds.length > 0
      ? spineIds
          .map((id) => manifest.get(id))
          .filter((m): m is { href: string; mediaType: string; properties: string } => Boolean(m))
          .filter((m) => !/\bnav\b/i.test(m.properties))
      : Array.from(manifest.values()).filter((m) => /html|xhtml/i.test(m.mediaType) || /\.(x?html?|htm)$/i.test(m.href));

  for (let i = 0; i < spinePaths.length; i++) {
    const entry = spinePaths[i];
    if (entry.mediaType && !/html|xml/i.test(entry.mediaType) && !/\.(x?html?|htm)$/i.test(entry.href)) {
      continue;
    }
    const zipPath = resolveZipPath(opfDir, entry.href);
    const html = getZipEntryText(entries, zipPath);
    if (!html) continue;

    const extracted = extractHtmlSections(html);
    if (extracted.sections.length === 0) continue;

    if (!rawSample) {
      rawSample = extracted.sections
        .slice(0, 2)
        .flatMap((s) => [s.title, ...s.paragraphs.slice(0, 4)])
        .join('\n\n');
    }

    for (const sec of extracted.sections) {
      const totalChars = sec.paragraphs.reduce((s, p) => s + p.length, 0);
      if (totalChars === 0) continue;
      // Skip tiny standalone cover/titlepage artifacts that only contain 1 line matching book title
      const secTitle =
        sec.title && sec.title !== 'Section 1'
          ? sec.title
          : `Chapter ${sections.length + 1}`;
      sections.push({
        title: secTitle,
        paragraphs: sec.paragraphs,
      });
    }
  }

  if (sections.length === 0) {
    throw new Error(
      `No readable text content found inside EPUB "${sourceName}". Ensure the EPUB is DRM-free.`
    );
  }

  const chapters = chunkParagraphsIntoChapters(sections, maxBytes);
  const book: ParsedBook = {
    name: bookTitle,
    abbrev: bookTitle.slice(0, 4).toUpperCase() || 'EPUB',
    testament: 'Other',
    chapters,
  };

  return finalizeBookReport(
    [book],
    sourceName,
    'EPUB E-Book (.epub)',
    rawSample || opfText,
    warnings,
    author,
    'book'
  );
}

export async function parseDocumentFile(
  file: File,
  options: DocumentParseOptions = {}
): Promise<ParseReport> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.epub')) {
    const buf = new Uint8Array(await file.arrayBuffer());
    return parseEpubBytes(buf, file.name, options);
  }

  const text = await file.text();
  if (lower.endsWith('.json')) {
    const report = parseBibleJson(text, file.name);
    const hasBibleTestaments = report.books.some(
      (b) => b.testament === 'OT' || b.testament === 'NT'
    );
    return {
      ...report,
      libraryMode: hasBibleTestaments ? 'bible' : 'book',
    };
  }

  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return parseMarkdownDocument(text, file.name, options);
  }

  if (lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.xhtml')) {
    return parseHtmlDocument(text, file.name, options);
  }

  return parsePlainTextDocument(text, file.name, options);
}

export function parseDocumentString(
  content: string,
  fileName: string,
  options: DocumentParseOptions = {}
): ParseReport {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json') || content.trimStart().startsWith('{') || content.trimStart().startsWith('[')) {
    try {
      const report = parseBibleJson(content, fileName);
      const hasBibleTestaments = report.books.some(
        (b) => b.testament === 'OT' || b.testament === 'NT'
      );
      return {
        ...report,
        libraryMode: hasBibleTestaments ? 'bible' : 'book',
      };
    } catch {
      if (lower.endsWith('.json')) throw new Error('Invalid JSON structure.');
    }
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return parseMarkdownDocument(content, fileName, options);
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return parseHtmlDocument(content, fileName, options);
  }
  // Auto-detect Markdown headings if extension wasn't explicit
  if (/^#{1,3}\s+\S/m.test(content)) {
    return parseMarkdownDocument(content, fileName, options);
  }
  return parsePlainTextDocument(content, fileName, options);
}

// Built-in public-domain sample library so users can test a multi-book GBA E-Reader ROM immediately
export const DEMO_MEDITATIONS_TXT = `Title: Meditations (Books I-III)
Author: Marcus Aurelius

CHAPTER 1. Book I — Debts and Lessons

From my grandfather Verus I learned good morals and the government of my temper.

From the reputation and remembrance of my father, modesty and a manly character.

From my mother, piety and beneficence, and abstinence, not only from evil deeds, but even from evil thoughts; and further, simplicity in my way of living, far removed from the habits of the rich.

From my governor, to be neither of the green nor of the blue party at the games in the Circus, nor a partizan either of the Parmularius or the Scutarius at the gladiators' fights; from him too I learned endurance of labour, and to want little, and to work with my own hands, and not to meddle with other people's affairs, and not to be ready to listen to slander.

CHAPTER 2. Book II — Dawn Reflections

Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant, deceitful, envious, unsocial. All these things happen to them by reason of their ignorance of what is good and evil.

But I who have seen the nature of the good that it is beautiful, and of the bad that it is ugly, and the nature of him who does wrong, that it is akin to me, not only of the same blood or seed, but that it participates in the same intelligence and the same portion of the divinity, I can neither be injured by any of them.

Do the things external which fall upon thee distract thee? Give thyself time to learn something new and good, and cease to be whirled around.

CHAPTER 3. Book III — The Present Moment

Though thou shouldest be going to live three thousand years, and as many times ten thousand years, still remember that no man loses any other life than this which he now lives, nor lives any other than this which he now loses.

The longest and shortest are thus brought to the same. For the present is the same to all, though that which perishes is not the same; and so that which is lost appears to be a mere moment.

Waste not the remainder of thy life in thoughts about others, when thou dost not make this thought refer to some object of common utility.
`;

export const DEMO_ART_OF_WAR_MD = `---
title: The Art of War
author: Sun Tzu (Public Domain)
---

# Chapter I: Laying Plans

Sun Tzu said: The art of war is of vital importance to the State. It is a matter of life and death, a road either to safety or to ruin.

Hence it is a subject of inquiry which can on no account be neglected.

The art of war, then, is governed by **five constant factors**, to be taken into account in one's deliberations, when seeking to determine the conditions obtaining in the field:

- The Moral Law
- Heaven
- Earth
- The Commander
- Method and discipline

# Chapter II: Waging War

In the operations of war, where there are in the field a thousand swift chariots, as many heavy chariots, and a hundred thousand mail-clad soldiers, with provisions enough to carry them a thousand li, the expenditure at home and at the front will reach the total of a thousand ounces of silver per day.

When you engage in actual fighting, if victory is long in coming, then men's weapons will grow dull and their ardor will be damped.

Therefore a wise general makes a point of foraging on the enemy. One cartload of the enemy's provisions is equivalent to **twenty of one's own**.

# Chapter III: Attack by Stratagem

In the practical art of war, the best thing of all is to take the enemy's country whole and intact; to shatter and destroy it is not so good.

Hence to fight and conquer in all your battles is not supreme excellence; **supreme excellence** consists in breaking the enemy's resistance without fighting.

Know the enemy and know yourself; in a hundred battles you will never be in peril.
`;

export const DEMO_HANDBOOK_MD = `---
title: Pocket Reader Guide
---

# Hardware Controls

Your Game Boy Advance E-Reader cartridge stores full books compressed with **Byte-Pair Encoding** alongside a binary-searched word concordance.

- **D-Pad Up / Down**: Scroll one line at a time
- **D-Pad Left / Right**: Jump one full page back or forward
- **L / R Bumpers**: Previous or Next chapter
- **L + R Together**: Return to your Library Shelf
- **B (while reading)**: Save a quick SRAM bookmark
- **SELECT (tap)**: Cycle 4 IPS & AGB palettes

# Search & Layout

Because modded IPS displays wire brightness controls to **SELECT + L/R**, typography shortcuts live safely on **START**:

- **START + L**: Toggle Spacious Paragraphs vs Compact Lines
- **START + R**: Toggle 14 Lines (9px) vs 16 Lines (8px)
- **START + A**: Open Full-Text Search & Snippets

Every book on your shelf saves its own chapter and scroll position automatically inside flashcart **SRAM_V113** memory.
`;
