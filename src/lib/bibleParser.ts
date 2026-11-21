export interface ParsedVerse {
  verse: number;
  text: string;
}

export interface ParsedChapter {
  chapter: number;
  verses: ParsedVerse[];
}

export interface ParsedBook {
  name: string;
  abbrev: string;
  testament: 'OT' | 'NT' | 'Other';
  chapters: ParsedChapter[];
}

export interface ParseReport {
  books: ParsedBook[];
  totalBooks: number;
  totalChapters: number;
  totalVerses: number;
  totalBytes: number;
  detectedFormat: string;
  warnings: string[];
  sourceName: string;
  rawPreview: string;
  libraryMode?: 'book' | 'bible';
  author?: string;
}

export const CANONICAL_BOOKS: Array<{ name: string; aliases: string[]; testament: 'OT' | 'NT' }> = [
  { name: 'Genesis', aliases: ['gen', 'ge', 'gn', 'genesis'], testament: 'OT' },
  { name: 'Exodus', aliases: ['exo', 'ex', 'exod', 'exodus'], testament: 'OT' },
  { name: 'Leviticus', aliases: ['lev', 'le', 'lv', 'leviticus'], testament: 'OT' },
  { name: 'Numbers', aliases: ['num', 'nu', 'nm', 'nb', 'numbers'], testament: 'OT' },
  { name: 'Deuteronomy', aliases: ['deut', 'deu', 'dt', 'de', 'deuteronomy'], testament: 'OT' },
  { name: 'Joshua', aliases: ['josh', 'jos', 'jsh', 'joshua'], testament: 'OT' },
  { name: 'Judges', aliases: ['judg', 'jdg', 'jg', 'jdgs', 'judges'], testament: 'OT' },
  { name: 'Ruth', aliases: ['rth', 'ru', 'ruth'], testament: 'OT' },
  { name: '1 Samuel', aliases: ['1sam', '1sa', '1s', '1 sam', '1 samuel', 'i samuel', 'i sam', '1st samuel'], testament: 'OT' },
  { name: '2 Samuel', aliases: ['2sam', '2sa', '2s', '2 sam', '2 samuel', 'ii samuel', 'ii sam', '2nd samuel'], testament: 'OT' },
  { name: '1 Kings', aliases: ['1kgs', '1ki', '1k', '1 kgs', '1 kings', 'i kings', 'i kgs', '1st kings'], testament: 'OT' },
  { name: '2 Kings', aliases: ['2kgs', '2ki', '2k', '2 kgs', '2 kings', 'ii kings', 'ii kgs', '2nd kings'], testament: 'OT' },
  { name: '1 Chronicles', aliases: ['1chr', '1ch', '1 chr', '1 chronicles', 'i chronicles', '1st chronicles'], testament: 'OT' },
  { name: '2 Chronicles', aliases: ['2chr', '2ch', '2 chr', '2 chronicles', 'ii chronicles', '2nd chronicles'], testament: 'OT' },
  { name: 'Ezra', aliases: ['ezr', 'ezra'], testament: 'OT' },
  { name: 'Nehemiah', aliases: ['neh', 'ne', 'nehemiah'], testament: 'OT' },
  { name: 'Esther', aliases: ['est', 'es', 'esth', 'esther'], testament: 'OT' },
  { name: 'Job', aliases: ['job', 'jb'], testament: 'OT' },
  { name: 'Psalms', aliases: ['psa', 'ps', 'psalm', 'psalms', 'psm', 'pss'], testament: 'OT' },
  { name: 'Proverbs', aliases: ['pro', 'pr', 'prv', 'prov', 'proverbs'], testament: 'OT' },
  { name: 'Ecclesiastes', aliases: ['ecc', 'ec', 'eccl', 'eccles', 'ecclesiastes'], testament: 'OT' },
  { name: 'Song of Solomon', aliases: ['sng', 'so', 'sos', 'song', 'song of solomon', 'song of songs', 'canticles', 'cant'], testament: 'OT' },
  { name: 'Isaiah', aliases: ['isa', 'is', 'isaiah'], testament: 'OT' },
  { name: 'Jeremiah', aliases: ['jer', 'je', 'jr', 'jeremiah'], testament: 'OT' },
  { name: 'Lamentations', aliases: ['lam', 'la', 'lamentations'], testament: 'OT' },
  { name: 'Ezekiel', aliases: ['ezk', 'eze', 'ezek', 'ezekiel'], testament: 'OT' },
  { name: 'Daniel', aliases: ['dan', 'da', 'dn', 'daniel'], testament: 'OT' },
  { name: 'Hosea', aliases: ['hos', 'ho', 'hosea'], testament: 'OT' },
  { name: 'Joel', aliases: ['jol', 'jl', 'joel'], testament: 'OT' },
  { name: 'Amos', aliases: ['amo', 'am', 'amos'], testament: 'OT' },
  { name: 'Obadiah', aliases: ['oba', 'ob', 'obad', 'obadiah'], testament: 'OT' },
  { name: 'Jonah', aliases: ['jon', 'jnh', 'jonah'], testament: 'OT' },
  { name: 'Micah', aliases: ['mic', 'mc', 'micah'], testament: 'OT' },
  { name: 'Nahum', aliases: ['nam', 'na', 'nah', 'nahum'], testament: 'OT' },
  { name: 'Habakkuk', aliases: ['hab', 'hb', 'habakkuk'], testament: 'OT' },
  { name: 'Zephaniah', aliases: ['zep', 'zp', 'zeph', 'zephaniah'], testament: 'OT' },
  { name: 'Haggai', aliases: ['hag', 'hg', 'haggai'], testament: 'OT' },
  { name: 'Zechariah', aliases: ['zec', 'zc', 'zech', 'zechariah'], testament: 'OT' },
  { name: 'Malachi', aliases: ['mal', 'ml', 'malachi'], testament: 'OT' },
  { name: 'Matthew', aliases: ['mat', 'mt', 'matt', 'matthew'], testament: 'NT' },
  { name: 'Mark', aliases: ['mrk', 'mk', 'mr', 'mark'], testament: 'NT' },
  { name: 'Luke', aliases: ['luk', 'lk', 'luke'], testament: 'NT' },
  { name: 'John', aliases: ['jhn', 'jn', 'joh', 'john'], testament: 'NT' },
  { name: 'Acts', aliases: ['act', 'ac', 'acts', 'acts of the apostles'], testament: 'NT' },
  { name: 'Romans', aliases: ['rom', 'ro', 'rm', 'romans'], testament: 'NT' },
  { name: '1 Corinthians', aliases: ['1co', '1cor', '1 cor', '1 corinthians', 'i corinthians', '1st corinthians'], testament: 'NT' },
  { name: '2 Corinthians', aliases: ['2co', '2cor', '2 cor', '2 corinthians', 'ii corinthians', '2nd corinthians'], testament: 'NT' },
  { name: 'Galatians', aliases: ['gal', 'ga', 'galatians'], testament: 'NT' },
  { name: 'Ephesians', aliases: ['eph', 'ep', 'ephesians'], testament: 'NT' },
  { name: 'Philippians', aliases: ['php', 'ph', 'phil', 'philippians'], testament: 'NT' },
  { name: 'Colossians', aliases: ['col', 'co', 'colossians'], testament: 'NT' },
  { name: '1 Thessalonians', aliases: ['1th', '1thess', '1 thes', '1 thessalonians', 'i thessalonians', '1st thessalonians'], testament: 'NT' },
  { name: '2 Thessalonians', aliases: ['2th', '2thess', '2 thes', '2 thessalonians', 'ii thessalonians', '2nd thessalonians'], testament: 'NT' },
  { name: '1 Timothy', aliases: ['1ti', '1tim', '1 tim', '1 timothy', 'i timothy', '1st timothy'], testament: 'NT' },
  { name: '2 Timothy', aliases: ['2ti', '2tim', '2 tim', '2 timothy', 'ii timothy', '2nd timothy'], testament: 'NT' },
  { name: 'Titus', aliases: ['tit', 'ti', 'titus'], testament: 'NT' },
  { name: 'Philemon', aliases: ['phm', 'pm', 'philem', 'philemon'], testament: 'NT' },
  { name: 'Hebrews', aliases: ['heb', 'he', 'hebrews'], testament: 'NT' },
  { name: 'James', aliases: ['jas', 'jm', 'james'], testament: 'NT' },
  { name: '1 Peter', aliases: ['1pe', '1pt', '1pet', '1 pet', '1 peter', 'i peter', '1st peter'], testament: 'NT' },
  { name: '2 Peter', aliases: ['2pe', '2pt', '2pet', '2 pet', '2 peter', 'ii peter', '2nd peter'], testament: 'NT' },
  { name: '1 John', aliases: ['1jn', '1jo', '1j', '1 john', 'i john', '1st john'], testament: 'NT' },
  { name: '2 John', aliases: ['2jn', '2jo', '2j', '2 john', 'ii john', '2nd john'], testament: 'NT' },
  { name: '3 John', aliases: ['3jn', '3jo', '3j', '3 john', 'iii john', '3rd john'], testament: 'NT' },
  { name: 'Jude', aliases: ['jud', 'jd', 'jude'], testament: 'NT' },
  { name: 'Revelation', aliases: ['rev', 're', 'rv', 'revelation', 'revelations', 'revelation of john'], testament: 'NT' },
];

const BOOK_LOOKUP = new Map<string, { idx: number; name: string; abbrev: string; testament: 'OT' | 'NT' }>();
CANONICAL_BOOKS.forEach((b, idx) => {
  const abbr = b.aliases[0].toUpperCase();
  BOOK_LOOKUP.set(b.name.toLowerCase(), { idx, name: b.name, abbrev: abbr, testament: b.testament });
  BOOK_LOOKUP.set(String(idx + 1), { idx, name: b.name, abbrev: abbr, testament: b.testament });
  BOOK_LOOKUP.set(String(idx + 1).padStart(2, '0'), { idx, name: b.name, abbrev: abbr, testament: b.testament });
  for (const alias of b.aliases) {
    BOOK_LOOKUP.set(alias.toLowerCase(), { idx, name: b.name, abbrev: abbr, testament: b.testament });
  }
});

const STRONGS_TAG_RE = /^[HG]\d{1,5}[a-z]?$/i;

function isStrongsTag(str: string): boolean {
  return STRONGS_TAG_RE.test(str.trim());
}

function resolveBookMeta(rawName: string | number): {
  order: number;
  name: string;
  abbrev: string;
  testament: 'OT' | 'NT' | 'Other';
} {
  if (typeof rawName === 'number' && rawName >= 1 && rawName <= 66) {
    const b = CANONICAL_BOOKS[rawName - 1];
    return { order: rawName - 1, name: b.name, abbrev: b.aliases[0].toUpperCase(), testament: b.testament };
  }
  const cleaned = String(rawName)
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ');
  const key = cleaned.toLowerCase();
  const hit =
    BOOK_LOOKUP.get(key) ??
    BOOK_LOOKUP.get(key.replace(/\s+/g, '')) ??
    BOOK_LOOKUP.get(key.replace(/^book\s+/i, ''));
  if (hit) {
    return { order: hit.idx, name: hit.name, abbrev: hit.abbrev, testament: hit.testament };
  }
  return {
    order: 1000,
    name: cleaned || 'Unknown',
    abbrev: cleaned.slice(0, 4).toUpperCase() || 'UNK',
    testament: 'Other',
  };
}

/**
 * Normalizes Unicode scripture text into our GBA 8-bit glyph encoding.
 */
export function normalizeForGba(input: string): string {
  const cleaned = input
    .replace(/&ldquo;/gi, '\u201C')
    .replace(/&rdquo;/gi, '\u201D')
    .replace(/&lsquo;/gi, '\u2018')
    .replace(/&rsquo;/gi, '\u2019')
    .replace(/&mdash;/gi, '\u2014')
    .replace(/&ndash;/gi, '\u2013')
    .replace(/&hellip;/gi, '\u2026')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ') // strip inline HTML/XML tags
    .replace(/[\[{][HG]\d{1,5}[a-z]?[\]}]/gi, '') // strip inline Strong's tags like [H776] or {H776}
    .replace(/\r?\n+/g, ' ')
    .replace(/\t+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:?!\u2019\u201D)\]])/g, '$1')
    .replace(/([\u201C\u2018(\[])\s+/g, '$1')
    .trim();

  let out = '';
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
    } else if (ch === '\u201C') {
      out += String.fromCharCode(0x80);
    } else if (ch === '\u201D') {
      out += String.fromCharCode(0x81);
    } else if (ch === '\u2018') {
      out += String.fromCharCode(0x82);
    } else if (ch === '\u2019') {
      out += String.fromCharCode(0x83);
    } else if (ch === '\u2014') {
      out += String.fromCharCode(0x84);
    } else if (ch === '\u2013') {
      out += String.fromCharCode(0x85);
    } else if (ch === '\u2026') {
      out += String.fromCharCode(0x86);
    } else if (ch === '\u2022') {
      out += String.fromCharCode(0x87);
    } else {
      const ascii = ch.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
      for (let j = 0; j < ascii.length; j++) {
        const c2 = ascii.charCodeAt(j);
        if (c2 >= 0x20 && c2 <= 0x7e) out += ascii[j];
      }
    }
  }
  return out;
}

export function decodeGbaText(str: string): string {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    switch (code) {
      case 0x01:
      case 0x02:
      case 0x04:
      case 0x05:
      case 0x0b:
        break;
      case 0x03:
        out += ' ';
        break;
      case 0x80:
        out += '\u201C';
        break;
      case 0x81:
        out += '\u201D';
        break;
      case 0x82:
        out += '\u2018';
        break;
      case 0x83:
        out += '\u2019';
        break;
      case 0x84:
        out += '\u2014';
        break;
      case 0x85:
        out += '\u2013';
        break;
      case 0x86:
        out += '\u2026';
        break;
      case 0x87:
        out += '\u2022';
        break;
      default:
        out += str[i];
    }
  }
  return out;
}

export function encodeGbaStringBytes(str: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x01 && code <= 0xff) {
      bytes.push(code);
    }
  }
  return bytes;
}

function pickProp(obj: Record<string, unknown>, candidates: string[]): unknown {
  for (const key of candidates) {
    if (key in obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  const lowerMap = new Map<string, string>();
  for (const k of Object.keys(obj)) lowerMap.set(k.toLowerCase(), k);
  for (const key of candidates) {
    const actual = lowerMap.get(key.toLowerCase());
    if (actual !== undefined && obj[actual] !== undefined && obj[actual] !== null) {
      return obj[actual];
    }
  }
  return undefined;
}

function joinWordTokens(tokens: string[]): string {
  let result = '';
  for (const raw of tokens) {
    const t = raw.trim();
    if (!t) continue;
    if (
      result.length > 0 &&
      !/^[,.;:?!'"’”)\]]+$/.test(t) &&
      !result.endsWith('“') &&
      !result.endsWith('‘') &&
      !result.endsWith('(') &&
      !result.endsWith('[')
    ) {
      result += ' ';
    }
    result += t;
  }
  return result.trim();
}

const PROSE_FIELD_CANDIDATES = [
  'text',
  'verse_text',
  'verseText',
  'esv',
  'english',
  'en',
  'verse',
  'content',
  'scripture',
  'passage',
  'body',
  'word',
  'words',
  'phrase',
  'token',
  'surface',
  'line',
  't',
  'w',
  'value',
];

function extractText(val: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed || isStrongsTag(trimmed)) return null;
    return trimmed;
  }

  // Handle arrays of word tokens: ["In", "the", ...] or [["In", "H9002"], ...] or [{word: "In"}, ...]
  if (Array.isArray(val)) {
    const parts: string[] = [];
    for (const item of val) {
      if (typeof item === 'string') {
        const s = item.trim();
        if (s && !isStrongsTag(s)) parts.push(s);
      } else if (Array.isArray(item)) {
        const firstWord = item.find((x) => typeof x === 'string' && x.trim() && !isStrongsTag(x) && !/^\d+$/.test(x.trim()));
        if (typeof firstWord === 'string') parts.push(firstWord.trim());
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const t = extractText(obj, depth + 1);
        if (t) {
          parts.push(t);
        } else {
          // Handle single-entry token objects like {"earth": "H776"}
          const entries = Object.entries(obj);
          if (entries.length === 1 && typeof entries[0][1] === 'string' && (isStrongsTag(entries[0][1]) || entries[0][1] === '')) {
            parts.push(entries[0][0]);
          }
        }
      }
    }
    const joined = joinWordTokens(parts);
    return joined.length > 0 ? joined : null;
  }

  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;

    // 1. Direct prose string property (ignoring Strong's tags like "H776")
    for (const key of PROSE_FIELD_CANDIDATES) {
      const candidate = pickProp(obj, [key]);
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed && !isStrongsTag(trimmed)) {
          return trimmed;
        }
      }
    }

    // 2. Nested array of tokens/words
    const tokenArr = pickProp(obj, ['tokens', 'words', 'word_list', 'items', 'data', 'text', 'verse']);
    if (Array.isArray(tokenArr)) {
      const extracted = extractText(tokenArr, depth + 1);
      if (extracted) return extracted;
    }

    // 3. Numbered word map inside verse: { "1": "In", "2": "the" } or { "1": { word: "In" } }
    const entries = Object.entries(obj);
    const numericWordEntries: Array<[number, string]> = [];
    for (const [k, v] of entries) {
      if (/^\d+$/.test(k.trim())) {
        const wordTxt = extractText(v, depth + 1);
        if (wordTxt) numericWordEntries.push([Number(k.trim()), wordTxt]);
      }
    }
    if (numericWordEntries.length >= 2) {
      numericWordEntries.sort((a, b) => a[0] - b[0]);
      return joinWordTokens(numericWordEntries.map((x) => x[1]));
    }

    // 4. Strong's-mapped dictionary inside verse: { "In": "H9002", "earth": "H776" } or { "earth": ["H776"] }
    const strongKeys: string[] = [];
    let strongValCount = 0;
    for (const [k, v] of entries) {
      if (typeof v === 'string') {
        if (isStrongsTag(v)) {
          strongValCount++;
          strongKeys.push(k);
        } else if (v === '' || /^[HG]\d+/i.test(v)) {
          strongKeys.push(k);
        }
      } else if (Array.isArray(v) && v.some((x) => typeof x === 'string' && isStrongsTag(x))) {
        strongValCount++;
        strongKeys.push(k);
      }
    }
    if (strongValCount >= 1 && strongKeys.length >= 2) {
      return joinWordTokens(strongKeys);
    }

    // 5. Fallback: any non-Strong's string field longer than 3 chars that isn't an ID/ref
    for (const [k, v] of entries) {
      if (typeof v === 'string') {
        const kl = k.toLowerCase();
        if (['id', 'verseid', 'book', 'abbrev', 'strong', 'strongs', 'lemma', 'morph', 'ref', 'reference'].includes(kl)) {
          continue;
        }
        const trimmed = v.trim();
        if (trimmed.length > 3 && !isStrongsTag(trimmed) && !/^\d+$/.test(trimmed)) {
          return trimmed;
        }
      }
    }
  }

  return null;
}

function parseReferenceString(ref: string): { book: string; chapter: number; verse: number } | null {
  const m = ref.trim().match(/^(.+?)\s*[.\s]\s*(\d+)\s*[:.]\s*(\d+)$/);
  if (m) {
    return { book: m[1].trim(), chapter: Number(m[2]), verse: Number(m[3]) };
  }
  const digits = ref.trim().match(/^(\d{7,8})$/);
  if (digits) {
    const n = Number(digits[1]);
    const bookNum = Math.floor(n / 1_000_000);
    const chapNum = Math.floor((n % 1_000_000) / 1_000);
    const verseNum = n % 1_000;
    if (bookNum >= 1 && bookNum <= 66 && chapNum >= 1 && verseNum >= 1) {
      return { book: CANONICAL_BOOKS[bookNum - 1].name, chapter: chapNum, verse: verseNum };
    }
  }
  return null;
}

type BookMap = Map<string, Map<number, Map<number, string>>>;

function insertVerse(
  bookMap: BookMap,
  bookKey: string | number,
  chapterNum: number,
  verseNum: number,
  text: string,
  appendIfExists = false
) {
  const cleanText = text.trim();
  if (
    bookKey === undefined ||
    bookKey === null ||
    !Number.isFinite(chapterNum) ||
    !Number.isFinite(verseNum) ||
    chapterNum < 1 ||
    verseNum < 1 ||
    !cleanText
  ) {
    return;
  }
  const meta = resolveBookMeta(bookKey);
  const canonicalKey = meta.order < 1000 ? meta.name : String(bookKey).trim();
  let chapters = bookMap.get(canonicalKey);
  if (!chapters) {
    chapters = new Map();
    bookMap.set(canonicalKey, chapters);
  }
  let verses = chapters.get(chapterNum);
  if (!verses) {
    verses = new Map();
    chapters.set(chapterNum, verses);
  }
  if (appendIfExists && verses.has(verseNum)) {
    const prev = verses.get(verseNum) ?? '';
    verses.set(verseNum, joinWordTokens([prev, cleanText]));
  } else {
    verses.set(verseNum, cleanText);
  }
}

function parsePrefixedNum(key: string): number | null {
  const m = key.trim().match(/^(?:chapter|chap|ch|verse|vs|v)?[\s._-]*(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function ingestChaptersContainer(bookMap: BookMap, bookName: string | number, chaptersVal: unknown) {
  if (Array.isArray(chaptersVal)) {
    chaptersVal.forEach((chVal, chIdx) => {
      if (Array.isArray(chVal)) {
        chVal.forEach((vItem, vIdx) => {
          const txt = extractText(vItem);
          if (txt !== null) {
            const vNum =
              vItem && typeof vItem === 'object' && !Array.isArray(vItem)
                ? Number(pickProp(vItem as Record<string, unknown>, ['verse', 'verse_nr', 'v', 'num', 'number', 'id']) ?? vIdx + 1)
                : vIdx + 1;
            insertVerse(bookMap, bookName, chIdx + 1, Number.isFinite(vNum) ? vNum : vIdx + 1, txt);
          } else if (vItem && typeof vItem === 'object' && !Array.isArray(vItem)) {
            ingestVersesMap(bookMap, bookName, chIdx + 1, vItem as Record<string, unknown>);
          }
        });
      } else if (chVal && typeof chVal === 'object') {
        const co = chVal as Record<string, unknown>;
        const rawChNum = pickProp(co, ['chapter', 'chapter_nr', 'chap', 'c', 'num', 'number', 'id']);
        const parsedCh = rawChNum !== undefined ? parsePrefixedNum(String(rawChNum)) : null;
        const chNum = parsedCh !== null ? parsedCh : chIdx + 1;
        const vsArr = pickProp(co, ['verses', 'verse', 'Verses', 'Verse', 'data', 'items']);
        if (Array.isArray(vsArr)) {
          vsArr.forEach((vItem, vIdx) => {
            if (typeof vItem === 'string') {
              insertVerse(bookMap, bookName, chNum, vIdx + 1, vItem);
            } else if (vItem && typeof vItem === 'object') {
              const vo = vItem as Record<string, unknown>;
              const vid = pickProp(vo, ['verseid', 'Verseid', 'id']);
              let vNum = vIdx + 1;
              let resolvedCh = chNum;
              let resolvedBook = bookName;

              if (typeof vid === 'string' || typeof vid === 'number') {
                const parsedId = parseReferenceString(String(vid));
                if (parsedId) {
                  resolvedBook = parsedId.book;
                  resolvedCh = parsedId.chapter;
                  vNum = parsedId.verse;
                }
              }
              const explicitV = pickProp(vo, ['verse_nr', 'v', 'num', 'number']);
              if (explicitV !== undefined && /^\d+$/.test(String(explicitV))) {
                vNum = Number(explicitV);
              } else if (typeof vo.verse === 'number' || (typeof vo.verse === 'string' && /^\d+$/.test(vo.verse))) {
                vNum = Number(vo.verse);
              } else if (typeof vo.Verse === 'number' || (typeof vo.Verse === 'string' && /^\d+$/.test(vo.Verse))) {
                vNum = Number(vo.Verse);
              }
              const txt = extractText(vo);
              if (txt) {
                insertVerse(bookMap, resolvedBook, resolvedCh, vNum, txt);
              } else {
                ingestVersesMap(bookMap, resolvedBook, resolvedCh, vo);
              }
            }
          });
        } else if (vsArr && typeof vsArr === 'object') {
          ingestVersesMap(bookMap, bookName, chNum, vsArr as Record<string, unknown>);
        } else {
          ingestVersesMap(bookMap, bookName, chNum, co);
        }
      }
    });
  } else if (chaptersVal && typeof chaptersVal === 'object') {
    const chObj = chaptersVal as Record<string, unknown>;
    for (const [chapKey, versesVal] of Object.entries(chObj)) {
      const chNum = parsePrefixedNum(chapKey);
      if (chNum === null) continue;
      if (Array.isArray(versesVal)) {
        versesVal.forEach((vItem, vIdx) => {
          const txt = extractText(vItem);
          if (txt !== null) {
            insertVerse(bookMap, bookName, chNum, vIdx + 1, txt);
          } else if (vItem && typeof vItem === 'object' && !Array.isArray(vItem)) {
            ingestVersesMap(bookMap, bookName, chNum, vItem as Record<string, unknown>);
          }
        });
      } else if (versesVal && typeof versesVal === 'object') {
        const vo = versesVal as Record<string, unknown>;
        const nestedVerses = pickProp(vo, ['verse', 'verses', 'Verses']);
        if (nestedVerses && typeof nestedVerses === 'object' && !Array.isArray(nestedVerses)) {
          ingestVersesMap(bookMap, bookName, chNum, nestedVerses as Record<string, unknown>);
        } else {
          ingestVersesMap(bookMap, bookName, chNum, vo);
        }
      }
    }
  }
}

function ingestVersesMap(bookMap: BookMap, bookName: string | number, chNum: number, mapObj: Record<string, unknown>) {
  for (const [vKey, vVal] of Object.entries(mapObj)) {
    const vNum = parsePrefixedNum(vKey);
    if (vNum === null) continue;
    const txt = extractText(vVal);
    if (txt) insertVerse(bookMap, bookName, chNum, vNum, txt);
  }
}

function finalizeReport(
  bookMap: BookMap,
  detectedFormat: string,
  warnings: string[],
  sourceName: string,
  rawPreview: string
): ParseReport {
  const entries = Array.from(bookMap.entries()).map(([rawName, chaptersMap]) => {
    const meta = resolveBookMeta(rawName);
    const chapters: ParsedChapter[] = Array.from(chaptersMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([chapterNum, versesMap]) => ({
        chapter: chapterNum,
        verses: Array.from(versesMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([verseNum, text]) => ({
            verse: verseNum,
            text: normalizeForGba(text),
          }))
          .filter((v) => v.text.length > 0),
      }))
      .filter((c) => c.verses.length > 0);

    return {
      order: meta.order,
      book: {
        name: meta.name,
        abbrev: meta.abbrev,
        testament: meta.testament,
        chapters,
      } satisfies ParsedBook,
    };
  });

  entries.sort((a, b) => a.order - b.order);
  const books = entries.map((e) => e.book).filter((b) => b.chapters.length > 0);

  let totalChapters = 0;
  let totalVerses = 0;
  let totalBytes = 0;
  let shortCount = 0;

  for (const b of books) {
    totalChapters += b.chapters.length;
    for (const c of b.chapters) {
      totalVerses += c.verses.length;
      for (const v of c.verses) {
        totalBytes += v.text.length + String(v.verse).length + 3;
        if (v.text.length < 10) shortCount++;
      }
    }
  }

  if (books.length === 0) {
    throw new Error('No readable books, chapters, or verses were found in this JSON file.');
  }

  if (totalVerses > 0 && shortCount / totalVerses > 0.7) {
    warnings.push(
      'Most parsed verses are unusually short (< 10 chars). Check "Verify Parsed Scripture" and the Raw JSON Sample below—this JSON may be a concordance or Strong’s tag index rather than full verse text.'
    );
  }

  return {
    books,
    totalBooks: books.length,
    totalChapters,
    totalVerses,
    totalBytes,
    detectedFormat,
    warnings,
    sourceName,
    rawPreview,
    libraryMode: 'bible',
  };
}

export function describeJsonStructure(jsonText: string): string {
  try {
    const cleanText = jsonText.charCodeAt(0) === 0xfeff ? jsonText.slice(1) : jsonText;
    const parsed = JSON.parse(cleanText);
    const describeNode = (node: unknown, depth = 0): string => {
      if (node === null) return 'null';
      if (typeof node !== 'object') return typeof node;
      if (Array.isArray(node)) {
        if (node.length === 0) return 'Array(0)';
        if (depth >= 3) return `Array(${node.length})`;
        return `Array(${node.length}) of [${describeNode(node[0], depth + 1)}]`;
      }
      const keys = Object.keys(node as Record<string, unknown>);
      const preview = keys.slice(0, 6).join(', ') + (keys.length > 6 ? `, ... (+${keys.length - 6})` : '');
      if (depth >= 2 || keys.length === 0) return `Object{${preview}}`;
      const firstVal = (node as Record<string, unknown>)[keys[0]];
      return `Object{${preview}} -> ${keys[0]}: ${describeNode(firstVal, depth + 1)}`;
    };
    return describeNode(parsed);
  } catch {
    return 'Non-standard JSON or NDJSON text';
  }
}

function buildRawSampleSnippet(raw: unknown): string {
  const trimNode = (node: unknown, depth = 0): unknown => {
    if (node === null || typeof node !== 'object') return node;
    if (Array.isArray(node)) {
      if (depth >= 4) return `[Array(${node.length})]`;
      return node.slice(0, 3).map((item) => trimNode(item, depth + 1));
    }
    const obj = node as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (depth >= 4) return `{Object(${keys.slice(0, 5).join(', ')})}`;
    const out: Record<string, unknown> = {};
    for (const k of keys.slice(0, 4)) {
      out[k] = trimNode(obj[k], depth + 1);
    }
    if (keys.length > 4) {
      out['...'] = `(+${keys.length - 4} more keys)`;
    }
    return out;
  };
  try {
    return JSON.stringify(trimNode(raw), null, 2).slice(0, 1500);
  } catch {
    return '';
  }
}

export function exportNormalizedBibleJson(report: ParseReport): string {
  const out: Record<string, Record<string, Record<string, string>>> = {};
  for (const book of report.books) {
    out[book.name] = {};
    for (const ch of book.chapters) {
      out[book.name][String(ch.chapter)] = {};
      for (const v of ch.verses) {
        out[book.name][String(ch.chapter)][String(v.verse)] = decodeGbaText(v.text);
      }
    }
  }
  return JSON.stringify(out, null, 2);
}

function parseJsonRaw(jsonText: string): unknown {
  const cleanText = jsonText.charCodeAt(0) === 0xfeff ? jsonText.slice(1) : jsonText;
  try {
    return JSON.parse(cleanText);
  } catch (err) {
    const lines = cleanText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('{') && l.endsWith('}'));
    if (lines.length > 0) {
      try {
        return lines.map((l) => JSON.parse(l));
      } catch {
        // Fall through
      }
    }
    throw new Error(`Invalid JSON syntax: ${err instanceof Error ? err.message : 'Unable to parse file'}`);
  }
}

export function parseBibleJson(jsonText: string, sourceName = 'bible.json'): ParseReport {
  const raw = parseJsonRaw(jsonText);
  const bookMap: BookMap = new Map();
  const warnings: string[] = [];
  const rawPreview = buildRawSampleSnippet(raw);

  const parseNode = (node: unknown): string | null => {
    if (Array.isArray(node)) {
      if (node.length === 0) return null;
      const first = node[0];

      // Pure 3D array: books[bookIdx][chapIdx][verseIdx]
      if (Array.isArray(first) && Array.isArray(first[0])) {
        node.forEach((chaptersArr, bIdx) => {
          const bName = bIdx < CANONICAL_BOOKS.length ? CANONICAL_BOOKS[bIdx].name : `Book ${bIdx + 1}`;
          ingestChaptersContainer(bookMap, bName, chaptersArr);
        });
        return '3D Array [Book][Chapter][Verse]';
      }

      // Pure 2D array: chapters[verse] for single book
      if (Array.isArray(first) && typeof first[0] === 'string') {
        const bName = resolveBookMeta(sourceName).order < 1000 ? resolveBookMeta(sourceName).name : 'Genesis';
        ingestChaptersContainer(bookMap, bName, node);
        return '2D Array [Chapter][Verse]';
      }

      if (first && typeof first === 'object') {
        const fObj = first as Record<string, unknown>;

        // Scrollmapper row format: [{ field: [id, bookNum, chapNum, verseNum, text] }, ...]
        if (Array.isArray(fObj.field) && fObj.field.length >= 5) {
          for (const item of node) {
            if (!item || typeof item !== 'object') continue;
            const fields = (item as Record<string, unknown>).field;
            if (!Array.isArray(fields) || fields.length < 5) continue;
            const bNum = Number(fields[1]);
            const cNum = Number(fields[2]);
            const vNum = Number(fields[3]);
            const txt = String(fields[4] ?? '');
            if (!isStrongsTag(txt)) {
              insertVerse(bookMap, bNum, cNum, vNum, txt, true);
            }
          }
          return 'Scrollmapper Database Rows (resultset.row[].field)';
        }

        // Array of book objects [{ name/book/BookName, chapters/Chapter: [...] }]
        const hasChaptersProp =
          pickProp(fObj, ['chapters', 'chapter', 'Chapters', 'Chapter']) !== undefined &&
          pickProp(fObj, ['verse', 'v', 'text', 't']) === undefined;

        if (hasChaptersProp) {
          node.forEach((item, bIdx) => {
            if (!item || typeof item !== 'object') return;
            const obj = item as Record<string, unknown>;
            const explicitName = pickProp(obj, [
              'name',
              'book',
              'book_name',
              'bookName',
              'title',
              'abbrev',
              'b',
              'id',
            ]);
            const bookKey =
              explicitName !== undefined
                ? String(explicitName)
                : bIdx < CANONICAL_BOOKS.length
                  ? CANONICAL_BOOKS[bIdx].name
                  : `Book ${bIdx + 1}`;
            const chaps = pickProp(obj, ['chapters', 'chapter', 'Chapters', 'Chapter']);
            ingestChaptersContainer(bookMap, bookKey, chaps);
          });
          return 'Array of Book Objects (Book -> Chapter -> Verse)';
        }

        // Flat array of verse or word-token objects (concatenates multi-token rows sharing book+ch+vs)
        for (const item of node) {
          if (!item || typeof item !== 'object') continue;
          const obj = item as Record<string, unknown>;

          const refStr = pickProp(obj, ['reference', 'ref', 'verseid', 'Verseid', 'citation']);
          let bookKey = pickProp(obj, ['book', 'book_name', 'bookName', 'book_id', 'book_num', 'b', 'bk']);
          let chapNum = Number(pickProp(obj, ['chapter', 'chapter_nr', 'chap', 'ch', 'c']));
          let verseNum = Number(pickProp(obj, ['verse_nr', 'vs', 'v', 'verse_num', 'num']));
          if (!Number.isFinite(verseNum)) {
            const rawV = obj.verse ?? obj.Verse;
            if (typeof rawV === 'number' || (typeof rawV === 'string' && /^\d+$/.test(rawV))) {
              verseNum = Number(rawV);
            }
          }

          if ((bookKey === undefined || !Number.isFinite(chapNum) || !Number.isFinite(verseNum)) && refStr !== undefined) {
            const parsedRef = parseReferenceString(String(refStr));
            if (parsedRef) {
              bookKey = bookKey ?? parsedRef.book;
              if (!Number.isFinite(chapNum)) chapNum = parsedRef.chapter;
              if (!Number.isFinite(verseNum)) verseNum = parsedRef.verse;
            }
          }

          const txt = extractText(obj);
          if (txt && bookKey !== undefined) {
            insertVerse(bookMap, String(bookKey), chapNum, verseNum, txt, true);
          }
        }
        if (bookMap.size > 0) {
          return 'Flat Array of Verse/Token Objects';
        }
      }
      return null;
    }

    if (node && typeof node === 'object') {
      const root = node as Record<string, unknown>;

      // Scrollmapper { resultset: { row: [...] } }
      if (root.resultset && typeof root.resultset === 'object' && !Array.isArray(root.resultset)) {
        const rs = root.resultset as Record<string, unknown>;
        if (Array.isArray(rs.row)) {
          const fmt = parseNode(rs.row);
          if (fmt) return fmt;
        }
      }

      // Known collection wrapper keys
      const wrapperCandidates = [
        'Book',
        'Books',
        'books',
        'book',
        'verses',
        'Verses',
        'resultset',
        'rows',
        'data',
        'bible',
        'Bible',
        'scripture',
        'Scripture',
        'content',
      ];
      for (const wk of wrapperCandidates) {
        if (wk in root && root[wk] && typeof root[wk] === 'object') {
          const inner = root[wk];
          if (wk.toLowerCase() === 'book' && typeof inner === 'string') continue;
          const fmt = parseNode(inner);
          if (fmt) return `Wrapped (${wk}) -> ${fmt}`;
        }
      }

      // Single-book object
      const singleChaps = pickProp(root, ['chapters', 'chapter', 'Chapters', 'Chapter']);
      if (singleChaps && typeof singleChaps === 'object') {
        const bName = String(
          pickProp(root, ['book', 'book_name', 'bookName', 'name', 'title']) ??
            (resolveBookMeta(sourceName).order < 1000 ? resolveBookMeta(sourceName).name : 'Genesis')
        );
        ingestChaptersContainer(bookMap, bName, singleChaps);
        if (bookMap.size > 0) return 'Single Book Object';
      }

      // Single-key root wrapper (only if key is NOT a known book name like "Genesis")
      const keys = Object.keys(root);
      if (
        keys.length === 1 &&
        resolveBookMeta(keys[0]).order >= 1000 &&
        typeof root[keys[0]] === 'object' &&
        root[keys[0]] !== null
      ) {
        const innerFmt = parseNode(root[keys[0]]);
        if (innerFmt) return innerFmt;
      }

      // Reference-keyed flat map
      let refMatches = 0;
      for (const [k, v] of Object.entries(root)) {
        const parsed = parseReferenceString(k);
        if (parsed) {
          const txt = extractText(v);
          if (txt) {
            insertVerse(bookMap, parsed.book, parsed.chapter, parsed.verse, txt);
            refMatches++;
          }
        }
      }
      if (refMatches > 0) {
        return 'Reference-Keyed Map ("Book Ch:Vs" -> Text)';
      }

      // Nested Book -> Chapter -> Verse Map
      for (const [bookKey, chaptersVal] of Object.entries(root)) {
        if (!chaptersVal || typeof chaptersVal !== 'object') continue;
        if (Array.isArray(chaptersVal)) {
          ingestChaptersContainer(bookMap, bookKey, chaptersVal);
        } else {
          const bObj = chaptersVal as Record<string, unknown>;
          const meta = resolveBookMeta(bookKey);
          if (meta.order >= 1000) {
            const subKeys = Object.keys(bObj);
            if (subKeys.some((sk) => resolveBookMeta(sk).order < 1000)) {
              parseNode(bObj);
              continue;
            }
          }
          const resolvedName = String(
            pickProp(bObj, ['book_name', 'bookName', 'name', 'title']) ?? bookKey
          );
          const nestedChaps = pickProp(bObj, ['chapters', 'chapter', 'Chapters', 'Chapter']);
          if (nestedChaps && typeof nestedChaps === 'object') {
            ingestChaptersContainer(bookMap, resolvedName, nestedChaps);
          } else {
            ingestChaptersContainer(bookMap, resolvedName, bObj);
          }
        }
      }
      if (bookMap.size > 0) {
        return 'Nested Book -> Chapter -> Verse Map';
      }

      // Generic wrapper fallback
      for (const [k, v] of Object.entries(root)) {
        if (v && typeof v === 'object') {
          const innerFmt = parseNode(v);
          if (innerFmt && bookMap.size > 0) {
            return `Wrapped (${k}) -> ${innerFmt}`;
          }
        }
      }
    }

    return null;
  };

  const detectedFormat = parseNode(raw);
  if (!detectedFormat || bookMap.size === 0) {
    const diag = describeJsonStructure(jsonText);
    throw new Error(
      `Could not match Bible chapters/verses inside this JSON. Detected structure: ${diag}\n\nSample:\n${rawPreview.slice(0, 600)}`
    );
  }

  return finalizeReport(bookMap, detectedFormat, warnings, sourceName, rawPreview);
}

/**
 * Public-domain format sample (WEB/KJV sample excerpts) solely for testing the ROM builder
 * when the user hasn't dropped their own ESV .json yet.
 */
export const SAMPLE_FORMAT_JSON = JSON.stringify(
  {
    Genesis: {
      '1': {
        '1': 'In the beginning God created the heavens and the earth.',
        '2': 'Now the earth was formless and empty. Darkness was on the surface of the deep and God’s Spirit was hovering over the surface of the waters.',
        '3': 'God said, “Let there be light,” and there was light.',
        '4': 'God saw the light, and saw that it was good. God divided the light from the darkness.',
        '5': 'God called the light “day”, and the darkness he called “night”. There was evening and there was morning, the first day.',
        '6': 'God said, “Let there be an expanse in the middle of the waters, and let it divide the waters from the waters.”',
        '7': 'God made the expanse, and divided the waters which were under the expanse from the waters which were above the expanse; and it was so.',
        '8': 'God called the expanse “sky”. There was evening and there was morning, a second day.',
        '9': 'God said, “Let the waters under the sky be gathered together to one place, and let the dry land appear”; and it was so.',
        '10': 'God called the dry land “earth”, and the gathering together of the waters he called “seas”. God saw that it was good.',
      },
      '2': {
        '1': 'The heavens, the earth, and all their vast array were finished.',
        '2': 'On the seventh day God finished his work which he had done; and he rested on the seventh day from all his work which he had done.',
        '3': 'God blessed the seventh day, and made it holy, because he rested in it from all his work of creation which he had done.',
      },
    },
    Psalms: {
      '23': {
        '1': 'The LORD is my shepherd; I shall not want.',
        '2': 'He makes me lie down in green pastures. He leads me beside still waters.',
        '3': 'He restores my soul. He guides me in the paths of righteousness for his name’s sake.',
        '4': 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.',
        '5': 'You prepare a table before me in the presence of my enemies. You anoint my head with oil. My cup runs over.',
        '6': 'Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in the LORD’s house forever.',
      },
    },
    John: {
      '1': {
        '1': 'In the beginning was the Word, and the Word was with God, and the Word was God.',
        '2': 'The same was in the beginning with God.',
        '3': 'All things were made through him. Without him, nothing was made that has been made.',
        '4': 'In him was life, and the life was the light of men.',
        '5': 'The light shines in the darkness, and the darkness hasn’t overcome it.',
        '14': 'The Word became flesh, and lived among us. We saw his glory, such glory as of the one and only Son of the Father, full of grace and truth.',
      },
    },
    Romans: {
      '8': {
        '1': 'There is therefore now no condemnation to those who are in Christ Jesus, who don’t walk according to the flesh, but according to the Spirit.',
        '28': 'We know that all things work together for good for those who love God, for those who are called according to his purpose.',
      },
    },
  },
  null,
  2
);
