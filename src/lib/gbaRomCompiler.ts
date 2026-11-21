import { ArmAssembler, LR, R0, R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12, SP } from './armAssembler';
import { encodeGbaStringBytes, ParseReport } from './bibleParser';
import { buildGbaFontTable, GBA_THEMES, getThemeBgr555Palette } from './gbaFont';

export interface RomBuildConfig {
  romTitle: string; // max 12 chars uppercase ASCII
  gameCode: string; // 4 chars
  fontStyle: '6x8' | '8x8';
  lineSpacing: 'compact' | 'comfortable';
  verseLayout: 'paragraph' | 'verse-per-line';
  showVerseNumbers: boolean;
  defaultThemeIndex: number; // 0..3
  padToPowerOfTwo: boolean;
  bootToMain: boolean;
  studioMode?: 'bible' | 'ereader';
}

export interface TranslationInput {
  code: string;
  name: string;
  report: ParseReport;
  includeConcordance?: boolean;
}

export interface RomBuildResult {
  rom: Uint8Array;
  fileName: string;
  romSizeBytes: number;
  codeSizeBytes: number;
  dataSizeBytes: number;
  uncompressedTextBytes: number;
  compressedTextBytes: number;
  headerChecksum: number;
  globalCrc32: number;
  translationsEncoded: number;
  booksEncoded: number;
  chaptersEncoded: number;
  concordanceWordsEncoded: number;
  concordanceBytes: number;
}

export const MAX_GBA_ROM_BYTES = 32 * 1024 * 1024; // 32 MB GBA cartridge ROM limit

// Official 156-byte compressed Nintendo logo bitmap required by GBA BIOS boot check
const NINTENDO_LOGO = new Uint8Array([
  0x24, 0xff, 0xae, 0x51, 0x69, 0x9a, 0xa2, 0x21, 0x3d, 0x84, 0x82, 0x0a,
  0x84, 0xe4, 0x09, 0xad, 0x11, 0x24, 0x8b, 0x98, 0xc0, 0x81, 0x7f, 0x21,
  0xa3, 0x52, 0xbe, 0x19, 0x93, 0x09, 0xce, 0x20, 0x10, 0x46, 0x4a, 0x4a,
  0xf8, 0x27, 0x31, 0xec, 0x58, 0xc7, 0xe8, 0x33, 0x82, 0xe3, 0xce, 0xbf,
  0x85, 0xf4, 0xdf, 0x94, 0xce, 0x4b, 0x09, 0xc1, 0x94, 0x56, 0x8a, 0xc0,
  0x13, 0x72, 0xa7, 0xfc, 0x9f, 0x84, 0x4d, 0x73, 0xa3, 0xca, 0x9a, 0x61,
  0x58, 0x97, 0xa3, 0x27, 0xfc, 0x03, 0x98, 0x76, 0x23, 0x1d, 0xc7, 0x61,
  0x03, 0x04, 0xae, 0x56, 0xbf, 0x38, 0x84, 0x00, 0x40, 0xa7, 0x0e, 0xfd,
  0xff, 0x52, 0xfe, 0x03, 0x6f, 0x95, 0x30, 0xf1, 0x97, 0xfb, 0xc0, 0x85,
  0x60, 0xd6, 0x80, 0x25, 0xa9, 0x63, 0xbe, 0x03, 0x01, 0x4e, 0x38, 0xe2,
  0xf9, 0xa2, 0x34, 0xff, 0xbb, 0x3e, 0x03, 0x44, 0x78, 0x00, 0x90, 0xcb,
  0x88, 0x11, 0x3a, 0x94, 0x65, 0xc0, 0x7c, 0x63, 0x87, 0xf0, 0x3c, 0xaf,
  0xd6, 0x25, 0xe4, 0x8b, 0x38, 0x0a, 0xac, 0x72, 0x21, 0xd4, 0xf8, 0x07,
]);

const STATE_BASE = 0x03000000;
const LINE_TABLE_BASE = 0x02000000;
const READER_CHAP_BUF = 0x02020000; // 64 KB EWRAM buffer for active chapter decompression
const SNIPPET_CHAP_BUF = 0x02030000; // 64 KB EWRAM buffer for Concordance snippet extraction
const DATA_HEADER_ADDR = 0x08008000;
const DATA_HEADER_OFFSET = 0x008000;
const DTE_TABLE_ADDR = DATA_HEADER_ADDR + 64; // 240 bytes: 120 (left,right) BPE pairs for 0x88..0xFF
const DTE_TABLE_OFFSET = DATA_HEADER_OFFSET + 64;
const TRANS_TABLE_OFFSET = DATA_HEADER_OFFSET + 64 + 240;

// Ultra-common English glue words skipped from the concordance index
const CONCORDANCE_STOP_WORDS = new Set([
  'the', 'and', 'of', 'to', 'in', 'a', 'an', 'that', 'it', 'is', 'was',
  'be', 'for', 'as', 'with', 'on', 'at', 'by', 'from', 'or', 'but',
  'he', 'his', 'him', 'they', 'them', 'their', 'we', 'us', 'you', 'your',
  'ye', 'this', 'which', 'are', 'were', 'had', 'has', 'have', 'into', 'unto',
]);

// State offsets in IWRAM (0x03000000)
const ST_MODE = 0x00; // 0=reader, 1=books, 2=chapters, 3=main(translations), 4=concordance
const ST_BOOK = 0x04;
const ST_CHAP = 0x08;
const ST_SCROLL = 0x0c;
const ST_THEME = 0x10;
const ST_NUMLINES = 0x14;
const ST_BOOK_CUR = 0x18;
const ST_BOOK_SCR = 0x1c;
const ST_CHAP_CUR = 0x20;
const ST_PREV_KEYS = 0x24;
const ST_HOLD_CNT = 0x28;
const ST_DIRTY = 0x2c;
const ST_BACKBUF = 0x30;
const ST_TOAST = 0x34;
const ST_BM_BOOK = 0x38;
const ST_BM_CHAP = 0x3c;
const ST_BM_LINE = 0x40;
const ST_HAS_BM = 0x44;
const ST_CHAP_SCR = 0x48;
const ST_TRANS = 0x4c;
const ST_TRANS_CUR = 0x50;
const ST_TRANS_SCR = 0x54;
const ST_BM_TRANS = 0x58;
const ST_V_LAYOUT = 0x5c; // 0=prose, 1=verse-per-line
const ST_DENSITY = 0x60; // 0=14 lines (9px), 1=16 lines (8px)
const ST_LINES_PP = 0x64;
const ST_LINE_H = 0x68;
const ST_SEL_MOD = 0x6c; // kept unused/reserved for offset compatibility
const ST_TOAST_PTR = 0x70;
const ST_SRCH_SUB = 0x74; // 0=keyboard picker, 1=verse results list
const ST_SRCH_RET = 0x78; // 0=Reader, 3=Main Menu
const ST_SRCH_LEN = 0x7c; // typed query length 0..14
const ST_SRCH_KCUR = 0x80; // keyboard cursor 0..27 (7 cols x 4 rows)
const ST_SRCH_MATCH_START = 0x84;
const ST_SRCH_MATCH_CNT = 0x88;
const ST_SRCH_MATCH_CUR = 0x8c;
const ST_SRCH_RES_CUR = 0x90;
const ST_SRCH_RES_SCR = 0x94;
const ST_SRCH_WORD_IDX = 0x98;
const ST_START_MOD = 0x9c; // kept unused/reserved
const ST_SRCH_QUERY = 0xa0; // char[16] null-terminated lowercase query
const ST_SRCH_LINE_BUF = 0xb0; // char[48] scratch buffer for verse snippet
const ST_SEL_ARMED = 0xe0; // 1 if SELECT pressed cleanly from >=4 idle frames with no combo keys
const ST_SEL_REL_CNT = 0xe4; // consecutive released frames (~50ms debounce)
const ST_SEL_IDLE_CNT = 0xe8; // consecutive idle frames before next SELECT press
const ST_START_ARMED = 0xec; // 1 if START pressed cleanly from >=4 idle frames with no combo keys
const ST_START_REL_CNT = 0xf0; // consecutive released frames (~50ms debounce)
const ST_START_IDLE_CNT = 0xf4; // consecutive idle frames before next START press
const ST_L_ARMED = 0xf8; // 1 if L pressed solo from >=4 idle frames (isolates L+R / START+L / IPS SELECT+L)
const ST_L_REL_CNT = 0xfc;
const ST_R_ARMED = 0x100; // 1 if R pressed solo from >=4 idle frames (isolates L+R / START+R / IPS SELECT+R)
const ST_R_REL_CNT = 0x104;
const ST_LR_IDLE_CNT = 0x108;

// TranslationEntry offsets (64 bytes per entry)
const TE_CODE = 0; // char[8]
const TE_NAME = 8; // char[24]
const TE_NUM_BOOKS = 32; // uint16
const TE_NT_START = 34; // uint16
const TE_TOTAL_CHAPS = 36; // uint32
const TE_CV_PTR = 40; // uint32 -> chapFirstVerse[totalChapters] (uint16[])
const TE_BOOK_PTR = 44; // uint32
const TE_CHAP_PTR = 48; // uint32
const TE_TOTAL_VERSES = 52; // uint32
const TE_CONC_WORDS = 56; // uint32
const TE_CONC_PTR = 60; // uint32

// GBA Hardware I/O
const REG_DISPCNT = 0x04000000;
const REG_VCOUNT = 0x04000006;
const REG_KEYINPUT = 0x04000130;
const PALETTE_RAM = 0x05000000;
const VRAM_PAGE0 = 0x06000000;
const VRAM_PAGE1 = 0x0600a000;
const SRAM_BASE = 0x0e000000;

// Key bits
const KEY_A = 1 << 0;
const KEY_B = 1 << 1;
const KEY_SELECT = 1 << 2;
const KEY_START = 1 << 3;
const KEY_RIGHT = 1 << 4;
const KEY_LEFT = 1 << 5;
const KEY_UP = 1 << 6;
const KEY_DOWN = 1 << 7;
const KEY_R = 1 << 8;
const KEY_L = 1 << 9;

// Fast table-driven CRC32 for multi-megabyte ROM builds
const CRC32_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function compileFirmware(config: RomBuildConfig): Uint8Array {
  const a = new ArmAssembler(0x080000c0);
  const wideBold = config.fontStyle === '8x8';

  // =========================================================================
  // ENTRY POINT (0x080000C0)
  // =========================================================================
  a.label('start');
  a.movImm(SP, 0x03007f00);

  // Silence interrupts cleanly without touching REG_WAITCNT or speaker PWM bias
  a.movImm(R0, 0x04000200);
  a.movImm(R1, 0);
  a.str(R1, R0, 8); // REG_IME = 0
  a.strh(R1, R0, 0); // REG_IE = 0
  a.movImm(R2, 0xffff);
  a.strh(R2, R0, 2); // REG_IF = 0xFFFF

  // Hold Forced Blank ON only until Frame 0 finishes rendering into VRAM Page 1
  a.movImm(R0, REG_DISPCNT);
  a.movImm(R2, 0x0080);
  a.strh(R2, R0, 0);
  a.strh(R1, R0, 0x4c); // REG_MOSAIC = 0
  a.strh(R1, R0, 0x50); // REG_BLDCNT = 0

  // Mute DMG channels & DMA Sound mixing WITHOUT toggling REG_SOUNDCNT_X or REG_SOUNDBIAS (no speaker pop!)
  a.movImm(R0, 0x04000060);
  a.movImm(R2, 8); // 8 words = 0x04000060..0x0400007C (Channels 1..4)
  a.label('mute_dmg_loop');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('mute_dmg_loop', 'NE');
  a.movImm(R0, 0x04000080);
  a.str(R1, R0, 0); // REG_SOUNDCNT_L & H = 0 (keep REG_SOUNDCNT_X & SOUNDBIAS untouched)

  // Disable DMA0..DMA3 & Timers 0..3 left over from flashcart menu
  a.movImm(R0, 0x040000b8);
  a.strh(R1, R0, 2);
  a.strh(R1, R0, 14);
  a.strh(R1, R0, 26);
  a.strh(R1, R0, 38);

  a.movImm(R0, 0x04000100);
  a.str(R1, R0, 0);
  a.str(R1, R0, 4);
  a.str(R1, R0, 8);
  a.str(R1, R0, 12);

  // Mode 4 BG2 Affine Matrix (identity 1:1 scale)
  a.movImm(R0, 0x04000020);
  a.movImm(R2, 0x0100);
  a.strh(R2, R0, 0); // BG2PA = 0x0100
  a.strh(R1, R0, 2); // BG2PB = 0
  a.strh(R1, R0, 4); // BG2PC = 0
  a.strh(R2, R0, 6); // BG2PD = 0x0100
  a.str(R1, R0, 8); // BG2X = 0
  a.str(R1, R0, 12); // BG2Y = 0

  // Zero IWRAM state block (0x03000000..0x0300013F)
  a.movImm(R0, STATE_BASE);
  a.movImm(R2, 80);
  a.label('zero_state_loop');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('zero_state_loop', 'NE');

  // Set default theme, layout & line density from ROM header
  a.movImm(R4, DATA_HEADER_ADDR);
  a.movImm(R5, STATE_BASE);
  a.ldr(R0, R4, 12); // defaultTheme
  a.str(R0, R5, ST_THEME);
  a.ldr(R0, R4, 24); // linesPerPage (14 or 16)
  a.str(R0, R5, ST_LINES_PP);
  a.ldr(R1, R4, 28); // lineHeight (9 or 8)
  a.str(R1, R5, ST_LINE_H);
  a.cmpImm(R0, 16);
  a.movImm(R2, 1, 'EQ');
  a.movImm(R2, 0, 'NE');
  a.str(R2, R5, ST_DENSITY);
  a.ldr(R0, R4, 60); // verseLayout (0=prose, 1=verse-per-line)
  a.str(R0, R5, ST_V_LAYOUT);
  a.ldrLabelAddr(R0, 'str_bm_saved');
  a.str(R0, R5, ST_TOAST_PTR);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_BACKBUF); // Page 1 rendered while Forced Blank is ON, then flipped into view

  // Try loading saved state from SRAM
  a.bl('sram_load');

  // Initialize Main Page cursor & scroll to active/saved translation
  a.ldr(R0, R5, ST_TRANS);
  a.str(R0, R5, ST_TRANS_CUR);
  a.cmpImm(R0, 5);
  a.movImm(R1, 0, 'LO');
  a.subImm(R1, R0, 4, 'HS');
  a.str(R1, R5, ST_TRANS_SCR);

  // Set boot mode (3 = Main Translation Selector if bootToMain != 0, else 0 = Reader)
  a.ldr(R0, R4, 56);
  a.cmpImm(R0, 0);
  a.movImm(R1, 3, 'NE');
  a.movImm(R1, 0, 'EQ');
  a.str(R1, R5, ST_MODE);

  // Apply palette for active theme & prepare line table
  a.bl('apply_palette');
  a.bl('build_line_table');

  // Render clean frame 0 while display is still Forced Blank; flip_buffer unblanks LCD!
  a.bl('render_screen');
  a.b('main_loop');
  a.flushLiterals();

  // =========================================================================
  // MAIN LOOP
  // =========================================================================
  a.label('main_loop');
  a.bl('wait_vblank');
  a.bl('poll_input');

  // Decrement toast timer if > 0
  a.movImm(R5, STATE_BASE);
  a.ldr(R0, R5, ST_TOAST);
  a.cmpImm(R0, 0);
  a.b('skip_toast_dec', 'EQ');
  a.subImm(R0, R0, 1);
  a.str(R0, R5, ST_TOAST);
  a.cmpImm(R0, 0);
  a.b('skip_toast_dec', 'NE');
  a.movImm(R1, 1);
  a.str(R1, R5, ST_DIRTY);
  a.label('skip_toast_dec');

  // Redraw only if dirty == 1
  a.ldr(R0, R5, ST_DIRTY);
  a.cmpImm(R0, 0);
  a.b('main_loop', 'EQ');

  a.movImm(R0, 0);
  a.str(R0, R5, ST_DIRTY);
  a.bl('render_screen');
  a.b('main_loop');

  // =========================================================================
  // WAIT VBLANK
  // =========================================================================
  a.label('wait_vblank');
  a.movImm(R0, REG_VCOUNT);
  a.label('wv_in_vb');
  a.ldrh(R1, R0, 0);
  a.cmpImm(R1, 160);
  a.b('wv_in_vb', 'HS');
  a.label('wv_wait_vb');
  a.ldrh(R1, R0, 0);
  a.cmpImm(R1, 160);
  a.b('wv_wait_vb', 'LO');
  a.bx(LR);

  // =========================================================================
  // TRANSLATION TABLE LOOKUP HELPERS (Preserve R3..R12)
  // =========================================================================
  // get_trans_ptr(R0 = transIdx) -> R0 = transEntryPtr (clobbers R1, R2)
  a.label('get_trans_ptr');
  a.movImm(R1, DATA_HEADER_ADDR);
  a.ldr(R1, R1, 8); // transTablePtr
  a.lslImm(R2, R0, 6); // * 64
  a.addReg(R0, R1, R2);
  a.bx(LR);

  // get_cur_trans_ptr() -> R0 = active transEntryPtr (clobbers R1, R2)
  a.label('get_cur_trans_ptr');
  a.movImm(R1, DATA_HEADER_ADDR);
  a.ldr(R1, R1, 8); // transTablePtr
  a.movImm(R2, STATE_BASE);
  a.ldr(R2, R2, ST_TRANS);
  a.lslImm(R2, R2, 6); // * 64
  a.addReg(R0, R1, R2);
  a.bx(LR);

  // capture_top_verse() -> R0 = unit (verse/paragraph) number at top visible line (0 if unavailable)
  // Clobbers R0..R3, R12
  a.label('capture_top_verse');
  a.movImm(R12, STATE_BASE);
  a.movImm(R0, 0);
  a.ldr(R1, R12, ST_SCROLL);
  a.cmpImm(R1, 0);
  a.bx(LR, 'EQ');
  a.ldr(R2, R12, ST_NUMLINES);
  a.cmpReg(R1, R2);
  a.bx(LR, 'HS');

  a.movImm(R3, LINE_TABLE_BASE);
  a.ldr(R0, R3, 0); // chapStartPtr -> R0 temporarily
  a.lslImm(R2, R1, 3);
  a.addReg(R2, R3, R2);
  a.ldr(R2, R2, 0); // curLinePtr

  a.label('ctv_back');
  a.ldrb(R3, R2, 0);
  a.cmpImm(R3, 0x04);
  a.b('ctv_parse', 'EQ');
  a.cmpReg(R2, R0);
  a.b('ctv_none', 'LS');
  a.subImm(R2, R2, 1);
  a.b('ctv_back');

  a.label('ctv_parse');
  a.addImm(R2, R2, 1);
  a.movImm(R0, 0);
  a.movImm(R1, 10);
  a.label('ctv_loop');
  a.ldrb(R3, R2, 0);
  a.cmpImm(R3, 0x30);
  a.bx(LR, 'LO');
  a.cmpImm(R3, 0x39);
  a.bx(LR, 'HI');
  a.mul(R12, R0, R1); // R12 != R0
  a.subImm(R3, R3, 0x30);
  a.addReg(R0, R12, R3);
  a.addImm(R2, R2, 1);
  a.b('ctv_loop');

  a.label('ctv_none');
  a.movImm(R0, 0);
  a.bx(LR);

  // scroll_to_verse(R0 = targetUnit): finds first line containing unit anchor >= R0 and updates ST_SCROLL
  a.label('scroll_to_verse');
  a.cmpImm(R0, 0);
  a.bx(LR, 'EQ');
  a.push([R4, R5, R7, R8, R9, R10, LR]);
  a.mov(R7, R0);
  a.movImm(R5, STATE_BASE);
  a.movImm(R8, LINE_TABLE_BASE);
  a.movImm(R9, 0);
  a.ldr(R10, R5, ST_NUMLINES);

  a.label('stv_match_line');
  a.cmpReg(R9, R10);
  a.b('stv_done', 'HS');
  a.lslImm(R0, R9, 3);
  a.addReg(R0, R8, R0);
  a.ldr(R2, R0, 0); // ptr
  a.ldrh(R3, R0, 4); // len
  a.addReg(R3, R2, R3); // endPtr

  a.label('stv_scan_bytes');
  a.cmpReg(R2, R3);
  a.b('stv_next_line', 'HS');
  a.ldrb(R4, R2, 0);
  a.addImm(R2, R2, 1);
  a.cmpImm(R4, 0x04);
  a.b('stv_scan_bytes', 'NE');

  a.movImm(R0, 0);
  a.movImm(R12, 10);
  a.label('stv_match_digits');
  a.cmpReg(R2, R3);
  a.b('stv_chk_verse', 'HS');
  a.ldrb(R4, R2, 0);
  a.cmpImm(R4, 0x30);
  a.b('stv_chk_verse', 'LO');
  a.cmpImm(R4, 0x39);
  a.b('stv_chk_verse', 'HI');
  a.mul(R1, R0, R12); // R1 != R0
  a.subImm(R4, R4, 0x30);
  a.addReg(R0, R1, R4);
  a.addImm(R2, R2, 1);
  a.b('stv_match_digits');

  a.label('stv_chk_verse');
  a.cmpReg(R0, R7);
  a.b('stv_scan_bytes', 'LO');

  a.ldr(R1, R5, ST_LINES_PP);
  a.cmpReg(R10, R1);
  a.b('stv_zero_scr', 'LS');
  a.subReg(R2, R10, R1);
  a.cmpReg(R9, R2);
  a.mov(R9, R2, 'HI');
  a.str(R9, R5, ST_SCROLL);
  a.b('stv_done');

  a.label('stv_zero_scr');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SCROLL);
  a.b('stv_done');

  a.label('stv_next_line');
  a.addImm(R9, R9, 1);
  a.b('stv_match_line');

  a.label('stv_done');
  a.pop([R4, R5, R7, R8, R9, R10, LR]);
  a.bx(LR);

  // switch_translation(R0 = newVolIdx)
  // If both old and new volumes are full Bibles (TE_NT_START > 0), preserves parallel verse position.
  // Otherwise restores the target book's independent saved (book, chap, scroll) slot from SRAM!
  a.label('switch_translation');
  a.push([R4, R5, R6, R7, R8, LR]);
  a.movImm(R5, STATE_BASE);
  a.mov(R6, R0);
  a.ldr(R1, R5, ST_TRANS);
  a.cmpReg(R6, R1);
  a.b('st_done', 'EQ');

  // Check if old volume and new volume are both multi-testament Bibles (parallel study)
  a.mov(R0, R1);
  a.bl('get_trans_ptr');
  a.ldrh(R7, R0, TE_NT_START); // oldNtStart
  a.mov(R0, R6);
  a.bl('get_trans_ptr');
  a.mov(R4, R0); // newTransPtr
  a.ldrh(R2, R4, TE_NT_START); // newNtStart
  a.cmpImm(R7, 0);
  a.b('st_independent', 'EQ');
  a.cmpImm(R2, 0);
  a.b('st_independent', 'EQ');

  // Parallel Bible translation mode: capture top verse & sync
  a.bl('capture_top_verse');
  a.mov(R7, R0); // targetVerse
  a.str(R6, R5, ST_TRANS);
  a.movImm(R8, 0); // R8 = 1 if book or chapter reset

  a.ldr(R1, R5, ST_BOOK);
  a.ldrh(R2, R4, TE_NUM_BOOKS);
  a.cmpReg(R1, R2);
  a.b('st_book_ok', 'LO');
  a.movImm(R1, 0);
  a.str(R1, R5, ST_BOOK);
  a.str(R1, R5, ST_CHAP);
  a.str(R1, R5, ST_SCROLL);
  a.movImm(R8, 1);
  a.b('st_rebuild');

  a.label('st_book_ok');
  a.ldr(R2, R4, TE_BOOK_PTR);
  a.lslImm(R3, R1, 5);
  a.addReg(R2, R2, R3);
  a.ldrh(R3, R2, 24);
  a.ldr(R1, R5, ST_CHAP);
  a.cmpReg(R1, R3);
  a.b('st_rebuild', 'LO');
  a.movImm(R1, 0);
  a.str(R1, R5, ST_CHAP);
  a.str(R1, R5, ST_SCROLL);
  a.movImm(R8, 1);

  a.label('st_rebuild');
  a.bl('build_line_table');
  a.cmpImm(R8, 0);
  a.b('st_save', 'NE');
  a.mov(R0, R7);
  a.bl('scroll_to_verse');
  a.b('st_save');

  // Independent E-Reader book mode: restore target volume's SRAM slot (or 0,0,0)
  a.label('st_independent');
  a.str(R6, R5, ST_TRANS);
  a.movImm(R0, 0);
  a.str(R0, R5, ST_BOOK);
  a.str(R0, R5, ST_CHAP);
  a.str(R0, R5, ST_SCROLL);

  a.cmpImm(R6, 32);
  a.b('st_ind_build', 'HS');
  a.movImm(R0, SRAM_BASE);
  a.addImm(R0, R0, 32);
  a.lslImm(R1, R6, 3);
  a.addReg(R0, R0, R1); // slotAddr
  a.ldrb(R1, R0, 6);
  a.cmpImm(R1, 0xa7);
  a.b('st_ind_build', 'NE');

  // Verify slot checksum
  a.movImm(R1, 0x5a);
  a.movImm(R2, 0);
  a.label('st_chk_slot');
  a.ldrbReg(R3, R0, R2);
  a.addReg(R1, R1, R3);
  a.addImm(R2, R2, 1);
  a.cmpImm(R2, 7);
  a.b('st_chk_slot', 'LO');
  a.andImm(R1, R1, 0xff);
  a.ldrb(R3, R0, 7);
  a.cmpReg(R1, R3);
  a.b('st_ind_build', 'NE');

  // Validate saved book & chapter in slot against R4 (newTransPtr)
  a.ldrb(R1, R0, 0);
  a.ldrb(R2, R0, 1);
  a.orrReg(R1, R1, R2, 0, 8);
  a.ldrh(R3, R4, TE_NUM_BOOKS);
  a.cmpReg(R1, R3);
  a.b('st_ind_build', 'HS');

  a.ldr(R2, R4, TE_BOOK_PTR);
  a.lslImm(R3, R1, 5);
  a.addReg(R2, R2, R3);
  a.ldrh(R3, R2, 24); // book.numChapters
  a.ldrb(R7, R0, 2);
  a.ldrb(R8, R0, 3);
  a.orrReg(R7, R7, R8, 0, 8);
  a.cmpReg(R7, R3);
  a.b('st_ind_build', 'HS');

  a.str(R1, R5, ST_BOOK);
  a.str(R7, R5, ST_CHAP);
  a.ldrb(R1, R0, 4);
  a.ldrb(R2, R0, 5);
  a.orrReg(R1, R1, R2, 0, 8);
  a.str(R1, R5, ST_SCROLL);

  a.label('st_ind_build');
  a.bl('build_line_table');

  a.label('st_save');
  a.bl('sram_save');

  a.label('st_done');
  a.pop([R4, R5, R6, R7, R8, LR]);
  a.bx(LR);

  // open_book_index(): if TE_NUM_BOOKS == 1 opens Chapter Grid directly; else opens Section/Book Index
  a.label('open_book_index');
  a.push([R4, R5, LR]);
  a.movImm(R5, STATE_BASE);
  a.bl('get_cur_trans_ptr');
  a.mov(R4, R0);
  a.ldrh(R2, R4, TE_NUM_BOOKS);
  a.cmpImm(R2, 1);
  a.b('obi_single_book', 'LS');

  a.ldr(R0, R5, ST_BOOK);
  a.str(R0, R5, ST_BOOK_CUR);
  a.cmpImm(R0, 6);
  a.movImm(R1, 0, 'LO');
  a.subImm(R1, R0, 6, 'HS');
  a.cmpImm(R2, 13);
  a.b('obi_ok', 'LS');
  a.subImm(R3, R2, 13);
  a.cmpReg(R1, R3);
  a.mov(R1, R3, 'HI');
  a.b('obi_store');
  a.label('obi_ok');
  a.movImm(R1, 0);
  a.label('obi_store');
  a.str(R1, R5, ST_BOOK_SCR);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_MODE);
  a.str(R0, R5, ST_DIRTY);
  a.pop([R4, R5, LR]);
  a.bx(LR);

  a.label('obi_single_book');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_BOOK_CUR);
  a.ldr(R0, R5, ST_CHAP);
  a.str(R0, R5, ST_CHAP_CUR);
  a.movImm(R1, 48);
  a.bl('udivmod'); // R0 = page, R1 = remainder
  a.ldr(R0, R5, ST_CHAP);
  a.subReg(R0, R0, R1);
  a.str(R0, R5, ST_CHAP_SCR);
  a.movImm(R0, 2);
  a.str(R0, R5, ST_MODE);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.pop([R4, R5, LR]);
  a.bx(LR);

  // open_main_page(): sets ST_TRANS_CUR = ST_TRANS, adjusts scroll, sets ST_MODE = 3
  a.label('open_main_page');
  a.movImm(R5, STATE_BASE);
  a.ldr(R0, R5, ST_TRANS);
  a.str(R0, R5, ST_TRANS_CUR);
  a.cmpImm(R0, 5);
  a.movImm(R1, 0, 'LO');
  a.subImm(R1, R0, 4, 'HS');
  a.str(R1, R5, ST_TRANS_SCR);
  a.movImm(R0, 3);
  a.str(R0, R5, ST_MODE);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.bx(LR);

  // =========================================================================
  // POLL INPUT
  // =========================================================================
  a.label('poll_input');
  a.push([R4, R5, R6, R7, R8, LR]);
  a.movImm(R4, DATA_HEADER_ADDR);
  a.movImm(R5, STATE_BASE);

  a.movImm(R0, REG_KEYINPUT);
  a.ldrh(R1, R0, 0);
  a.movImm(R2, 0x3ff);
  a.subReg(R1, R2, R1); // R1 = (~KEYINPUT) & 0x3FF -> 1 = pressed
  a.andReg(R1, R1, R2);

  a.ldr(R2, R5, ST_PREV_KEYS);
  a.str(R1, R5, ST_PREV_KEYS);

  // R6 = newly pressed = R1 & ~R2
  a.movImm(R3, 0x3ff);
  a.subReg(R3, R3, R2);
  a.andReg(R6, R1, R3);

  // Reader-only debounced release handling for SELECT (Theme) and START (Book Index)
  // Requires >= 4 idle frames before arming, clears immediately if ANY other key is held/pressed,
  // and waits 3 consecutive released frames (~50ms) so GBA rubber-pad bounce while holding START
  // never falsely triggers Book Selection.
  a.ldr(R0, R5, ST_MODE);
  a.cmpImm(R0, 0);
  a.b('pi_not_reader_mod', 'NE');

  // --- SELECT debounce (Theme) ---
  a.movImm(R0, 0x3ff);
  a.subImm(R3, R0, KEY_SELECT);
  a.tstReg(R1, R3); // any non-SELECT key held?
  a.movImm(R0, 0, 'NE');
  a.str(R0, R5, ST_SEL_ARMED, 'NE');

  a.tstImm(R1, KEY_SELECT);
  a.b('pi_sel_up', 'EQ');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SEL_REL_CNT);
  a.ldr(R0, R5, ST_SEL_IDLE_CNT);
  a.cmpImm(R0, 4);
  a.b('pi_sel_clear_idle', 'LO');
  a.tstReg(R1, R3);
  a.movImm(R0, 1, 'EQ');
  a.str(R0, R5, ST_SEL_ARMED, 'EQ');
  a.label('pi_sel_clear_idle');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SEL_IDLE_CNT);
  a.b('pi_chk_start_deb');

  a.label('pi_sel_up');
  a.ldr(R0, R5, ST_SEL_IDLE_CNT);
  a.cmpImm(R0, 16);
  a.addImm(R0, R0, 1, 'LO');
  a.str(R0, R5, ST_SEL_IDLE_CNT);
  a.ldr(R0, R5, ST_SEL_ARMED);
  a.cmpImm(R0, 0);
  a.b('pi_sel_not_armed', 'EQ');
  a.ldr(R0, R5, ST_SEL_REL_CNT);
  a.addImm(R0, R0, 1);
  a.cmpImm(R0, 3);
  a.b('pi_sel_fire', 'HS');
  a.str(R0, R5, ST_SEL_REL_CNT);
  a.b('pi_chk_start_deb');
  a.label('pi_sel_fire');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SEL_ARMED);
  a.str(R0, R5, ST_SEL_REL_CNT);
  a.ldr(R0, R5, ST_THEME);
  a.addImm(R0, R0, 1);
  a.andImm(R0, R0, 3);
  a.str(R0, R5, ST_THEME);
  a.push([R1, R2, R6]);
  a.bl('apply_palette');
  a.bl('mark_dirty_save');
  a.pop([R1, R2, R6]);
  a.b('pi_chk_start_deb');
  a.label('pi_sel_not_armed');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SEL_REL_CNT);

  // --- START debounce (Book & Chapter Selection) ---
  a.label('pi_chk_start_deb');
  a.movImm(R0, 0x3ff);
  a.subImm(R3, R0, KEY_START);
  a.tstReg(R1, R3); // any non-START key held?
  a.movImm(R0, 0, 'NE');
  a.str(R0, R5, ST_START_ARMED, 'NE');

  a.tstImm(R1, KEY_START);
  a.b('pi_start_up', 'EQ');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_START_REL_CNT);
  a.ldr(R0, R5, ST_START_IDLE_CNT);
  a.cmpImm(R0, 4);
  a.b('pi_start_clear_idle', 'LO');
  a.tstReg(R1, R3);
  a.movImm(R0, 1, 'EQ');
  a.str(R0, R5, ST_START_ARMED, 'EQ');
  a.label('pi_start_clear_idle');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_START_IDLE_CNT);
  a.b('pi_after_sel_rel');

  a.label('pi_start_up');
  a.ldr(R0, R5, ST_START_IDLE_CNT);
  a.cmpImm(R0, 16);
  a.addImm(R0, R0, 1, 'LO');
  a.str(R0, R5, ST_START_IDLE_CNT);
  a.ldr(R0, R5, ST_START_ARMED);
  a.cmpImm(R0, 0);
  a.b('pi_start_not_armed', 'EQ');
  a.ldr(R0, R5, ST_START_REL_CNT);
  a.addImm(R0, R0, 1);
  a.cmpImm(R0, 3);
  a.b('pi_start_fire', 'HS');
  a.str(R0, R5, ST_START_REL_CNT);
  a.b('pi_after_sel_rel');
  a.label('pi_start_fire');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_START_ARMED);
  a.str(R0, R5, ST_START_REL_CNT);
  a.str(R0, R5, ST_START_IDLE_CNT);
  a.bl('open_book_index');
  a.b('poll_done');
  a.label('pi_start_not_armed');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_START_REL_CNT);

  // --- L / R bumper debounce (Prev/Next Chapter in Reader; prevents L+R & IPS/START combo misfires) ---
  a.label('pi_chk_l_deb');
  a.movImm(R0, 0x3ff);
  a.subImm(R3, R0, KEY_L);
  a.tstReg(R1, R3); // any non-L key held?
  a.movImm(R0, 0, 'NE');
  a.str(R0, R5, ST_L_ARMED, 'NE');

  a.movImm(R0, KEY_L);
  a.tstReg(R1, R0);
  a.b('pi_l_up', 'EQ');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_L_REL_CNT);
  a.ldr(R0, R5, ST_LR_IDLE_CNT);
  a.cmpImm(R0, 4);
  a.b('pi_chk_r_deb', 'LO');
  a.tstReg(R1, R3);
  a.movImm(R0, 1, 'EQ');
  a.str(R0, R5, ST_L_ARMED, 'EQ');
  a.b('pi_chk_r_deb');

  a.label('pi_l_up');
  a.ldr(R0, R5, ST_L_ARMED);
  a.cmpImm(R0, 0);
  a.b('pi_l_not_armed', 'EQ');
  a.ldr(R0, R5, ST_L_REL_CNT);
  a.addImm(R0, R0, 1);
  a.cmpImm(R0, 2);
  a.b('pi_l_fire', 'HS');
  a.str(R0, R5, ST_L_REL_CNT);
  a.b('pi_chk_r_deb');
  a.label('pi_l_fire');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_L_ARMED);
  a.str(R0, R5, ST_L_REL_CNT);
  a.str(R0, R5, ST_LR_IDLE_CNT);
  a.bl('prev_chapter');
  a.b('poll_done');
  a.label('pi_l_not_armed');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_L_REL_CNT);

  a.label('pi_chk_r_deb');
  a.movImm(R0, 0x3ff);
  a.subImm(R3, R0, KEY_R);
  a.tstReg(R1, R3); // any non-R key held?
  a.movImm(R0, 0, 'NE');
  a.str(R0, R5, ST_R_ARMED, 'NE');

  a.movImm(R0, KEY_R);
  a.tstReg(R1, R0);
  a.b('pi_r_up', 'EQ');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_R_REL_CNT);
  a.ldr(R0, R5, ST_LR_IDLE_CNT);
  a.cmpImm(R0, 4);
  a.b('pi_lr_idle_upd', 'LO');
  a.tstReg(R1, R3);
  a.movImm(R0, 1, 'EQ');
  a.str(R0, R5, ST_R_ARMED, 'EQ');
  a.b('pi_lr_idle_upd');

  a.label('pi_r_up');
  a.ldr(R0, R5, ST_R_ARMED);
  a.cmpImm(R0, 0);
  a.b('pi_r_not_armed', 'EQ');
  a.ldr(R0, R5, ST_R_REL_CNT);
  a.addImm(R0, R0, 1);
  a.cmpImm(R0, 2);
  a.b('pi_r_fire', 'HS');
  a.str(R0, R5, ST_R_REL_CNT);
  a.b('pi_lr_idle_upd');
  a.label('pi_r_fire');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_R_ARMED);
  a.str(R0, R5, ST_R_REL_CNT);
  a.str(R0, R5, ST_LR_IDLE_CNT);
  a.bl('next_chapter');
  a.b('poll_done');
  a.label('pi_r_not_armed');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_R_REL_CNT);

  a.label('pi_lr_idle_upd');
  a.cmpImm(R1, 0);
  a.b('pi_lr_clear_idle', 'NE');
  a.ldr(R0, R5, ST_LR_IDLE_CNT);
  a.cmpImm(R0, 16);
  a.addImm(R0, R0, 1, 'LO');
  a.str(R0, R5, ST_LR_IDLE_CNT);
  a.b('pi_after_sel_rel');
  a.label('pi_lr_clear_idle');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_LR_IDLE_CNT);
  a.b('pi_after_sel_rel');

  a.label('pi_not_reader_mod');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SEL_ARMED);
  a.str(R0, R5, ST_SEL_REL_CNT);
  a.str(R0, R5, ST_SEL_IDLE_CNT);
  a.str(R0, R5, ST_START_ARMED);
  a.str(R0, R5, ST_START_REL_CNT);
  a.str(R0, R5, ST_START_IDLE_CNT);
  a.str(R0, R5, ST_L_ARMED);
  a.str(R0, R5, ST_L_REL_CNT);
  a.str(R0, R5, ST_R_ARMED);
  a.str(R0, R5, ST_R_REL_CNT);
  a.str(R0, R5, ST_LR_IDLE_CNT);

  a.label('pi_after_sel_rel');
  // Key repeat for directional keys (0xF0 = Right, Left, Up, Down)
  a.andImm(R7, R1, 0xf0);
  a.cmpImm(R7, 0);
  a.b('no_dpad_held', 'EQ');
  a.ldr(R8, R5, ST_HOLD_CNT);
  a.addImm(R8, R8, 1);
  a.cmpImm(R8, 18);
  a.b('store_hold', 'LO');
  a.orrReg(R6, R6, R7);
  a.movImm(R8, 14);
  a.b('store_hold');
  a.label('no_dpad_held');
  a.movImm(R8, 0);
  a.label('store_hold');
  a.str(R8, R5, ST_HOLD_CNT);

  // If no keys triggered, return
  a.cmpImm(R6, 0);
  a.b('poll_done', 'EQ');

  // Dispatch by screenMode (3 = Main Menu)
  a.ldr(R0, R5, ST_MODE);
  a.cmpImm(R0, 3);
  a.b('handle_main_keys', 'EQ');

  // L + R pressed together anywhere outside Main Menu -> Open Main Menu (Translations)
  a.movImm(R2, KEY_L | KEY_R);
  a.andReg(R3, R1, R2);
  a.cmpReg(R3, R2);
  a.b('pi_dispatch', 'NE');
  a.tstReg(R6, R2);
  a.b('pi_dispatch', 'EQ');
  a.bl('open_main_page');
  a.b('poll_done');

  a.label('pi_dispatch');
  a.cmpImm(R0, 0);
  a.b('handle_reader_keys', 'EQ');
  a.cmpImm(R0, 1);
  a.b('handle_books_keys', 'EQ');
  a.cmpImm(R0, 2);
  a.b('handle_chaps_keys', 'EQ');
  a.bl('handle_conc_keys_fn');
  a.b('poll_done');

  // --- READER KEYS (mode = 0) ---
  a.label('handle_reader_keys');

  // DOWN: scroll + 1
  a.tstImm(R6, KEY_DOWN);
  a.b('rk_chk_up', 'EQ');
  a.ldr(R0, R5, ST_SCROLL);
  a.ldr(R1, R5, ST_NUMLINES);
  a.ldr(R2, R5, ST_LINES_PP);
  a.cmpReg(R1, R2);
  a.b('rk_chk_up', 'LS');
  a.subReg(R3, R1, R2);
  a.cmpReg(R0, R3);
  a.b('rk_chk_up', 'HS');
  a.addImm(R0, R0, 1);
  a.str(R0, R5, ST_SCROLL);
  a.bl('mark_dirty_save');
  a.ldr(R1, R5, ST_PREV_KEYS); // restore R1 curKeys

  a.label('rk_chk_up');
  a.tstImm(R6, KEY_UP);
  a.b('rk_chk_right', 'EQ');
  a.ldr(R0, R5, ST_SCROLL);
  a.cmpImm(R0, 0);
  a.b('rk_chk_right', 'EQ');
  a.subImm(R0, R0, 1);
  a.str(R0, R5, ST_SCROLL);
  a.bl('mark_dirty_save');
  a.ldr(R1, R5, ST_PREV_KEYS);

  a.label('rk_chk_right');
  a.tstImm(R6, KEY_RIGHT);
  a.b('rk_chk_left', 'EQ');
  a.ldr(R0, R5, ST_SCROLL);
  a.ldr(R1, R5, ST_NUMLINES);
  a.ldr(R2, R5, ST_LINES_PP);
  a.cmpReg(R1, R2);
  a.b('rk_next_ch_on_end', 'LS');
  a.subReg(R3, R1, R2);
  a.cmpReg(R0, R3);
  a.b('rk_next_ch_on_end', 'HS');
  a.subImm(R7, R2, 1);
  a.addReg(R0, R0, R7);
  a.cmpReg(R0, R3);
  a.mov(R0, R3, 'HI');
  a.str(R0, R5, ST_SCROLL);
  a.bl('mark_dirty_save');
  a.ldr(R1, R5, ST_PREV_KEYS);
  a.b('rk_chk_left');

  a.label('rk_next_ch_on_end');
  a.bl('next_chapter');
  a.ldr(R1, R5, ST_PREV_KEYS);
  a.b('rk_chk_a');

  a.label('rk_chk_left');
  a.tstImm(R6, KEY_LEFT);
  a.b('rk_chk_sel_combo', 'EQ');
  a.ldr(R0, R5, ST_SCROLL);
  a.cmpImm(R0, 0);
  a.b('rk_prev_ch_on_top', 'EQ');
  a.ldr(R2, R5, ST_LINES_PP);
  a.subImm(R7, R2, 1);
  a.cmpReg(R0, R7);
  a.movImm(R0, 0, 'LO');
  a.subReg(R0, R0, R7, 'HS');
  a.str(R0, R5, ST_SCROLL);
  a.bl('mark_dirty_save');
  a.ldr(R1, R5, ST_PREV_KEYS);
  a.b('rk_chk_sel_combo');

  a.label('rk_prev_ch_on_top');
  a.bl('prev_chapter');
  a.ldr(R1, R5, ST_PREV_KEYS);
  a.b('rk_chk_a');

  // IPS-safe combos (reload R1 curKeys first since DOWN/RIGHT overwrite R1 with ST_NUMLINES):
  //   SELECT held: SELECT+A -> Concordance, ignore SELECT+L/R so IPS brightness adjusts cleanly!
  //   START + R -> Toggle 14 lines (9px) <-> 16 lines (8px)
  //   START + L -> Toggle Flowing Prose <-> Verse-per-Line
  //   START + A -> Open Concordance Word Search
  a.label('rk_chk_sel_combo');
  a.ldr(R1, R5, ST_PREV_KEYS);
  a.tstImm(R1, KEY_SELECT);
  a.b('rk_chk_start_combo', 'EQ');
  a.tstImm(R6, KEY_A);
  a.b('poll_done', 'EQ');
  a.movImm(R0, 0);
  a.bl('open_concordance');
  a.b('poll_done');

  a.label('rk_chk_start_combo');
  a.tstImm(R1, KEY_START);
  a.b('rk_chk_a', 'EQ');

  a.movImm(R0, KEY_R);
  a.tstReg(R6, R0);
  a.b('rk_chk_startl', 'EQ');
  a.ldr(R0, R5, ST_DENSITY);
  a.eorImm(R0, R0, 1);
  a.str(R0, R5, ST_DENSITY);
  a.cmpImm(R0, 0);
  a.movImm(R1, 14, 'EQ');
  a.movImm(R2, 9, 'EQ');
  a.ldrLabelAddr(R3, 'str_toast_14l', 'EQ');
  a.movImm(R1, 16, 'NE');
  a.movImm(R2, 8, 'NE');
  a.ldrLabelAddr(R3, 'str_toast_16l', 'NE');
  a.str(R1, R5, ST_LINES_PP);
  a.str(R2, R5, ST_LINE_H);
  a.str(R3, R5, ST_TOAST_PTR);
  a.movImm(R0, 80);
  a.str(R0, R5, ST_TOAST);
  a.ldr(R0, R5, ST_NUMLINES);
  a.cmpReg(R0, R1);
  a.b('rk_selr_zero_scr', 'LS');
  a.subReg(R2, R0, R1);
  a.ldr(R3, R5, ST_SCROLL);
  a.cmpReg(R3, R2);
  a.mov(R3, R2, 'HI');
  a.str(R3, R5, ST_SCROLL);
  a.b('rk_selr_done');
  a.label('rk_selr_zero_scr');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SCROLL);
  a.label('rk_selr_done');
  a.bl('mark_dirty_save');
  a.b('poll_done');

  a.label('rk_chk_startl');
  a.movImm(R0, KEY_L);
  a.tstReg(R6, R0);
  a.b('rk_chk_starta', 'EQ');
  a.bl('capture_top_verse');
  a.push([R0]);
  a.ldr(R0, R5, ST_V_LAYOUT);
  a.eorImm(R0, R0, 1);
  a.str(R0, R5, ST_V_LAYOUT);
  a.cmpImm(R0, 0);
  a.ldrLabelAddr(R3, 'str_toast_prose', 'EQ');
  a.ldrLabelAddr(R3, 'str_toast_vpl', 'NE');
  a.str(R3, R5, ST_TOAST_PTR);
  a.movImm(R0, 80);
  a.str(R0, R5, ST_TOAST);
  a.bl('build_line_table');
  a.pop([R0]);
  a.bl('scroll_to_verse');
  a.bl('mark_dirty_save');
  a.b('poll_done');

  a.label('rk_chk_starta');
  a.tstImm(R6, KEY_A);
  a.b('rk_chk_b', 'EQ');
  a.movImm(R0, 0);
  a.bl('open_concordance');
  a.b('poll_done');

  a.label('rk_chk_a');
  // A -> open Book & Chapter Selection immediately (START/L/R trigger on clean release)
  a.tstImm(R6, KEY_A);
  a.b('rk_chk_b', 'EQ');
  a.bl('open_book_index');
  a.b('poll_done');

  a.label('rk_chk_b');
  // B -> Save bookmark (including active translation)
  a.tstImm(R6, KEY_B);
  a.b('poll_done', 'EQ');
  a.ldr(R0, R5, ST_TRANS);
  a.str(R0, R5, ST_BM_TRANS);
  a.ldr(R0, R5, ST_BOOK);
  a.str(R0, R5, ST_BM_BOOK);
  a.ldr(R0, R5, ST_CHAP);
  a.str(R0, R5, ST_BM_CHAP);
  a.ldr(R0, R5, ST_SCROLL);
  a.str(R0, R5, ST_BM_LINE);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_HAS_BM);
  a.ldrLabelAddr(R0, 'str_bm_saved');
  a.str(R0, R5, ST_TOAST_PTR);
  a.movImm(R0, 75);
  a.str(R0, R5, ST_TOAST);
  a.bl('mark_dirty_save');
  a.b('poll_done');

  // --- BOOK SELECTOR KEYS (mode = 1) ---
  a.label('handle_books_keys');
  a.bl('get_cur_trans_ptr');
  a.mov(R3, R0); // transEntryPtr (safe across local label hops!)
  a.ldr(R7, R5, ST_BOOK_CUR);
  a.ldrh(R8, R3, TE_NUM_BOOKS);

  a.tstImm(R6, KEY_DOWN);
  a.b('bk_chk_up', 'EQ');
  a.addImm(R7, R7, 1);
  a.cmpReg(R7, R8);
  a.movImm(R7, 0, 'HS');
  a.label('bk_chk_up');
  a.tstImm(R6, KEY_UP);
  a.b('bk_chk_right', 'EQ');
  a.cmpImm(R7, 0);
  a.subImm(R7, R7, 1, 'NE');
  a.subImm(R7, R8, 1, 'EQ');

  a.label('bk_chk_right');
  a.tstImm(R6, KEY_RIGHT);
  a.b('bk_chk_left', 'EQ');
  a.addImm(R7, R7, 13);
  a.subImm(R0, R8, 1);
  a.cmpReg(R7, R0);
  a.mov(R7, R0, 'HI');

  a.label('bk_chk_left');
  a.tstImm(R6, KEY_LEFT);
  a.b('bk_chk_lr', 'EQ');
  a.cmpImm(R7, 13);
  a.movImm(R7, 0, 'LO');
  a.subImm(R7, R7, 13, 'HS');

  a.label('bk_chk_lr');
  // L -> jump to start (0), R -> jump to NT start if Bible, else midpoint section
  a.movImm(R0, KEY_L);
  a.tstReg(R6, R0);
  a.movImm(R7, 0, 'NE');
  a.movImm(R0, KEY_R);
  a.tstReg(R6, R0);
  a.b('bk_after_lr', 'EQ');
  a.ldrh(R0, R3, TE_NT_START);
  a.cmpImm(R0, 0);
  a.mov(R7, R0, 'NE');
  a.lsrImm(R7, R8, 1, 'EQ');
  a.label('bk_after_lr');

  a.str(R7, R5, ST_BOOK_CUR);
  // Adjust bookScroll to keep R7 in [scroll .. scroll+12]
  a.ldr(R1, R5, ST_BOOK_SCR);
  a.cmpReg(R7, R1);
  a.mov(R1, R7, 'LO');
  a.addImm(R2, R1, 12);
  a.cmpReg(R7, R2);
  a.subImm(R1, R7, 12, 'HI');
  a.str(R1, R5, ST_BOOK_SCR);

  // SELECT in Book Index -> Jump to saved Bookmark (including its translation!) if hasBookmark == 1
  a.tstImm(R6, KEY_SELECT);
  a.b('bk_chk_a', 'EQ');
  a.ldr(R0, R5, ST_HAS_BM);
  a.cmpImm(R0, 0);
  a.b('bk_chk_a', 'EQ');
  a.ldr(R0, R5, ST_BM_TRANS);
  a.str(R0, R5, ST_TRANS);
  a.ldr(R0, R5, ST_BM_BOOK);
  a.str(R0, R5, ST_BOOK);
  a.ldr(R0, R5, ST_BM_CHAP);
  a.str(R0, R5, ST_CHAP);
  a.ldr(R0, R5, ST_BM_LINE);
  a.str(R0, R5, ST_SCROLL);
  a.movImm(R0, 0);
  a.str(R0, R5, ST_MODE);
  a.bl('build_line_table');
  a.bl('mark_dirty_save');
  a.b('poll_done');

  a.label('bk_chk_a');
  a.tstImm(R6, KEY_A);
  a.b('bk_chk_b', 'EQ');
  // Open Chapter Grid for bookCursor
  a.movImm(R0, 0);
  a.str(R0, R5, ST_CHAP_CUR);
  a.str(R0, R5, ST_CHAP_SCR);
  a.ldr(R1, R5, ST_BOOK);
  a.cmpReg(R7, R1);
  a.b('bk_open_ch', 'NE');
  a.ldr(R0, R5, ST_CHAP);
  a.str(R0, R5, ST_CHAP_CUR);
  a.label('bk_open_ch');
  a.movImm(R0, 2);
  a.str(R0, R5, ST_MODE);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.b('poll_done');

  a.label('bk_chk_b');
  a.tstImm(R6, KEY_B | KEY_START);
  a.b('bk_mark_dirty', 'EQ');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_MODE);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.b('poll_done');

  a.label('bk_mark_dirty');
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.b('poll_done');

  // --- CHAPTER SELECTOR KEYS (mode = 2) ---
  a.label('handle_chaps_keys');
  a.bl('get_cur_trans_ptr');
  a.ldr(R1, R0, TE_BOOK_PTR);
  a.ldr(R0, R5, ST_BOOK_CUR);
  a.lslImm(R2, R0, 5); // * 32
  a.addReg(R1, R1, R2);
  a.ldrh(R8, R1, 24); // numChapters in selected book
  a.ldr(R7, R5, ST_CHAP_CUR);

  a.tstImm(R6, KEY_RIGHT);
  a.b('ck_chk_left', 'EQ');
  a.addImm(R7, R7, 1);
  a.cmpReg(R7, R8);
  a.movImm(R7, 0, 'HS');

  a.label('ck_chk_left');
  a.tstImm(R6, KEY_LEFT);
  a.b('ck_chk_down', 'EQ');
  a.cmpImm(R7, 0);
  a.subImm(R7, R7, 1, 'NE');
  a.subImm(R7, R8, 1, 'EQ');

  a.label('ck_chk_down');
  a.tstImm(R6, KEY_DOWN);
  a.b('ck_chk_up', 'EQ');
  a.addImm(R0, R7, 6);
  a.cmpReg(R0, R8);
  a.mov(R7, R0, 'LO');

  a.label('ck_chk_up');
  a.tstImm(R6, KEY_UP);
  a.b('ck_chk_a', 'EQ');
  a.cmpImm(R7, 6);
  a.subImm(R7, R7, 6, 'HS');

  a.label('ck_chk_a');
  a.str(R7, R5, ST_CHAP_CUR);
  a.ldr(R1, R5, ST_CHAP_SCR);
  a.cmpReg(R7, R1);
  a.b('ck_scr_low', 'LO');
  a.addImm(R2, R1, 47);
  a.cmpReg(R7, R2);
  a.b('ck_scr_ok', 'LS');
  a.addImm(R1, R1, 48);
  a.b('ck_scr_store');
  a.label('ck_scr_low');
  a.cmpImm(R1, 48);
  a.movImm(R1, 0, 'LO');
  a.subImm(R1, R1, 48, 'HS');
  a.label('ck_scr_store');
  a.str(R1, R5, ST_CHAP_SCR);
  a.label('ck_scr_ok');

  a.tstImm(R6, KEY_A);
  a.b('ck_chk_b', 'EQ');
  a.ldr(R0, R5, ST_BOOK_CUR);
  a.str(R0, R5, ST_BOOK);
  a.str(R7, R5, ST_CHAP);
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SCROLL);
  a.str(R0, R5, ST_MODE);
  a.bl('build_line_table');
  a.bl('mark_dirty_save');
  a.b('poll_done');

  a.label('ck_chk_b');
  a.tstImm(R6, KEY_B);
  a.b('ck_chk_start', 'EQ');
  a.bl('get_cur_trans_ptr');
  a.ldrh(R1, R0, TE_NUM_BOOKS);
  a.cmpImm(R1, 1);
  a.movImm(R0, 0, 'LS');
  a.movImm(R0, 1, 'HI');
  a.str(R0, R5, ST_MODE);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.b('poll_done');

  a.label('ck_chk_start');
  a.tstImm(R6, KEY_START);
  a.b('ck_mark_dirty', 'EQ');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_MODE);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.b('poll_done');

  a.label('ck_mark_dirty');
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.b('poll_done');

  // --- MAIN PAGE: TRANSLATION SELECTOR + CONCORDANCE ENTRY (mode = 3) ---
  a.label('handle_main_keys');
  a.ldr(R7, R5, ST_TRANS_CUR);
  a.ldr(R8, R4, 4); // numTranslations
  a.addImm(R8, R8, 1); // +1 for Concordance Search card

  a.tstImm(R6, KEY_DOWN | KEY_RIGHT);
  a.b('mk_chk_up', 'EQ');
  a.addImm(R7, R7, 1);
  a.cmpReg(R7, R8);
  a.movImm(R7, 0, 'HS');

  a.label('mk_chk_up');
  a.tstImm(R6, KEY_UP | KEY_LEFT);
  a.b('mk_store_cur', 'EQ');
  a.cmpImm(R7, 0);
  a.subImm(R7, R7, 1, 'NE');
  a.subImm(R7, R8, 1, 'EQ');

  a.label('mk_store_cur');
  a.str(R7, R5, ST_TRANS_CUR);
  // Keep ST_TRANS_CUR visible in [ST_TRANS_SCR .. ST_TRANS_SCR + 4] (5 cards visible)
  a.ldr(R1, R5, ST_TRANS_SCR);
  a.cmpReg(R7, R1);
  a.mov(R1, R7, 'LO');
  a.addImm(R2, R1, 4);
  a.cmpReg(R7, R2);
  a.subImm(R1, R7, 4, 'HI');
  a.str(R1, R5, ST_TRANS_SCR);

  // A or START -> if Concordance card selected open Concordance, else open Reader (mode = 0)
  a.tstImm(R6, KEY_A | KEY_START);
  a.b('mk_chk_b', 'EQ');
  a.ldr(R8, R4, 4);
  a.cmpReg(R7, R8);
  a.b('mk_open_trans', 'LO');
  a.movImm(R0, 3);
  a.bl('open_concordance');
  a.b('poll_done');

  a.label('mk_open_trans');
  a.mov(R0, R7);
  a.bl('switch_translation');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_MODE);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.b('poll_done');

  // B -> if Concordance card selected open Concordance, else open Book Index
  a.label('mk_chk_b');
  a.tstImm(R6, KEY_B);
  a.b('mk_chk_sel', 'EQ');
  a.ldr(R8, R4, 4);
  a.cmpReg(R7, R8);
  a.b('mk_open_books', 'LO');
  a.movImm(R0, 3);
  a.bl('open_concordance');
  a.b('poll_done');

  a.label('mk_open_books');
  a.mov(R0, R7);
  a.bl('switch_translation');
  a.bl('open_book_index');
  a.b('poll_done');

  // SELECT -> cycle 4 hardware color themes right on the Main Page
  a.label('mk_chk_sel');
  a.tstImm(R6, KEY_SELECT);
  a.b('mk_dirty', 'EQ');
  a.ldr(R0, R5, ST_THEME);
  a.addImm(R0, R0, 1);
  a.andImm(R0, R0, 3);
  a.str(R0, R5, ST_THEME);
  a.bl('apply_palette');
  a.bl('sram_save');

  a.label('mk_dirty');
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);

  a.label('poll_done');
  a.pop([R4, R5, R6, R7, R8, LR]);
  a.bx(LR);
  a.flushLiterals();

  // =========================================================================
  // CONCORDANCE HELPERS & INPUT HANDLER (mode = 4)
  // R4=DATA_HEADER_ADDR, R5=STATE_BASE, R1=curKeys, R6=newKeys
  // =========================================================================
  a.label('open_concordance');
  a.push([R5, LR]);
  a.movImm(R5, STATE_BASE);
  a.str(R0, R5, ST_SRCH_RET);
  a.movImm(R0, 4);
  a.str(R0, R5, ST_MODE);
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SRCH_SUB);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.bl('conc_update_matches');
  a.pop([R5, LR]);
  a.bx(LR);

  // conc_update_matches(): binary-search TE_CONC_PTR for lower_bound(ST_SRCH_QUERY) & count prefix hits
  a.label('conc_update_matches');
  a.push([R4, R5, R6, R7, R8, R9, R10, R11, LR]);
  a.bl('get_cur_trans_ptr');
  a.ldr(R7, R0, TE_CONC_WORDS);
  a.ldr(R8, R0, TE_CONC_PTR);
  a.movImm(R5, STATE_BASE);
  a.ldr(R9, R5, ST_SRCH_LEN);
  a.addImm(R12, R5, ST_SRCH_QUERY);

  a.movImm(R4, 0); // lo
  a.mov(R6, R7); // hi

  a.label('cm_bs_loop');
  a.cmpReg(R4, R6);
  a.b('cm_bs_done', 'HS');
  a.addReg(R10, R4, R6);
  a.lsrImm(R10, R10, 1); // mid
  a.addReg(R0, R10, R10, 0, 1);
  a.lslImm(R0, R0, 3); // mid * 24
  a.addReg(R11, R8, R0); // WordEntry[mid]

  a.movImm(R0, 0); // byte index 0..15
  a.label('cm_cmp_loop');
  a.ldrbReg(R1, R11, R0);
  a.ldrbReg(R2, R12, R0);
  a.cmpReg(R1, R2);
  a.b('cm_lt', 'LO');
  a.b('cm_ge', 'HI');
  a.cmpImm(R1, 0);
  a.b('cm_ge', 'EQ');
  a.addImm(R0, R0, 1);
  a.cmpImm(R0, 16);
  a.b('cm_cmp_loop', 'LO');
  a.b('cm_ge');

  a.label('cm_lt');
  a.addImm(R4, R10, 1);
  a.b('cm_bs_loop');

  a.label('cm_ge');
  a.mov(R6, R10);
  a.b('cm_bs_loop');

  a.label('cm_bs_done');
  a.str(R4, R5, ST_SRCH_MATCH_START);
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SRCH_MATCH_CUR);

  // If len == 0, all dictionary words match from index 0
  a.cmpImm(R9, 0);
  a.b('cm_cnt_nonempty', 'NE');
  a.str(R7, R5, ST_SRCH_MATCH_CNT);
  a.b('cm_done');

  a.label('cm_cnt_nonempty');
  a.mov(R10, R4); // scan index
  a.movImm(R6, 0); // count
  a.label('cm_cnt_loop');
  a.cmpReg(R10, R7);
  a.b('cm_cnt_store', 'HS');
  a.addReg(R0, R10, R10, 0, 1);
  a.lslImm(R0, R0, 3);
  a.addReg(R11, R8, R0);

  a.movImm(R0, 0);
  a.label('cm_pfx_loop');
  a.cmpReg(R0, R9);
  a.b('cm_pfx_hit', 'HS');
  a.ldrbReg(R1, R11, R0);
  a.ldrbReg(R2, R12, R0);
  a.cmpReg(R1, R2);
  a.b('cm_cnt_store', 'NE');
  a.addImm(R0, R0, 1);
  a.b('cm_pfx_loop');

  a.label('cm_pfx_hit');
  a.addImm(R6, R6, 1);
  a.addImm(R10, R10, 1);
  a.b('cm_cnt_loop');

  a.label('cm_cnt_store');
  a.str(R6, R5, ST_SRCH_MATCH_CNT);

  a.label('cm_done');
  a.pop([R4, R5, R6, R7, R8, R9, R10, R11, LR]);
  a.bx(LR);

  // conc_open_results(): enters ST_SRCH_SUB = 1 for active suggestion
  a.label('conc_open_results');
  a.push([R5, LR]);
  a.movImm(R5, STATE_BASE);
  a.ldr(R0, R5, ST_SRCH_MATCH_CNT);
  a.cmpImm(R0, 0);
  a.b('cor_done', 'EQ');
  a.ldr(R1, R5, ST_SRCH_MATCH_START);
  a.ldr(R2, R5, ST_SRCH_MATCH_CUR);
  a.addReg(R1, R1, R2);
  a.str(R1, R5, ST_SRCH_WORD_IDX);
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SRCH_RES_CUR);
  a.str(R0, R5, ST_SRCH_RES_SCR);
  a.movImm(R0, 1);
  a.str(R0, R5, ST_SRCH_SUB);
  a.str(R0, R5, ST_DIRTY);
  a.label('cor_done');
  a.pop([R5, LR]);
  a.bx(LR);

  // handle_conc_keys_fn() expects R4=DATA_HEADER_ADDR, R5=STATE_BASE, R6=newKeys
  a.label('handle_conc_keys_fn');
  a.push([R7, R8, LR]);
  a.ldr(R0, R5, ST_SRCH_SUB);
  a.cmpImm(R0, 0);
  a.b('hc_results_keys', 'NE');

  // --- Sub-mode 0: A-Z Word Picker ---
  a.ldr(R7, R5, ST_SRCH_KCUR);
  a.mov(R0, R7);
  a.movImm(R1, 7);
  a.bl('udivmod'); // R0=row (0..3), R1=col (0..6)

  a.tstImm(R6, KEY_RIGHT);
  a.b('hck_left', 'EQ');
  a.addImm(R1, R1, 1);
  a.cmpImm(R1, 7);
  a.movImm(R1, 0, 'HS');

  a.label('hck_left');
  a.tstImm(R6, KEY_LEFT);
  a.b('hck_down', 'EQ');
  a.cmpImm(R1, 0);
  a.movImm(R1, 6, 'EQ');
  a.subImm(R1, R1, 1, 'NE');

  a.label('hck_down');
  a.tstImm(R6, KEY_DOWN);
  a.b('hck_up', 'EQ');
  a.addImm(R0, R0, 1);
  a.cmpImm(R0, 4);
  a.movImm(R0, 0, 'HS');

  a.label('hck_up');
  a.tstImm(R6, KEY_UP);
  a.b('hck_kstore', 'EQ');
  a.cmpImm(R0, 0);
  a.movImm(R0, 3, 'EQ');
  a.subImm(R0, R0, 1, 'NE');

  a.label('hck_kstore');
  a.movImm(R2, 7);
  a.mul(R7, R0, R2);
  a.addReg(R7, R7, R1);
  a.str(R7, R5, ST_SRCH_KCUR);

  // L / R browse live prefix suggestions
  a.movImm(R0, KEY_R);
  a.tstReg(R6, R0);
  a.b('hck_chk_l', 'EQ');
  a.ldr(R1, R5, ST_SRCH_MATCH_CUR);
  a.ldr(R2, R5, ST_SRCH_MATCH_CNT);
  a.cmpImm(R2, 0);
  a.b('hck_chk_l', 'EQ');
  a.addImm(R1, R1, 1);
  a.cmpReg(R1, R2);
  a.movImm(R1, 0, 'HS');
  a.str(R1, R5, ST_SRCH_MATCH_CUR);

  a.label('hck_chk_l');
  a.movImm(R0, KEY_L);
  a.tstReg(R6, R0);
  a.b('hck_chk_sel', 'EQ');
  a.ldr(R1, R5, ST_SRCH_MATCH_CUR);
  a.ldr(R2, R5, ST_SRCH_MATCH_CNT);
  a.cmpImm(R2, 0);
  a.b('hck_chk_sel', 'EQ');
  a.cmpImm(R1, 0);
  a.subImm(R1, R1, 1, 'NE');
  a.subImm(R1, R2, 1, 'EQ');
  a.str(R1, R5, ST_SRCH_MATCH_CUR);

  // SELECT -> cycle translation in picker
  a.label('hck_chk_sel');
  a.tstImm(R6, KEY_SELECT);
  a.b('hck_chk_start', 'EQ');
  a.ldr(R1, R4, 4); // numTranslations
  a.cmpImm(R1, 1);
  a.b('hck_chk_start', 'LS');
  a.ldr(R0, R5, ST_TRANS);
  a.addImm(R0, R0, 1);
  a.cmpReg(R0, R1);
  a.movImm(R0, 0, 'HS');
  a.bl('switch_translation');
  a.bl('conc_update_matches');

  a.label('hck_chk_start');
  a.tstImm(R6, KEY_START);
  a.b('hck_chk_a', 'EQ');
  a.bl('conc_open_results');
  a.b('hck_done');

  a.label('hck_chk_a');
  a.tstImm(R6, KEY_A);
  a.b('hck_chk_b', 'EQ');
  a.cmpImm(R7, 27);
  a.b('hck_not_ok', 'NE');
  a.bl('conc_open_results');
  a.b('hck_done');

  a.label('hck_not_ok');
  a.cmpImm(R7, 26);
  a.b('hck_add_char', 'NE');
  a.b('hck_do_bs');

  a.label('hck_add_char');
  a.ldr(R0, R5, ST_SRCH_LEN);
  a.cmpImm(R0, 14);
  a.b('hck_done', 'HS');
  a.addImm(R1, R5, ST_SRCH_QUERY);
  a.addImm(R2, R7, 0x61); // lowercase 'a' + kcur
  a.strbReg(R2, R1, R0);
  a.addImm(R0, R0, 1);
  a.movImm(R2, 0);
  a.strbReg(R2, R1, R0);
  a.str(R0, R5, ST_SRCH_LEN);
  a.bl('conc_update_matches');
  a.b('hck_done');

  a.label('hck_chk_b');
  a.tstImm(R6, KEY_B);
  a.b('hck_done', 'EQ');
  a.ldr(R0, R5, ST_SRCH_LEN);
  a.cmpImm(R0, 0);
  a.b('hck_exit_srch', 'EQ');

  a.label('hck_do_bs');
  a.ldr(R0, R5, ST_SRCH_LEN);
  a.cmpImm(R0, 0);
  a.b('hck_done', 'EQ');
  a.subImm(R0, R0, 1);
  a.str(R0, R5, ST_SRCH_LEN);
  a.addImm(R1, R5, ST_SRCH_QUERY);
  a.movImm(R2, 0);
  a.strbReg(R2, R1, R0);
  a.bl('conc_update_matches');
  a.b('hck_done');

  a.label('hck_exit_srch');
  a.ldr(R0, R5, ST_SRCH_RET);
  a.str(R0, R5, ST_MODE);
  a.b('hck_done');

  // --- Sub-mode 1: Verse Results List ---
  a.label('hc_results_keys');
  a.bl('get_cur_trans_ptr');
  a.ldr(R1, R0, TE_CONC_PTR);
  a.ldr(R2, R5, ST_SRCH_WORD_IDX);
  a.addReg(R0, R2, R2, 0, 1);
  a.lslImm(R0, R0, 3);
  a.addReg(R7, R1, R0); // WordEntry*
  a.ldr(R8, R7, 20); // numHits
  a.ldr(R0, R5, ST_SRCH_RES_CUR);

  a.tstImm(R6, KEY_DOWN);
  a.b('hcr_up', 'EQ');
  a.addImm(R0, R0, 1);
  a.cmpReg(R0, R8);
  a.movImm(R0, 0, 'HS');

  a.label('hcr_up');
  a.tstImm(R6, KEY_UP);
  a.b('hcr_right', 'EQ');
  a.cmpImm(R0, 0);
  a.subImm(R0, R0, 1, 'NE');
  a.subImm(R0, R8, 1, 'EQ');

  a.label('hcr_right');
  a.tstImm(R6, KEY_RIGHT);
  a.b('hcr_left', 'EQ');
  a.addImm(R0, R0, 5);
  a.subImm(R1, R8, 1);
  a.cmpReg(R0, R1);
  a.mov(R0, R1, 'HI');

  a.label('hcr_left');
  a.tstImm(R6, KEY_LEFT);
  a.b('hcr_r', 'EQ');
  a.cmpImm(R0, 5);
  a.movImm(R0, 0, 'LO');
  a.subImm(R0, R0, 5, 'HS');

  a.label('hcr_r');
  a.movImm(R1, KEY_R);
  a.tstReg(R6, R1);
  a.b('hcr_l', 'EQ');
  a.addImm(R0, R0, 25);
  a.subImm(R1, R8, 1);
  a.cmpReg(R0, R1);
  a.mov(R0, R1, 'HI');

  a.label('hcr_l');
  a.movImm(R1, KEY_L);
  a.tstReg(R6, R1);
  a.b('hcr_store_cur', 'EQ');
  a.cmpImm(R0, 25);
  a.movImm(R0, 0, 'LO');
  a.subImm(R0, R0, 25, 'HS');

  a.label('hcr_store_cur');
  a.str(R0, R5, ST_SRCH_RES_CUR);
  a.ldr(R1, R5, ST_SRCH_RES_SCR);
  a.cmpReg(R0, R1);
  a.mov(R1, R0, 'LO');
  a.addImm(R2, R1, 4);
  a.cmpReg(R0, R2);
  a.subImm(R1, R0, 4, 'HI');
  a.str(R1, R5, ST_SRCH_RES_SCR);

  // SELECT in Results -> switch translation & search same word there
  a.tstImm(R6, KEY_SELECT);
  a.b('hcr_chk_a', 'EQ');
  a.ldr(R1, R4, 4);
  a.cmpImm(R1, 1);
  a.b('hcr_chk_a', 'LS');
  // Copy selected word into ST_SRCH_QUERY & ST_SRCH_LEN
  a.addImm(R1, R5, ST_SRCH_QUERY);
  a.movImm(R2, 0);
  a.label('hcr_cp_w');
  a.ldrbReg(R3, R7, R2);
  a.strbReg(R3, R1, R2);
  a.cmpImm(R3, 0);
  a.b('hcr_cp_done', 'EQ');
  a.addImm(R2, R2, 1);
  a.cmpImm(R2, 15);
  a.b('hcr_cp_w', 'LO');
  a.movImm(R3, 0);
  a.strbReg(R3, R1, R2);
  a.label('hcr_cp_done');
  a.str(R2, R5, ST_SRCH_LEN);

  a.ldr(R0, R5, ST_TRANS);
  a.addImm(R0, R0, 1);
  a.ldr(R1, R4, 4);
  a.cmpReg(R0, R1);
  a.movImm(R0, 0, 'HS');
  a.bl('switch_translation');
  a.bl('conc_update_matches');
  a.ldr(R0, R5, ST_SRCH_MATCH_CNT);
  a.cmpImm(R0, 0);
  a.b('hcr_back_picker', 'EQ');
  a.bl('conc_open_results');
  a.b('hck_done');

  // A or START -> Jump to selected verse in Reader!
  a.label('hcr_chk_a');
  a.tstImm(R6, KEY_A | KEY_START);
  a.b('hcr_chk_b', 'EQ');
  a.ldr(R1, R7, 16); // hitsPtr (uint16 globalVerseIdx[])
  a.ldr(R0, R5, ST_SRCH_RES_CUR);
  a.lslImm(R0, R0, 1);
  a.addReg(R1, R1, R0);
  a.ldrh(R8, R1, 0); // save globalVerseIdx in R8
  a.bl('get_cur_trans_ptr');
  a.mov(R1, R0); // transPtr
  a.mov(R0, R8); // globalVerseIdx
  a.bl('decode_global_verse'); // -> R0=bookIdx, R1=chapIdx, R2=verseNum
  a.str(R0, R5, ST_BOOK);
  a.str(R1, R5, ST_CHAP);
  a.mov(R8, R2); // verseNum
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SCROLL);
  a.str(R0, R5, ST_MODE);
  a.bl('build_line_table');
  a.mov(R0, R8);
  a.bl('scroll_to_verse');
  a.bl('mark_dirty_save');
  a.b('hck_done');

  a.label('hcr_chk_b');
  a.tstImm(R6, KEY_B);
  a.b('hck_done', 'EQ');
  a.label('hcr_back_picker');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_SRCH_SUB);

  a.label('hck_done');
  a.movImm(R0, 1);
  a.str(R0, R5, ST_DIRTY);
  a.pop([R7, R8, LR]);
  a.bx(LR);
  a.flushLiterals();

  // =========================================================================
  // HELPER: mark_dirty_save
  // =========================================================================
  a.label('mark_dirty_save');
  a.push([LR]);
  a.movImm(R0, STATE_BASE);
  a.movImm(R1, 1);
  a.str(R1, R0, ST_DIRTY);
  a.bl('sram_save');
  a.pop([LR]);
  a.bx(LR);

  // =========================================================================
  // NEXT / PREV CHAPTER
  // =========================================================================
  a.label('next_chapter');
  a.push([R4, R5, LR]);
  a.bl('get_cur_trans_ptr');
  a.mov(R4, R0); // transEntryPtr
  a.movImm(R5, STATE_BASE);
  a.ldr(R0, R5, ST_BOOK);
  a.ldr(R1, R5, ST_CHAP);
  a.ldr(R2, R4, TE_BOOK_PTR);
  a.lslImm(R3, R0, 5);
  a.addReg(R2, R2, R3);
  a.ldrh(R3, R2, 24); // numChapters
  a.addImm(R1, R1, 1);
  a.cmpReg(R1, R3);
  a.b('nc_store', 'LO');
  // Advance book
  a.addImm(R0, R0, 1);
  a.ldrh(R3, R4, TE_NUM_BOOKS);
  a.cmpReg(R0, R3);
  a.movImm(R0, 0, 'HS');
  a.movImm(R1, 0);
  a.label('nc_store');
  a.str(R0, R5, ST_BOOK);
  a.str(R1, R5, ST_CHAP);
  a.movImm(R2, 0);
  a.str(R2, R5, ST_SCROLL);
  a.bl('build_line_table');
  a.bl('mark_dirty_save');
  a.pop([R4, R5, LR]);
  a.bx(LR);

  a.label('prev_chapter');
  a.push([R4, R5, LR]);
  a.bl('get_cur_trans_ptr');
  a.mov(R4, R0); // transEntryPtr
  a.movImm(R5, STATE_BASE);
  a.ldr(R0, R5, ST_BOOK);
  a.ldr(R1, R5, ST_CHAP);
  a.cmpImm(R1, 0);
  a.b('pc_dec_chap', 'NE');
  a.cmpImm(R0, 0);
  a.b('pc_wrap_book', 'NE');
  a.ldrh(R0, R4, TE_NUM_BOOKS);
  a.label('pc_wrap_book');
  a.subImm(R0, R0, 1);
  a.ldr(R2, R4, TE_BOOK_PTR);
  a.lslImm(R3, R0, 5);
  a.addReg(R2, R2, R3);
  a.ldrh(R1, R2, 24); // numChapters
  a.label('pc_dec_chap');
  a.subImm(R1, R1, 1);
  a.str(R0, R5, ST_BOOK);
  a.str(R1, R5, ST_CHAP);
  a.movImm(R2, 0);
  a.str(R2, R5, ST_SCROLL);
  a.bl('build_line_table');
  a.bl('mark_dirty_save');
  a.pop([R4, R5, LR]);
  a.bx(LR);

  // =========================================================================
  // APPLY PALETTE (copy active theme's 8 BGR555 colors into 0x05000000)
  // =========================================================================
  a.label('apply_palette');
  a.movImm(R0, STATE_BASE);
  a.ldr(R1, R0, ST_THEME);
  a.andImm(R1, R1, 3);
  a.ldrLabelAddr(R2, 'palette_table');
  a.lslImm(R1, R1, 4); // 8 colors * 2 bytes = 16 bytes per theme
  a.addReg(R2, R2, R1);
  a.movImm(R3, PALETTE_RAM);
  a.movImm(R12, 8);
  a.label('pal_loop');
  a.ldrh(R0, R2, 0);
  a.strh(R0, R3, 0);
  a.addImm(R2, R2, 2);
  a.addImm(R3, R3, 2);
  a.subImm(R12, R12, 1, 'AL', true);
  a.b('pal_loop', 'NE');
  a.bx(LR);

  // =========================================================================
  // SRAM LOAD & SAVE (8-bit LDRB/STRB strictly for real GBA cartridge SRAM!)
  // Layout v4 ("ERD4", 23 bytes global header + per-volume 8B slots at +32):
  //   [0..3]="ERD4", [4..5]=book, [6..7]=chap, [8..9]=scroll,
  //   [10]=theme, [11]=hasBM, [12..13]=bmBook, [14..15]=bmChap, [16..17]=bmLine,
  //   [18]=curVol, [19]=bmVol, [20]=flags (bit0=vLayout, bit1=density), [21]=0, [22]=addChk
  // Per-volume slots at SRAM_BASE + 32 + volIdx * 8 (up to 32 volumes):
  //   [0..1]=book, [2..3]=chap, [4..5]=scroll, [6]=0xA7, [7]=addChk(0x5A + sum[0..6])
  // =========================================================================
  a.label('sram_load');
  a.push([R4, R5, R6, LR]);
  a.movImm(R4, DATA_HEADER_ADDR);
  a.movImm(R5, STATE_BASE);
  a.movImm(R0, SRAM_BASE);

  // Check magic "ERD4"
  a.ldrb(R1, R0, 0);
  a.cmpImm(R1, 0x45);
  a.b('sram_load_fail', 'NE');
  a.ldrb(R1, R0, 1);
  a.cmpImm(R1, 0x52);
  a.b('sram_load_fail', 'NE');
  a.ldrb(R1, R0, 2);
  a.cmpImm(R1, 0x44);
  a.b('sram_load_fail', 'NE');
  a.ldrb(R1, R0, 3);
  a.cmpImm(R1, 0x34);
  a.b('sram_load_fail', 'NE');

  // Verify ADD checksum + 0x5A over bytes 0..21
  a.movImm(R1, 0x5a);
  a.movImm(R2, 0);
  a.label('sl_chk_loop');
  a.ldrb(R3, R0, 0);
  a.addReg(R1, R1, R3);
  a.addImm(R0, R0, 1);
  a.addImm(R2, R2, 1);
  a.cmpImm(R2, 22);
  a.b('sl_chk_loop', 'LO');
  a.andImm(R1, R1, 0xff);
  a.ldrb(R3, R0, 0); // byte 22
  a.cmpReg(R1, R3);
  a.b('sram_load_fail', 'NE');

  // Validate curVol < numTranslations
  a.movImm(R0, SRAM_BASE);
  a.ldrb(R1, R0, 18);
  a.ldr(R3, R4, 4); // numTranslations
  a.cmpReg(R1, R3);
  a.b('sram_load_fail', 'HS');
  a.str(R1, R5, ST_TRANS);

  // Look up translation entry into R6
  a.mov(R0, R1);
  a.bl('get_trans_ptr');
  a.mov(R6, R0);

  // Validate book < trans.numBooks
  a.movImm(R0, SRAM_BASE);
  a.ldrb(R1, R0, 4);
  a.ldrb(R2, R0, 5);
  a.orrReg(R1, R1, R2, 0, 8);
  a.ldrh(R3, R6, TE_NUM_BOOKS);
  a.cmpReg(R1, R3);
  a.b('sram_load_fail', 'HS');
  a.str(R1, R5, ST_BOOK);

  // Validate chap < book.numChapters
  a.ldr(R2, R6, TE_BOOK_PTR);
  a.lslImm(R3, R1, 5);
  a.addReg(R2, R2, R3);
  a.ldrh(R3, R2, 24);
  a.ldrb(R1, R0, 6);
  a.ldrb(R2, R0, 7);
  a.orrReg(R1, R1, R2, 0, 8);
  a.cmpReg(R1, R3);
  a.b('sram_load_fail', 'HS');
  a.str(R1, R5, ST_CHAP);

  a.ldrb(R1, R0, 8);
  a.ldrb(R2, R0, 9);
  a.orrReg(R1, R1, R2, 0, 8);
  a.str(R1, R5, ST_SCROLL);

  a.ldrb(R1, R0, 10);
  a.andImm(R1, R1, 3);
  a.str(R1, R5, ST_THEME);

  a.ldrb(R1, R0, 11);
  a.andImm(R1, R1, 1);
  a.str(R1, R5, ST_HAS_BM);

  a.ldrb(R1, R0, 12);
  a.ldrb(R2, R0, 13);
  a.orrReg(R1, R1, R2, 0, 8);
  a.str(R1, R5, ST_BM_BOOK);

  a.ldrb(R1, R0, 14);
  a.ldrb(R2, R0, 15);
  a.orrReg(R1, R1, R2, 0, 8);
  a.str(R1, R5, ST_BM_CHAP);

  a.ldrb(R1, R0, 16);
  a.ldrb(R2, R0, 17);
  a.orrReg(R1, R1, R2, 0, 8);
  a.str(R1, R5, ST_BM_LINE);

  a.ldrb(R1, R0, 19);
  a.ldr(R3, R4, 4); // clamp bmTrans < numTranslations
  a.cmpReg(R1, R3);
  a.movImm(R1, 0, 'HS');
  a.str(R1, R5, ST_BM_TRANS);

  // Restore byte 20 flags: bit 0 = vLayout, bit 1 = density (0=14/9, 1=16/8)
  a.ldrb(R1, R0, 20);
  a.andImm(R2, R1, 1);
  a.str(R2, R5, ST_V_LAYOUT);
  a.lsrImm(R2, R1, 1);
  a.andImm(R2, R2, 1);
  a.str(R2, R5, ST_DENSITY);
  a.cmpImm(R2, 0);
  a.movImm(R2, 14, 'EQ');
  a.movImm(R3, 9, 'EQ');
  a.movImm(R2, 16, 'NE');
  a.movImm(R3, 8, 'NE');
  a.str(R2, R5, ST_LINES_PP);
  a.str(R3, R5, ST_LINE_H);
  a.b('sram_load_done');

  a.label('sram_load_fail');
  a.movImm(R0, 0);
  a.str(R0, R5, ST_TRANS);
  a.str(R0, R5, ST_BOOK);
  a.str(R0, R5, ST_CHAP);
  a.str(R0, R5, ST_SCROLL);

  a.label('sram_load_done');
  a.pop([R4, R5, R6, LR]);
  a.bx(LR);

  a.label('sram_save');
  a.push([R4, R5, LR]);
  a.movImm(R5, STATE_BASE);
  a.movImm(R0, SRAM_BASE);

  a.movImm(R1, 0x45); // 'E'
  a.strb(R1, R0, 0);
  a.movImm(R1, 0x52); // 'R'
  a.strb(R1, R0, 1);
  a.movImm(R1, 0x44); // 'D'
  a.strb(R1, R0, 2);
  a.movImm(R1, 0x34); // '4'
  a.strb(R1, R0, 3);

  a.ldr(R1, R5, ST_BOOK);
  a.strb(R1, R0, 4);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 5);

  a.ldr(R1, R5, ST_CHAP);
  a.strb(R1, R0, 6);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 7);

  a.ldr(R1, R5, ST_SCROLL);
  a.strb(R1, R0, 8);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 9);

  a.ldr(R1, R5, ST_THEME);
  a.strb(R1, R0, 10);

  a.ldr(R1, R5, ST_HAS_BM);
  a.strb(R1, R0, 11);

  a.ldr(R1, R5, ST_BM_BOOK);
  a.strb(R1, R0, 12);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 13);

  a.ldr(R1, R5, ST_BM_CHAP);
  a.strb(R1, R0, 14);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 15);

  a.ldr(R1, R5, ST_BM_LINE);
  a.strb(R1, R0, 16);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 17);

  a.ldr(R1, R5, ST_TRANS);
  a.strb(R1, R0, 18);

  a.ldr(R1, R5, ST_BM_TRANS);
  a.strb(R1, R0, 19);

  // Byte 20: bit 0 = ST_V_LAYOUT, bit 1 = ST_DENSITY
  a.ldr(R1, R5, ST_V_LAYOUT);
  a.andImm(R1, R1, 1);
  a.ldr(R2, R5, ST_DENSITY);
  a.andImm(R2, R2, 1);
  a.orrReg(R1, R1, R2, 0, 1);
  a.strb(R1, R0, 20);

  a.movImm(R1, 0);
  a.strb(R1, R0, 21);

  // Compute ADD checksum + 0x5A over bytes 0..21
  a.movImm(R1, 0x5a);
  a.movImm(R2, 0);
  a.label('ss_chk_loop');
  a.ldrb(R3, R0, 0);
  a.addReg(R1, R1, R3);
  a.addImm(R0, R0, 1);
  a.addImm(R2, R2, 1);
  a.cmpImm(R2, 22);
  a.b('ss_chk_loop', 'LO');
  a.strb(R1, R0, 0);

  // Write per-volume 8-byte progress slot at SRAM_BASE + 32 + (ST_TRANS << 3)
  a.ldr(R4, R5, ST_TRANS);
  a.cmpImm(R4, 32);
  a.b('ss_done', 'HS');
  a.movImm(R0, SRAM_BASE);
  a.addImm(R0, R0, 32);
  a.lslImm(R1, R4, 3);
  a.addReg(R0, R0, R1);

  a.ldr(R1, R5, ST_BOOK);
  a.strb(R1, R0, 0);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 1);

  a.ldr(R1, R5, ST_CHAP);
  a.strb(R1, R0, 2);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 3);

  a.ldr(R1, R5, ST_SCROLL);
  a.strb(R1, R0, 4);
  a.lsrImm(R1, R1, 8);
  a.strb(R1, R0, 5);

  a.movImm(R1, 0xa7);
  a.strb(R1, R0, 6);

  a.movImm(R1, 0x5a);
  a.movImm(R2, 0);
  a.label('ss_slot_chk');
  a.ldrbReg(R3, R0, R2);
  a.addReg(R1, R1, R3);
  a.addImm(R2, R2, 1);
  a.cmpImm(R2, 7);
  a.b('ss_slot_chk', 'LO');
  a.strb(R1, R0, 7);

  a.label('ss_done');
  a.pop([R4, R5, LR]);
  a.bx(LR);

  // sram_has_vol_progress(R0 = volIdx) -> R0 = 1 if non-zero saved slot exists, else 0
  a.label('sram_has_vol_progress');
  a.cmpImm(R0, 32);
  a.movImm(R0, 0, 'HS');
  a.bx(LR, 'HS');
  a.lslImm(R1, R0, 3);
  a.movImm(R0, SRAM_BASE);
  a.addImm(R0, R0, 32);
  a.addReg(R0, R0, R1);
  a.ldrb(R1, R0, 6);
  a.cmpImm(R1, 0xa7);
  a.movImm(R0, 0, 'NE');
  a.bx(LR, 'NE');
  a.movImm(R1, 0x5a);
  a.movImm(R2, 0);
  a.label('shvp_chk');
  a.ldrbReg(R3, R0, R2);
  a.addReg(R1, R1, R3);
  a.addImm(R2, R2, 1);
  a.cmpImm(R2, 7);
  a.b('shvp_chk', 'LO');
  a.andImm(R1, R1, 0xff);
  a.ldrb(R3, R0, 7);
  a.cmpReg(R1, R3);
  a.movImm(R0, 0, 'NE');
  a.bx(LR, 'NE');
  // Check if (book|chap|scroll) > 0
  a.ldrb(R1, R0, 0);
  a.ldrb(R2, R0, 1);
  a.orrReg(R1, R1, R2);
  a.ldrb(R2, R0, 2);
  a.orrReg(R1, R1, R2);
  a.ldrb(R2, R0, 3);
  a.orrReg(R1, R1, R2);
  a.ldrb(R2, R0, 4);
  a.orrReg(R1, R1, R2);
  a.ldrb(R2, R0, 5);
  a.orrReg(R1, R1, R2);
  a.cmpImm(R1, 0);
  a.movImm(R0, 1, 'NE');
  a.movImm(R0, 0, 'EQ');
  a.bx(LR);

  // =========================================================================
  // BPE CHAPTER DECOMPRESSION (0x88..0xFF -> recursive pair expansion via DTE_TABLE)
  // =========================================================================
  // emit_bpe_byte(R0 = byte, R7 = outPtr [updated], R8 = dteTable)
  a.label('emit_bpe_byte');
  a.cmpImm(R0, 0x88);
  a.b('ebb_expand', 'HS');
  a.strb(R0, R7, 0);
  a.addImm(R7, R7, 1);
  a.bx(LR);
  a.label('ebb_expand');
  a.push([R4, LR]);
  a.subImm(R0, R0, 0x88);
  a.lslImm(R0, R0, 1);
  a.addReg(R1, R8, R0);
  a.ldrb(R4, R1, 1); // right byte
  a.ldrb(R0, R1, 0); // left byte
  a.bl('emit_bpe_byte');
  a.mov(R0, R4);
  a.bl('emit_bpe_byte');
  a.pop([R4, LR]);
  a.bx(LR);

  // decompress_chapter(R0=romPtr, R1=byteLen, R2=outBuf) -> R0=decompressedLen
  a.label('decompress_chapter');
  a.push([R4, R5, R6, R7, R8, LR]);
  a.mov(R4, R0);
  a.addReg(R5, R0, R1); // endPtr
  a.mov(R6, R2); // startOut
  a.mov(R7, R2); // writeOut
  a.movImm(R8, DTE_TABLE_ADDR);
  a.label('dc_bpe_loop');
  a.cmpReg(R4, R5);
  a.b('dc_bpe_done', 'HS');
  a.ldrb(R0, R4, 0);
  a.addImm(R4, R4, 1);
  a.bl('emit_bpe_byte');
  a.b('dc_bpe_loop');
  a.label('dc_bpe_done');
  a.subReg(R0, R7, R6);
  a.pop([R4, R5, R6, R7, R8, LR]);
  a.bx(LR);

  // =========================================================================
  // BUILD LINE TABLE FOR CURRENT TRANSLATION + BOOK + CHAPTER
  // Populates LINE_TABLE_BASE (0x02000000): 8 bytes per line { ptr(4), len(2), flags(2) }
  // =========================================================================
  a.label('build_line_table');
  a.push([R4, R5, R6, R7, R8, R9, R10, R11, LR]);
  a.bl('get_cur_trans_ptr');
  a.mov(R4, R0); // transEntryPtr
  a.movImm(R5, STATE_BASE);

  // Lookup chapter ROM ptr & len, decompress into READER_CHAP_BUF
  a.ldr(R0, R5, ST_BOOK);
  a.ldr(R1, R4, TE_BOOK_PTR);
  a.lslImm(R2, R0, 5);
  a.addReg(R1, R1, R2);
  a.ldrh(R2, R1, 26); // firstChapterIdx
  a.ldr(R3, R5, ST_CHAP);
  a.addReg(R2, R2, R3); // globalChapIdx

  a.ldr(R1, R4, TE_CHAP_PTR);
  a.lslImm(R2, R2, 3); // * 8
  a.addReg(R1, R1, R2);
  a.ldr(R0, R1, 0); // romPtr
  a.ldr(R1, R1, 4); // compressedLen
  a.movImm(R2, READER_CHAP_BUF);
  a.bl('decompress_chapter');
  a.movImm(R4, READER_CHAP_BUF); // R4 = curPtr
  a.addReg(R5, R4, R0); // R5 = endPtr

  a.movImm(R6, LINE_TABLE_BASE);
  a.movImm(R7, 0); // R7 = lineCount
  a.movImm(R0, DATA_HEADER_ADDR);
  a.ldr(R8, R0, 20); // R8 = colsPerLine

  a.label('blt_line_loop');
  a.cmpReg(R4, R5);
  a.b('blt_done', 'HS');

  // Skip leading spaces at start of line
  a.label('blt_skip_lead_sp');
  a.cmpReg(R4, R5);
  a.b('blt_done', 'HS');
  a.ldrb(R0, R4, 0);
  a.cmpImm(R0, 0x20);
  a.b('blt_lead_done', 'NE');
  a.addImm(R4, R4, 1);
  a.b('blt_skip_lead_sp');
  a.label('blt_lead_done');

  // R9 = scanPtr, R10 = col, R11 = lastSpacePtr, R12 = lineEndPtr
  a.mov(R9, R4);
  a.movImm(R10, 0);
  a.movImm(R11, 0);
  a.mov(R12, R5);

  a.label('blt_scan_loop');
  a.cmpReg(R9, R5);
  a.b('blt_eof_line', 'HS');
  a.ldrb(R0, R9, 0);
  a.addImm(R9, R9, 1);

  // Explicit newline 0x0A, Bible verse sep 0x03, or spacious paragraph spacer 0x0B
  a.cmpImm(R0, 0x0a);
  a.b('blt_do_nl', 'EQ');
  a.cmpImm(R0, 0x0b);
  a.b('blt_chk_vsep', 'NE');
  a.movImm(R1, STATE_BASE);
  a.ldr(R2, R1, ST_V_LAYOUT);
  a.cmpImm(R2, 0);
  a.b('blt_do_nl', 'EQ'); // Spacious mode: 0x0B emits a blank separator line
  a.b('blt_scan_loop'); // Compact mode: ignore 0x0B

  a.label('blt_chk_vsep');
  a.cmpImm(R0, 0x03);
  a.b('blt_not_nl', 'NE');
  a.movImm(R1, STATE_BASE);
  a.ldr(R2, R1, ST_V_LAYOUT);
  a.cmpImm(R2, 0);
  a.b('blt_vsep_space', 'EQ');

  a.label('blt_do_nl');
  a.subImm(R12, R9, 1);
  a.mov(R1, R9);
  a.b('blt_emit_line');

  a.label('blt_vsep_space');
  a.mov(R11, R9);
  a.b('blt_adv_col');

  a.label('blt_not_nl');
  // Accent markers 0x01 / 0x02 and invisible unit anchors 0x04..0x05 consume zero visual columns
  a.cmpImm(R0, 0x01);
  a.b('blt_scan_loop', 'EQ');
  a.cmpImm(R0, 0x02);
  a.b('blt_scan_loop', 'EQ');
  a.cmpImm(R0, 0x05);
  a.b('blt_scan_loop', 'EQ');
  a.cmpImm(R0, 0x04);
  a.b('blt_not_anchor', 'NE');
  a.label('blt_skip_anchor');
  a.cmpReg(R9, R5);
  a.b('blt_eof_line', 'HS');
  a.ldrb(R0, R9, 0);
  a.addImm(R9, R9, 1);
  a.cmpImm(R0, 0x05);
  a.b('blt_skip_anchor', 'NE');
  a.b('blt_scan_loop');

  a.label('blt_not_anchor');
  // Space 0x20: record possible wrap point
  a.cmpImm(R0, 0x20);
  a.mov(R11, R9, 'EQ');

  a.label('blt_adv_col');
  a.addImm(R10, R10, 1);
  a.cmpReg(R10, R8);
  a.b('blt_scan_loop', 'LS');

  // Exceeded colsPerLine
  a.cmpImm(R11, 0);
  a.b('blt_hard_break', 'EQ');
  a.subImm(R12, R11, 1);
  a.mov(R1, R11);
  a.b('blt_emit_line');

  a.label('blt_hard_break');
  a.subImm(R12, R9, 1);
  a.mov(R1, R12);
  a.b('blt_emit_line');

  a.label('blt_eof_line');
  a.mov(R12, R5);
  a.mov(R1, R5);

  a.label('blt_emit_line');
  a.subReg(R2, R12, R4); // byteLen
  a.str(R4, R6, 0);
  a.strh(R2, R6, 4);
  a.movImm(R3, 0);
  a.strh(R3, R6, 6);
  a.addImm(R6, R6, 8);
  a.addImm(R7, R7, 1);
  a.mov(R4, R1);

  a.movImm(R0, 16000);
  a.cmpReg(R7, R0);
  a.b('blt_line_loop', 'LO');

  a.label('blt_done');
  a.movImm(R5, STATE_BASE);
  a.str(R7, R5, ST_NUMLINES);

  a.ldr(R1, R5, ST_LINES_PP);
  a.ldr(R2, R5, ST_SCROLL);
  a.cmpReg(R7, R1);
  a.b('blt_zero_scroll', 'LS');
  a.subReg(R3, R7, R1);
  a.cmpReg(R2, R3);
  a.mov(R2, R3, 'HI');
  a.str(R2, R5, ST_SCROLL);
  a.b('blt_exit');
  a.label('blt_zero_scroll');
  a.movImm(R2, 0);
  a.str(R2, R5, ST_SCROLL);

  a.label('blt_exit');
  a.pop([R4, R5, R6, R7, R8, R9, R10, R11, LR]);
  a.bx(LR);

  // =========================================================================
  // UDIVMOD: R0 = dividend, R1 = divisor -> R0 = quotient, R1 = remainder
  // =========================================================================
  a.label('udivmod');
  a.cmpImm(R1, 0);
  a.b('udiv_zero', 'EQ');
  a.movImm(R2, 0);
  a.movImm(R3, 0);
  a.movImm(R12, 32);
  a.label('udiv_loop');
  a.lslImm(R3, R3, 1);
  a.cmpImm(R0, 0);
  a.orrImm(R3, R3, 1, 'MI');
  a.lslImm(R0, R0, 1);
  a.lslImm(R2, R2, 1);
  a.cmpReg(R3, R1);
  a.b('udiv_skip_sub', 'LO');
  a.subReg(R3, R3, R1);
  a.orrImm(R2, R2, 1);
  a.label('udiv_skip_sub');
  a.subImm(R12, R12, 1, 'AL', true);
  a.b('udiv_loop', 'NE');
  a.mov(R0, R2);
  a.mov(R1, R3);
  a.bx(LR);
  a.label('udiv_zero');
  a.movImm(R0, 0);
  a.movImm(R1, 0);
  a.bx(LR);
  a.flushLiterals();

  // =========================================================================
  // RENDER SCREEN (draws to backBuf in Mode 4, then flips DISPCNT bit 4)
  // =========================================================================
  a.label('render_screen');
  a.push([R4, R5, R6, R7, R8, R9, R10, R11, LR]);
  a.movImm(R5, STATE_BASE);
  a.ldr(R0, R5, ST_BACKBUF);
  a.cmpImm(R0, 0);
  a.movImm(R11, VRAM_PAGE0, 'EQ');
  a.movImm(R11, VRAM_PAGE1, 'NE'); // R11 = active backbuffer VRAM base!

  // Clear entire 240x160 buffer to color 0 (bg)
  a.mov(R0, R11);
  a.movImm(R1, 0);
  a.movImm(R2, (240 * 160) / 4);
  a.label('clr_loop');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('clr_loop', 'NE');

  // Draw Header Bar (y = 0..12, color 4) & 1px divider (y = 13, color 5)
  a.mov(R0, R11);
  a.movImm(R1, 0x04040404);
  a.movImm(R2, (240 * 13) / 4);
  a.label('hdr_fill');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('hdr_fill', 'NE');

  a.movImm(R1, 0x05050505);
  a.movImm(R2, 240 / 4);
  a.label('hdr_div');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('hdr_div', 'NE');

  // Draw Footer Bar (y = 148..159, color 4) & 1px divider (y = 147, color 5)
  a.movImm(R0, 240 * 147);
  a.addReg(R0, R11, R0);
  a.movImm(R1, 0x05050505);
  a.movImm(R2, 240 / 4);
  a.label('ftr_div');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('ftr_div', 'NE');

  a.movImm(R1, 0x04040404);
  a.movImm(R2, (240 * 12) / 4);
  a.label('ftr_fill');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('ftr_fill', 'NE');

  // Dispatch screen render by mode
  a.ldr(R0, R5, ST_MODE);
  a.cmpImm(R0, 0);
  a.b('draw_reader_mode', 'EQ');
  a.cmpImm(R0, 1);
  a.b('draw_books_mode', 'EQ');
  a.cmpImm(R0, 2);
  a.b('draw_chaps_mode', 'EQ');
  a.cmpImm(R0, 3);
  a.b('draw_main_mode', 'EQ');
  a.b('draw_conc_mode');

  // =========================================================================
  // DRAW READER MODE (mode = 0)
  // =========================================================================
  a.label('draw_reader_mode');
  a.movImm(R4, DATA_HEADER_ADDR);
  a.bl('get_cur_trans_ptr');
  a.mov(R7, R0); // transEntryPtr

  // Draw active Volume Code badge (e.g. "MEDIT" or "ESV") at (6, 3), fg=3, bg=4
  a.movImm(R0, 6);
  a.movImm(R1, 3);
  a.addImm(R2, R7, TE_CODE);
  a.movImm(R3, (3 << 8) | 4);
  a.bl('draw_cstr');
  a.addImm(R0, R0, 6); // space after code (even)
  a.mov(R8, R0);

  a.ldrh(R0, R7, TE_NUM_BOOKS);
  a.cmpImm(R0, 1);
  a.b('dr_single_book_hdr', 'LS');

  // Multi-book volume: Draw Book Name + Chapter Number
  a.ldr(R0, R5, ST_BOOK);
  a.ldr(R1, R7, TE_BOOK_PTR);
  a.lslImm(R2, R0, 5);
  a.addReg(R6, R1, R2); // R6 = book entry ptr

  a.mov(R0, R8);
  a.movImm(R1, 3);
  a.mov(R2, R6);
  a.movImm(R3, (1 << 8) | 4);
  a.bl('draw_cstr');
  a.addImm(R0, R0, 6);
  a.b('dr_hdr_chnum');

  // Single-book volume: Draw "Ch <N>" cleanly without repeating title
  a.label('dr_single_book_hdr');
  a.mov(R0, R8);
  a.movImm(R1, 3);
  a.ldrLabelAddr(R2, 'str_ch_hdr_lbl');
  a.movImm(R3, (1 << 8) | 4);
  a.bl('draw_cstr');

  a.label('dr_hdr_chnum');
  a.mov(R7, R0);
  a.ldr(R0, R5, ST_CHAP);
  a.addImm(R2, R0, 1);
  a.mov(R0, R7);
  a.movImm(R1, 3);
  a.movImm(R3, (3 << 8) | 4);
  a.bl('draw_uint');

  // Compute current page & total pages for right-side indicator "p/total"
  a.ldr(R7, R5, ST_LINES_PP);
  a.subImm(R8, R7, 1); // pageStep = linesPerPage - 1
  a.ldr(R0, R5, ST_SCROLL);
  a.mov(R1, R8);
  a.bl('udivmod');
  a.addImm(R9, R0, 1); // curPage (1-based)

  a.ldr(R0, R5, ST_NUMLINES);
  a.cmpReg(R0, R7);
  a.b('dr_one_page', 'LS');
  a.subReg(R0, R0, R7);
  a.addReg(R0, R0, R8);
  a.subImm(R0, R0, 1);
  a.mov(R1, R8);
  a.bl('udivmod');
  a.addImm(R10, R0, 1); // totalPages
  a.b('dr_draw_pg');
  a.label('dr_one_page');
  a.movImm(R10, 1);

  a.label('dr_draw_pg');
  a.movImm(R0, 192);
  a.movImm(R1, 3);
  a.mov(R2, R9);
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_uint');
  a.movImm(R1, 3);
  a.movImm(R2, 0x2f); // '/'
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_char');
  a.movImm(R1, 3);
  a.mov(R2, R10);
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_uint');

  // Draw scripture lines starting at scrollLine
  a.ldr(R6, R5, ST_SCROLL);
  a.ldr(R7, R5, ST_LINES_PP);
  a.ldr(R8, R5, ST_LINE_H);
  a.movImm(R9, 17); // yPos

  a.label('dr_line_loop');
  a.cmpImm(R7, 0);
  a.b('dr_lines_done', 'EQ');
  a.ldr(R0, R5, ST_NUMLINES);
  a.cmpReg(R6, R0);
  a.b('dr_lines_done', 'HS');

  a.movImm(R0, LINE_TABLE_BASE);
  a.lslImm(R1, R6, 3);
  a.addReg(R10, R0, R1);
  a.ldr(R2, R10, 0); // ptr
  a.ldrh(R3, R10, 4); // byteLen

  a.push([R6, R7, R8, R9]);
  a.ldr(R0, R4, 36); // xStart (even!)
  a.mov(R1, R9);
  a.bl('draw_scripture_line');
  a.pop([R6, R7, R8, R9]);

  a.addReg(R9, R9, R8);
  a.addImm(R6, R6, 1);
  a.subImm(R7, R7, 1);
  a.b('dr_line_loop');

  a.label('dr_lines_done');
  a.ldr(R0, R5, ST_TOAST);
  a.cmpImm(R0, 0);
  a.b('dr_normal_ftr', 'EQ');
  a.movImm(R0, 6);
  a.movImm(R1, 150);
  a.ldr(R2, R5, ST_TOAST_PTR);
  a.movImm(R3, (3 << 8) | 4);
  a.bl('draw_cstr');
  a.b('flip_buffer');

  a.label('dr_normal_ftr');
  a.movImm(R0, 6);
  a.movImm(R1, 150);
  a.ldrLabelAddr(R2, 'str_reader_ftr');
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_cstr');
  a.b('flip_buffer');

  // =========================================================================
  // DRAW BOOKS INDEX MODE (mode = 1)
  // =========================================================================
  a.label('draw_books_mode');
  a.bl('get_cur_trans_ptr');
  a.mov(R4, R0); // R4 = active transEntryPtr

  a.movImm(R0, 6);
  a.movImm(R1, 3);
  a.addImm(R2, R4, TE_CODE);
  a.movImm(R3, (3 << 8) | 4);
  a.bl('draw_cstr');
  a.addImm(R0, R0, 6);
  a.movImm(R1, 3);
  a.ldrh(R2, R4, TE_NT_START);
  a.cmpImm(R2, 0);
  a.ldrLabelAddr(R2, 'str_books_hdr', 'NE');
  a.ldrLabelAddr(R2, 'str_secs_hdr', 'EQ');
  a.movImm(R3, (1 << 8) | 4);
  a.bl('draw_cstr');

  // Show 13 rows starting at ST_BOOK_SCR
  a.ldr(R6, R5, ST_BOOK_SCR); // i = scroll
  a.movImm(R7, 0); // row 0..12
  a.movImm(R9, 16); // yPos

  a.label('db_row_loop');
  a.cmpImm(R7, 13);
  a.b('db_rows_done', 'HS');
  a.ldrh(R0, R4, TE_NUM_BOOKS);
  a.cmpReg(R6, R0);
  a.b('db_rows_done', 'HS');

  a.ldr(R1, R5, ST_BOOK_CUR);
  a.cmpReg(R6, R1);
  a.b('db_not_sel', 'NE');

  // Draw highlight bar (10px tall) across y = R9-1 .. R9+8 with color 6
  a.push([R6, R7, R9]);
  a.movImm(R0, 240);
  a.subImm(R1, R9, 1);
  a.mul(R2, R1, R0);
  a.addReg(R0, R11, R2);
  a.movImm(R1, 0x06060606);
  a.movImm(R2, (240 * 10) / 4);
  a.label('db_sel_fill');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('db_sel_fill', 'NE');
  a.pop([R6, R7, R9]);
  a.movImm(R10, (7 << 8) | 6);
  a.b('db_draw_row');

  a.label('db_not_sel');
  a.movImm(R10, (1 << 8) | 0);

  a.label('db_draw_row');
  a.ldr(R0, R4, TE_BOOK_PTR);
  a.lslImm(R1, R6, 5);
  a.addReg(R8, R0, R1);

  a.push([R6, R7, R8, R9, R10]);
  a.movImm(R0, 8);
  a.mov(R1, R9);
  a.mov(R2, R8);
  a.mov(R3, R10);
  a.bl('draw_cstr');
  a.pop([R6, R7, R8, R9, R10]);

  a.push([R6, R7, R8, R9, R10]);
  a.movImm(R0, 196);
  a.mov(R1, R9);
  a.ldrh(R2, R8, 24);
  a.mov(R3, R10);
  a.bl('draw_uint');
  a.pop([R6, R7, R8, R9, R10]);

  a.addImm(R9, R9, 10);
  a.addImm(R6, R6, 1);
  a.addImm(R7, R7, 1);
  a.b('db_row_loop');

  a.label('db_rows_done');
  a.movImm(R0, 6);
  a.movImm(R1, 150);
  a.ldr(R2, R5, ST_HAS_BM);
  a.cmpImm(R2, 0);
  a.ldrLabelAddr(R2, 'str_books_ftr_bm', 'NE');
  a.ldrLabelAddr(R2, 'str_books_ftr', 'EQ');
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_cstr');
  a.b('flip_buffer');

  // =========================================================================
  // DRAW CHAPTERS GRID MODE (mode = 2)
  // =========================================================================
  a.label('draw_chaps_mode');
  a.bl('get_cur_trans_ptr');
  a.ldr(R1, R0, TE_BOOK_PTR);
  a.ldr(R0, R5, ST_BOOK_CUR);
  a.lslImm(R2, R0, 5);
  a.addReg(R8, R1, R2); // book entry

  a.movImm(R0, 6);
  a.movImm(R1, 3);
  a.mov(R2, R8);
  a.movImm(R3, (1 << 8) | 4);
  a.bl('draw_cstr');

  a.ldrh(R7, R8, 24); // total chapters in book
  a.ldr(R6, R5, ST_CHAP_SCR);
  a.movImm(R8, 0);

  a.label('dc_cell_loop');
  a.cmpImm(R8, 48);
  a.b('dc_done', 'HS');
  a.cmpReg(R6, R7);
  a.b('dc_done', 'HS');

  a.mov(R0, R8);
  a.movImm(R1, 6);
  a.bl('udivmod'); // R0 = row, R1 = col

  a.movImm(R2, 36);
  a.mul(R9, R1, R2);
  a.addImm(R9, R9, 12); // x (even!)

  a.movImm(R2, 15);
  a.mul(R10, R0, R2);
  a.addImm(R10, R10, 20); // y

  a.ldr(R0, R5, ST_CHAP_CUR);
  a.cmpReg(R6, R0);
  a.b('dc_not_sel', 'NE');

  a.push([R6, R7, R8, R9, R10]);
  a.movImm(R0, 240);
  a.subImm(R1, R10, 2);
  a.mul(R2, R1, R0);
  a.addReg(R2, R2, R9);
  a.subImm(R2, R2, 2);
  a.addReg(R0, R11, R2);
  a.movImm(R1, 0x0606);
  a.movImm(R2, 12);
  a.label('dc_box_row');
  a.movImm(R3, 15);
  a.label('dc_box_col');
  a.strh(R1, R0, 0);
  a.addImm(R0, R0, 2);
  a.subImm(R3, R3, 1, 'AL', true);
  a.b('dc_box_col', 'NE');
  a.addImm(R0, R0, 240 - 30);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('dc_box_row', 'NE');
  a.pop([R6, R7, R8, R9, R10]);
  a.movImm(R3, (7 << 8) | 6);
  a.b('dc_draw_num');

  a.label('dc_not_sel');
  a.movImm(R3, (1 << 8) | 0);

  a.label('dc_draw_num');
  a.push([R6, R7, R8]);
  a.mov(R0, R9);
  a.mov(R1, R10);
  a.addImm(R2, R6, 1);
  a.bl('draw_uint');
  a.pop([R6, R7, R8]);

  a.addImm(R6, R6, 1);
  a.addImm(R8, R8, 1);
  a.b('dc_cell_loop');

  a.label('dc_done');
  a.movImm(R0, 6);
  a.movImm(R1, 150);
  a.ldrLabelAddr(R2, 'str_chaps_ftr');
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_cstr');
  a.b('flip_buffer');

  // =========================================================================
  // DRAW MAIN PAGE: TRANSLATION SELECTOR MODE (mode = 3)
  // =========================================================================
  a.label('draw_main_mode');
  a.movImm(R4, DATA_HEADER_ADDR);

  // Header left: ROM Title at (6, 3)
  a.movImm(R0, 6);
  a.movImm(R1, 3);
  a.addImm(R2, R4, 40); // null-terminated ROM title
  a.movImm(R3, (1 << 8) | 4);
  a.bl('draw_cstr');

  // Header right: "<N> VER" at x=192
  a.movImm(R0, 192);
  a.movImm(R1, 3);
  a.ldr(R2, R4, 4); // numTranslations
  a.movImm(R3, (3 << 8) | 4);
  a.bl('draw_uint');
  a.movImm(R1, 3);
  a.ldrLabelAddr(R2, 'str_ver_hdr');
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_cstr');

  // Subheader prompt at (8, 17)
  a.movImm(R0, 8);
  a.movImm(R1, 17);
  a.ldrLabelAddr(R2, 'str_main_prompt');
  a.movImm(R3, (2 << 8) | 0);
  a.bl('draw_cstr');

  // Render up to 5 cards starting at ST_TRANS_SCR (indices 0..numTranslations-1 + SRCH card)
  a.ldr(R6, R5, ST_TRANS_SCR); // tIdx
  a.movImm(R7, 0); // row 0..4
  a.movImm(R9, 29); // yPos

  a.label('dm_card_loop');
  a.cmpImm(R7, 5);
  a.b('dm_cards_done', 'HS');
  a.ldr(R0, R4, 4); // numTranslations
  a.addImm(R0, R0, 1); // include Concordance Search card at index numTranslations
  a.cmpReg(R6, R0);
  a.b('dm_cards_done', 'HS');

  // Check if R6 == ST_TRANS_CUR
  a.ldr(R1, R5, ST_TRANS_CUR);
  a.cmpReg(R6, R1);
  a.b('dm_not_sel', 'NE');

  // Selected card: fill 228x21 box at (6, yPos) with color 6
  a.push([R6, R7, R9]);
  a.movImm(R0, 240);
  a.mul(R2, R9, R0);
  a.addImm(R2, R2, 6);
  a.addReg(R0, R11, R2);
  a.movImm(R1, 0x0606);
  a.movImm(R2, 21);
  a.label('dm_box_row');
  a.movImm(R3, 114); // 114 halfwords = 228 px
  a.label('dm_box_col');
  a.strh(R1, R0, 0);
  a.addImm(R0, R0, 2);
  a.subImm(R3, R3, 1, 'AL', true);
  a.b('dm_box_col', 'NE');
  a.addImm(R0, R0, 240 - 228);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('dm_box_row', 'NE');
  a.pop([R6, R7, R9]);
  a.movImm(R10, 6); // R10 = card bg color (6)
  a.b('dm_chk_card_kind');

  a.label('dm_not_sel');
  // Draw subtle 1px bottom divider at y = yPos + 20 with color 5
  a.push([R6, R7, R9]);
  a.movImm(R0, 240);
  a.addImm(R1, R9, 20);
  a.mul(R2, R1, R0);
  a.addImm(R2, R2, 6);
  a.addReg(R0, R11, R2);
  a.movImm(R1, 0x0505);
  a.movImm(R3, 114);
  a.label('dm_div_col');
  a.strh(R1, R0, 0);
  a.addImm(R0, R0, 2);
  a.subImm(R3, R3, 1, 'AL', true);
  a.b('dm_div_col', 'NE');
  a.pop([R6, R7, R9]);
  a.movImm(R10, 0); // R10 = card bg color (0)

  a.label('dm_chk_card_kind');
  a.ldr(R0, R4, 4);
  a.cmpReg(R6, R0);
  a.b('dm_draw_srch_card', 'EQ');

  // Look up translation entry into R8
  a.mov(R0, R6);
  a.bl('get_trans_ptr');
  a.mov(R8, R0);

  a.label('dm_draw_card_text');
  // Line 1: Code (fgAccent) + Full Name (fgPrimary) at (x=10, y=yPos+2)
  a.push([R6, R7, R8, R9, R10]);
  a.movImm(R0, 10);
  a.addImm(R1, R9, 2);
  a.addImm(R2, R8, TE_CODE);
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (3 << 8) | 0, 'NE');
  a.bl('draw_cstr');

  a.addImm(R0, R0, 8);
  a.addImm(R1, R9, 2);
  a.addImm(R2, R8, TE_NAME);
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (1 << 8) | 0, 'NE');
  a.bl('draw_cstr');
  a.pop([R6, R7, R8, R9, R10]);

  // Line 2: If numBooks <= 1 show "<totalChaps> Chapters", else "<numBooks> Sec  <totalChaps> Ch"
  a.push([R6, R7, R8, R9, R10]);
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (2 << 8) | 0, 'NE');

  a.ldrh(R0, R8, TE_NUM_BOOKS);
  a.cmpImm(R0, 1);
  a.b('dm_line2_multi', 'HI');

  a.push([R3]);
  a.movImm(R0, 10);
  a.addImm(R1, R9, 11);
  a.ldr(R2, R8, TE_TOTAL_CHAPS);
  a.bl('draw_uint');
  a.pop([R3]);
  a.addImm(R1, R9, 11);
  a.ldrLabelAddr(R2, 'str_chaps_full_sfx');
  a.bl('draw_cstr');
  a.b('dm_line2_done');

  a.label('dm_line2_multi');
  a.push([R3]);
  a.movImm(R0, 10);
  a.addImm(R1, R9, 11);
  a.ldrh(R2, R8, TE_NUM_BOOKS);
  a.bl('draw_uint');
  a.pop([R3]);

  a.push([R3]);
  a.addImm(R1, R9, 11);
  a.ldrLabelAddr(R2, 'str_bks_sep');
  a.bl('draw_cstr');
  a.pop([R3]);

  a.push([R3]);
  a.addImm(R1, R9, 11);
  a.ldr(R2, R8, TE_TOTAL_CHAPS);
  a.bl('draw_uint');
  a.pop([R3]);

  a.addImm(R1, R9, 11);
  a.ldrLabelAddr(R2, 'str_ch_sfx');
  a.bl('draw_cstr');

  a.label('dm_line2_done');
  a.pop([R6, R7, R8, R9, R10]);

  // If R6 == ST_TRANS show "ACTIVE", else if SRAM slot has progress show "SAVED"
  a.ldr(R0, R5, ST_TRANS);
  a.cmpReg(R6, R0);
  a.b('dm_chk_saved_tag', 'NE');
  a.push([R6, R7, R8, R9, R10]);
  a.movImm(R0, 184);
  a.addImm(R1, R9, 11);
  a.ldrLabelAddr(R2, 'str_active_tag');
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (3 << 8) | 0, 'NE');
  a.bl('draw_cstr');
  a.pop([R6, R7, R8, R9, R10]);
  a.b('dm_next_card');

  a.label('dm_chk_saved_tag');
  a.mov(R0, R6);
  a.bl('sram_has_vol_progress');
  a.cmpImm(R0, 0);
  a.b('dm_next_card', 'EQ');
  a.push([R6, R7, R8, R9, R10]);
  a.movImm(R0, 184);
  a.addImm(R1, R9, 11);
  a.ldrLabelAddr(R2, 'str_saved_tag');
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (2 << 8) | 0, 'NE');
  a.bl('draw_cstr');
  a.pop([R6, R7, R8, R9, R10]);
  a.b('dm_next_card');

  // Special Card: Concordance Word Search
  a.label('dm_draw_srch_card');
  a.bl('get_cur_trans_ptr');
  a.mov(R8, R0);
  a.push([R6, R7, R8, R9, R10]);
  a.movImm(R0, 10);
  a.addImm(R1, R9, 2);
  a.ldrLabelAddr(R2, 'str_srch_code');
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (3 << 8) | 0, 'NE');
  a.bl('draw_cstr');

  a.addImm(R0, R0, 8);
  a.addImm(R1, R9, 2);
  a.ldrLabelAddr(R2, 'str_srch_title');
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (1 << 8) | 0, 'NE');
  a.bl('draw_cstr');
  a.pop([R6, R7, R8, R9, R10]);

  a.push([R6, R7, R8, R9, R10]);
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (2 << 8) | 0, 'NE');
  a.push([R3]);
  a.movImm(R0, 10);
  a.addImm(R1, R9, 11);
  a.ldr(R2, R8, TE_CONC_WORDS);
  a.bl('draw_uint');
  a.pop([R3]);
  a.push([R3]);
  a.addImm(R1, R9, 11);
  a.ldrLabelAddr(R2, 'str_srch_sub');
  a.bl('draw_cstr');
  a.pop([R3]);
  a.addImm(R1, R9, 11);
  a.addImm(R2, R8, TE_CODE);
  a.bl('draw_cstr');
  a.pop([R6, R7, R8, R9, R10]);

  a.label('dm_next_card');
  a.addImm(R9, R9, 22);
  a.addImm(R6, R6, 1);
  a.addImm(R7, R7, 1);
  a.b('dm_card_loop');

  a.label('dm_cards_done');
  a.movImm(R0, 6);
  a.movImm(R1, 150);
  a.ldrLabelAddr(R2, 'str_main_ftr');
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_cstr');
  a.b('flip_buffer');
  a.flushLiterals();

  // =========================================================================
  // DRAW CONCORDANCE SEARCH MODE (mode = 4)
  // =========================================================================
  a.label('draw_conc_mode');
  a.movImm(R4, DATA_HEADER_ADDR);
  a.bl('get_cur_trans_ptr');
  a.mov(R7, R0); // transEntryPtr

  a.ldr(R0, R5, ST_SRCH_SUB);
  a.cmpImm(R0, 0);
  a.b('dc_draw_results', 'NE');

  // --- Sub-mode 0: A-Z Word Picker + Live Matches ---
  // Header left: "[CODE] Word Search"
  a.movImm(R0, 6);
  a.movImm(R1, 3);
  a.addImm(R2, R7, TE_CODE);
  a.movImm(R3, (3 << 8) | 4);
  a.bl('draw_cstr');
  a.addImm(R0, R0, 6);
  a.movImm(R1, 3);
  a.ldrLabelAddr(R2, 'str_conc_hdr');
  a.movImm(R3, (1 << 8) | 4);
  a.bl('draw_cstr');

  // Header right: word count
  a.movImm(R0, 192);
  a.movImm(R1, 3);
  a.ldr(R2, R7, TE_CONC_WORDS);
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_uint');

  // Query line at y=16: "> <query>_"
  a.movImm(R0, 6);
  a.movImm(R1, 16);
  a.ldrLabelAddr(R2, 'str_conc_prompt');
  a.movImm(R3, (3 << 8) | 0);
  a.bl('draw_cstr');

  a.movImm(R1, 16);
  a.addImm(R2, R5, ST_SRCH_QUERY);
  a.movImm(R3, (1 << 8) | 0);
  a.bl('draw_cstr');

  a.movImm(R1, 16);
  a.movImm(R2, 0x5f); // '_'
  a.movImm(R3, (3 << 8) | 0);
  a.bl('draw_char');

  // Right side of query row: match count
  a.movImm(R0, 168);
  a.movImm(R1, 16);
  a.ldr(R2, R5, ST_SRCH_MATCH_CNT);
  a.movImm(R3, (2 << 8) | 0);
  a.bl('draw_uint');
  a.addImm(R0, R0, 4);
  a.movImm(R1, 16);
  a.ldrLabelAddr(R2, 'str_conc_words_lbl');
  a.movImm(R3, (2 << 8) | 0);
  a.bl('draw_cstr');

  // Live dictionary suggestions (4 rows at y=28, 37, 46, 55)
  a.ldr(R6, R5, ST_SRCH_MATCH_CUR);
  a.cmpImm(R6, 3);
  a.movImm(R6, 0, 'LS');
  a.subImm(R6, R6, 3, 'HI'); // windowStart offset relative to ST_SRCH_MATCH_START

  a.movImm(R8, 0); // row 0..3
  a.movImm(R9, 28); // yPos
  a.label('dcp_sugg_loop');
  a.cmpImm(R8, 4);
  a.b('dcp_sugg_done', 'HS');
  a.ldr(R0, R5, ST_SRCH_MATCH_CNT);
  a.cmpReg(R6, R0);
  a.b('dcp_sugg_done', 'HS');

  a.ldr(R0, R5, ST_SRCH_MATCH_CUR);
  a.cmpReg(R6, R0);
  a.b('dcp_sugg_nosel', 'NE');

  // Highlight bar (228x9) at (6, yPos-1) color 6
  a.push([R6, R7, R8, R9]);
  a.movImm(R0, 240);
  a.subImm(R1, R9, 1);
  a.mul(R2, R1, R0);
  a.addImm(R2, R2, 6);
  a.addReg(R0, R11, R2);
  a.movImm(R1, 0x0606);
  a.movImm(R2, 9);
  a.label('dcp_sel_row');
  a.movImm(R3, 114);
  a.label('dcp_sel_col');
  a.strh(R1, R0, 0);
  a.addImm(R0, R0, 2);
  a.subImm(R3, R3, 1, 'AL', true);
  a.b('dcp_sel_col', 'NE');
  a.addImm(R0, R0, 240 - 228);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('dcp_sel_row', 'NE');
  a.pop([R6, R7, R8, R9]);
  a.movImm(R10, (7 << 8) | 6);
  a.b('dcp_sugg_text');

  a.label('dcp_sugg_nosel');
  a.movImm(R10, (1 << 8) | 0);

  a.label('dcp_sugg_text');
  a.ldr(R0, R5, ST_SRCH_MATCH_START);
  a.addReg(R0, R0, R6);
  a.addReg(R1, R0, R0, 0, 1);
  a.lslImm(R1, R1, 3);
  a.ldr(R2, R7, TE_CONC_PTR);
  a.addReg(R12, R2, R1); // WordEntry*

  a.push([R6, R7, R8, R9, R10, R12]);
  a.movImm(R0, 10);
  a.mov(R1, R9);
  a.mov(R2, R12);
  a.mov(R3, R10);
  a.bl('draw_cstr');
  a.pop([R6, R7, R8, R9, R10, R12]);

  a.push([R6, R7, R8, R9, R10]);
  a.movImm(R0, 180);
  a.mov(R1, R9);
  a.ldr(R2, R12, 20); // numHits
  a.mov(R3, R10);
  a.bl('draw_uint');
  a.pop([R6, R7, R8, R9, R10]);

  a.addImm(R9, R9, 9);
  a.addImm(R6, R6, 1);
  a.addImm(R8, R8, 1);
  a.b('dcp_sugg_loop');

  a.label('dcp_sugg_done');
  // 1px divider at y=66 (color 5)
  a.movImm(R0, 240 * 66);
  a.addReg(R0, R11, R0);
  a.movImm(R1, 0x05050505);
  a.movImm(R2, 240 / 4);
  a.label('dcp_div');
  a.str(R1, R0, 0);
  a.addImm(R0, R0, 4);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('dcp_div', 'NE');

  // 7x4 A-Z Keyboard Grid at y=71..140
  a.movImm(R8, 0); // cell 0..27
  a.label('dcp_key_loop');
  a.cmpImm(R8, 28);
  a.b('dcp_keys_done', 'HS');

  a.mov(R0, R8);
  a.movImm(R1, 7);
  a.bl('udivmod'); // R0=row, R1=col

  a.movImm(R2, 30);
  a.mul(R9, R1, R2);
  a.addImm(R9, R9, 14); // x (even)

  a.movImm(R2, 18);
  a.mul(R10, R0, R2);
  a.addImm(R10, R10, 72); // y

  a.ldr(R0, R5, ST_SRCH_KCUR);
  a.cmpReg(R8, R0);
  a.b('dcp_key_nosel', 'NE');

  // Draw selected key box 24x14 at (R9-4, R10-3)
  a.push([R7, R8, R9, R10]);
  a.movImm(R0, 240);
  a.subImm(R1, R10, 3);
  a.mul(R2, R1, R0);
  a.addReg(R2, R2, R9);
  a.subImm(R2, R2, 4);
  a.addReg(R0, R11, R2);
  a.movImm(R1, 0x0606);
  a.movImm(R2, 14);
  a.label('dcp_kbox_r');
  a.movImm(R3, 12); // 24 px
  a.label('dcp_kbox_c');
  a.strh(R1, R0, 0);
  a.addImm(R0, R0, 2);
  a.subImm(R3, R3, 1, 'AL', true);
  a.b('dcp_kbox_c', 'NE');
  a.addImm(R0, R0, 240 - 24);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('dcp_kbox_r', 'NE');
  a.pop([R7, R8, R9, R10]);
  a.movImm(R3, (7 << 8) | 6);
  a.b('dcp_key_glyph');

  a.label('dcp_key_nosel');
  a.movImm(R3, (1 << 8) | 0);

  a.label('dcp_key_glyph');
  a.cmpImm(R8, 26);
  a.b('dcp_key_special', 'HS');
  a.push([R7, R8]);
  a.mov(R0, R9);
  a.mov(R1, R10);
  a.addImm(R2, R8, 0x41); // 'A' + idx
  a.bl('draw_char');
  a.pop([R7, R8]);
  a.b('dcp_key_next');

  a.label('dcp_key_special');
  a.push([R7, R8]);
  a.mov(R0, R9);
  a.mov(R1, R10);
  a.cmpImm(R8, 26);
  a.ldrLabelAddr(R2, 'str_key_del', 'EQ');
  a.ldrLabelAddr(R2, 'str_key_ok', 'NE');
  a.bl('draw_cstr');
  a.pop([R7, R8]);

  a.label('dcp_key_next');
  a.addImm(R8, R8, 1);
  a.b('dcp_key_loop');

  a.label('dcp_keys_done');
  a.movImm(R0, 6);
  a.movImm(R1, 150);
  a.ldrLabelAddr(R2, 'str_conc_pk_ftr');
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_cstr');
  a.b('flip_buffer');

  // --- Sub-mode 1: Verse Results List ---
  a.label('dc_draw_results');
  a.ldr(R1, R7, TE_CONC_PTR);
  a.ldr(R2, R5, ST_SRCH_WORD_IDX);
  a.addReg(R0, R2, R2, 0, 1);
  a.lslImm(R0, R0, 3);
  a.addReg(R8, R1, R0); // WordEntry* in R8

  // Header left: "[CODE] word"
  a.movImm(R0, 6);
  a.movImm(R1, 3);
  a.addImm(R2, R7, TE_CODE);
  a.movImm(R3, (3 << 8) | 4);
  a.bl('draw_cstr');
  a.addImm(R0, R0, 6);
  a.movImm(R1, 3);
  a.mov(R2, R8);
  a.movImm(R3, (1 << 8) | 4);
  a.bl('draw_cstr');

  // Header right: "cur+1/numHits"
  a.movImm(R0, 168);
  a.movImm(R1, 3);
  a.ldr(R2, R5, ST_SRCH_RES_CUR);
  a.addImm(R2, R2, 1);
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_uint');
  a.movImm(R1, 3);
  a.movImm(R2, 0x2f);
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_char');
  a.movImm(R1, 3);
  a.ldr(R2, R8, 20);
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_uint');

  // Draw up to 5 result cards (25px each, y=16, 41, 66, 91, 116)
  a.ldr(R6, R5, ST_SRCH_RES_SCR);
  a.movImm(R7, 0); // row 0..4
  a.movImm(R9, 16); // yPos

  a.label('dcr_loop');
  a.cmpImm(R7, 5);
  a.b('dcr_done', 'HS');
  a.ldr(R0, R8, 20); // numHits
  a.cmpReg(R6, R0);
  a.b('dcr_done', 'HS');

  a.ldr(R0, R5, ST_SRCH_RES_CUR);
  a.cmpReg(R6, R0);
  a.b('dcr_nosel', 'NE');

  // Fill 228x23 highlight box at (6, yPos) with color 6
  a.push([R6, R7, R8, R9]);
  a.movImm(R0, 240);
  a.mul(R2, R9, R0);
  a.addImm(R2, R2, 6);
  a.addReg(R0, R11, R2);
  a.movImm(R1, 0x0606);
  a.movImm(R2, 23);
  a.label('dcr_box_r');
  a.movImm(R3, 114);
  a.label('dcr_box_c');
  a.strh(R1, R0, 0);
  a.addImm(R0, R0, 2);
  a.subImm(R3, R3, 1, 'AL', true);
  a.b('dcr_box_c', 'NE');
  a.addImm(R0, R0, 240 - 228);
  a.subImm(R2, R2, 1, 'AL', true);
  a.b('dcr_box_r', 'NE');
  a.pop([R6, R7, R8, R9]);
  a.movImm(R10, 6);
  a.b('dcr_card_content');

  a.label('dcr_nosel');
  // 1px divider at yPos + 23
  a.push([R6, R7, R8, R9]);
  a.movImm(R0, 240);
  a.addImm(R1, R9, 23);
  a.mul(R2, R1, R0);
  a.addImm(R2, R2, 6);
  a.addReg(R0, R11, R2);
  a.movImm(R1, 0x0505);
  a.movImm(R3, 114);
  a.label('dcr_div_c');
  a.strh(R1, R0, 0);
  a.addImm(R0, R0, 2);
  a.subImm(R3, R3, 1, 'AL', true);
  a.b('dcr_div_c', 'NE');
  a.pop([R6, R7, R8, R9]);
  a.movImm(R10, 0);

  a.label('dcr_card_content');
  // Load uint16 globalVerseIdx = hitsPtr[R6] & decode -> bookIdx, chapIdx, verseNum
  a.ldr(R0, R8, 16);
  a.lslImm(R1, R6, 1);
  a.addReg(R0, R0, R1);
  a.ldrh(R12, R0, 0); // globalVerseIdx temporarily in R12

  a.push([R6, R7, R8, R9, R10]);
  a.bl('get_cur_trans_ptr');
  a.mov(R1, R0); // transPtr
  a.mov(R0, R12); // globalVerseIdx
  a.bl('decode_global_verse'); // R0=bookIdx, R1=chapIdx, R2=verseNum
  a.mov(R4, R0); // bookIdx
  a.mov(R6, R1); // chapIdx
  a.mov(R12, R2); // verseNum

  // Extract snippet while we have (bookIdx=R4, chapIdx=R6, verseNum=R12)
  a.push([R4, R6, R12]);
  a.mov(R0, R4);
  a.mov(R1, R6);
  a.mov(R2, R12);
  a.addImm(R3, R5, ST_SRCH_LINE_BUF);
  a.bl('extract_verse_snippet');
  a.pop([R4, R6, R12]);

  a.bl('get_cur_trans_ptr');
  a.ldr(R1, R0, TE_BOOK_PTR);
  a.lslImm(R2, R4, 5);
  a.addReg(R4, R1, R2); // BookEntry*

  // Draw BookName at (10, yPos+2)
  a.movImm(R0, 10);
  a.addImm(R1, R9, 2);
  a.mov(R2, R4);
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (3 << 8) | 0, 'NE');
  a.bl('draw_cstr');

  // Draw " Ch:Vs"
  a.addImm(R0, R0, 6);
  a.addImm(R1, R9, 2);
  a.addImm(R2, R6, 1);
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (3 << 8) | 0, 'NE');
  a.bl('draw_uint');

  a.addImm(R1, R9, 2);
  a.movImm(R2, 0x3a); // ':'
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (3 << 8) | 0, 'NE');
  a.bl('draw_char');

  a.addImm(R1, R9, 2);
  a.mov(R2, R12); // verseNum
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (3 << 8) | 0, 'NE');
  a.bl('draw_uint');

  // Draw verse snippet at (10, yPos+12)
  a.movImm(R0, 10);
  a.addImm(R1, R9, 12);
  a.addImm(R2, R5, ST_SRCH_LINE_BUF);
  a.cmpImm(R10, 6);
  a.movImm(R3, (7 << 8) | 6, 'EQ');
  a.movImm(R3, (1 << 8) | 0, 'NE');
  a.bl('draw_cstr');
  a.pop([R6, R7, R8, R9, R10]);

  a.addImm(R9, R9, 25);
  a.addImm(R6, R6, 1);
  a.addImm(R7, R7, 1);
  a.b('dcr_loop');

  a.label('dcr_done');
  a.movImm(R0, 6);
  a.movImm(R1, 150);
  a.ldrLabelAddr(R2, 'str_conc_res_ftr');
  a.movImm(R3, (2 << 8) | 4);
  a.bl('draw_cstr');
  a.b('flip_buffer');
  a.flushLiterals();

  // =========================================================================
  // HELPER: decode_global_verse(R0 = globalVerseIdx, R1 = transPtr)
  // Returns R0 = bookIdx, R1 = chapIdx, R2 = verseNum
  // =========================================================================
  a.label('decode_global_verse');
  a.push([R4, R5, R6, R7, R8, R9, R10, LR]);
  a.mov(R7, R0); // globalVerseIdx
  a.mov(R8, R1); // transPtr

  // Step 1: Binary search chapFirstVerse[0..totalChaps-1] for largest idx <= globalVerseIdx
  a.ldr(R6, R8, TE_CV_PTR);
  a.movImm(R4, 0); // lo
  a.ldr(R5, R8, TE_TOTAL_CHAPS); // hi
  a.label('dgv_c_loop');
  a.cmpReg(R4, R5);
  a.b('dgv_c_done', 'HS');
  a.addReg(R9, R4, R5);
  a.lsrImm(R9, R9, 1); // mid
  a.addReg(R3, R6, R9, 0, 1);
  a.ldrh(R2, R3, 0); // chapFirstVerse[mid]
  a.cmpReg(R2, R7);
  a.addImm(R4, R9, 1, 'LS');
  a.mov(R5, R9, 'HI');
  a.b('dgv_c_loop');
  a.label('dgv_c_done');

  a.cmpImm(R4, 0);
  a.subImm(R9, R4, 1, 'HI');
  a.movImm(R9, 0, 'EQ'); // globalChapIdx
  a.addReg(R3, R6, R9, 0, 1);
  a.ldrh(R2, R3, 0);
  a.subReg(R10, R7, R2);
  a.addImm(R10, R10, 1); // verseNum

  // Step 2: Binary search bookTable[0..numBooks-1] for largest book with firstChapIdx <= globalChapIdx
  a.ldr(R6, R8, TE_BOOK_PTR);
  a.movImm(R4, 0); // lo
  a.ldrh(R5, R8, TE_NUM_BOOKS); // hi
  a.label('dgv_b_loop');
  a.cmpReg(R4, R5);
  a.b('dgv_b_done', 'HS');
  a.addReg(R0, R4, R5);
  a.lsrImm(R0, R0, 1); // mid
  a.lslImm(R3, R0, 5);
  a.addReg(R3, R6, R3);
  a.ldrh(R2, R3, 26); // firstChapterIdx
  a.cmpReg(R2, R9);
  a.addImm(R4, R0, 1, 'LS');
  a.mov(R5, R0, 'HI');
  a.b('dgv_b_loop');
  a.label('dgv_b_done');

  a.cmpImm(R4, 0);
  a.subImm(R0, R4, 1, 'HI');
  a.movImm(R0, 0, 'EQ'); // bookIdx
  a.lslImm(R3, R0, 5);
  a.addReg(R3, R6, R3);
  a.ldrh(R2, R3, 26);
  a.subReg(R1, R9, R2); // chapIdx
  a.mov(R2, R10); // verseNum
  a.pop([R4, R5, R6, R7, R8, R9, R10, LR]);
  a.bx(LR);

  // =========================================================================
  // HELPER: extract_verse_snippet(R0=bookIdx, R1=chapIdx, R2=verseNum, R3=outBuf)
  // =========================================================================
  a.label('extract_verse_snippet');
  a.push([R4, R5, R6, R7, R8, R9, R10, LR]);
  a.mov(R7, R2); // target verseNum
  a.mov(R8, R3); // outBuf
  a.mov(R4, R0); // bookIdx
  a.mov(R6, R1); // chapIdx
  a.bl('get_cur_trans_ptr');
  a.ldr(R1, R0, TE_BOOK_PTR);
  a.lslImm(R4, R4, 5);
  a.addReg(R1, R1, R4);
  a.ldrh(R2, R1, 26); // firstChapterIdx
  a.addReg(R2, R2, R6);
  a.ldr(R1, R0, TE_CHAP_PTR);
  a.lslImm(R2, R2, 3);
  a.addReg(R1, R1, R2);
  a.ldr(R0, R1, 0); // romPtr
  a.ldr(R1, R1, 4); // compressedLen
  a.movImm(R2, SNIPPET_CHAP_BUF);
  a.bl('decompress_chapter');
  a.movImm(R4, SNIPPET_CHAP_BUF); // ptr
  a.addReg(R5, R4, R0); // endPtr

  a.label('evs_scan');
  a.cmpReg(R4, R5);
  a.b('evs_empty', 'HS');
  a.ldrb(R0, R4, 0);
  a.addImm(R4, R4, 1);
  a.cmpImm(R0, 0x04);
  a.b('evs_scan', 'NE');

  a.movImm(R0, 0);
  a.movImm(R1, 10);
  a.label('evs_digits');
  a.cmpReg(R4, R5);
  a.b('evs_chk_v', 'HS');
  a.ldrb(R2, R4, 0);
  a.cmpImm(R2, 0x30);
  a.b('evs_chk_v', 'LO');
  a.cmpImm(R2, 0x39);
  a.b('evs_chk_v', 'HI');
  a.mul(R3, R0, R1);
  a.subImm(R2, R2, 0x30);
  a.addReg(R0, R3, R2);
  a.addImm(R4, R4, 1);
  a.b('evs_digits');

  a.label('evs_chk_v');
  a.cmpReg(R0, R7);
  a.b('evs_scan', 'NE');

  // Skip 0x05 end-of-anchor
  a.cmpReg(R4, R5);
  a.b('evs_empty', 'HS');
  a.ldrb(R0, R4, 0);
  a.cmpImm(R0, 0x05);
  a.addImm(R4, R4, 1, 'EQ');

  // If followed by visible Bible verse number (0x01 <digit>... 0x02), skip it; keep 0x01Heading0x02
  a.cmpReg(R4, R5);
  a.b('evs_empty', 'HS');
  a.ldrb(R0, R4, 0);
  a.cmpImm(R0, 0x01);
  a.b('evs_skip_ws', 'NE');
  a.addImm(R1, R4, 1);
  a.cmpReg(R1, R5);
  a.b('evs_skip_ws', 'HS');
  a.ldrb(R0, R1, 0);
  a.cmpImm(R0, 0x30);
  a.b('evs_skip_ws', 'LO');
  a.cmpImm(R0, 0x39);
  a.b('evs_skip_ws', 'HI');
  // Scan past matching 0x02
  a.label('evs_skip_vnum');
  a.cmpReg(R4, R5);
  a.b('evs_empty', 'HS');
  a.ldrb(R0, R4, 0);
  a.addImm(R4, R4, 1);
  a.cmpImm(R0, 0x02);
  a.b('evs_skip_vnum', 'NE');

  a.label('evs_skip_ws');
  a.cmpReg(R4, R5);
  a.b('evs_empty', 'HS');
  a.ldrb(R0, R4, 0);
  a.cmpImm(R0, 0x20);
  a.addImm(R4, R4, 1, 'EQ');

  // Copy up to (colsPerLine - 2) chars into outBuf
  a.movImm(R0, DATA_HEADER_ADDR);
  a.ldr(R9, R0, 20); // colsPerLine (38 or 28)
  a.subImm(R9, R9, 2);
  a.movImm(R10, 0);
  a.label('evs_copy');
  a.cmpReg(R10, R9);
  a.b('evs_term', 'HS');
  a.cmpReg(R4, R5);
  a.b('evs_term', 'HS');
  a.ldrb(R0, R4, 0);
  a.addImm(R4, R4, 1);
  a.cmpImm(R0, 0x04);
  a.b('evs_term', 'EQ');
  a.cmpImm(R0, 0x03);
  a.b('evs_term', 'EQ');
  a.cmpImm(R0, 0x0a);
  a.b('evs_term', 'EQ');
  a.cmpImm(R0, 0x01);
  a.b('evs_copy', 'EQ');
  a.cmpImm(R0, 0x02);
  a.b('evs_copy', 'EQ');
  a.cmpImm(R0, 0x05);
  a.b('evs_copy', 'EQ');
  a.cmpImm(R0, 0x0b);
  a.b('evs_copy', 'EQ');
  a.cmpImm(R0, 0x20);
  a.movImm(R0, 0x20, 'LO');
  a.strbReg(R0, R8, R10);
  a.addImm(R10, R10, 1);
  a.b('evs_copy');

  a.label('evs_empty');
  a.movImm(R10, 0);
  a.label('evs_term');
  a.movImm(R0, 0);
  a.strbReg(R0, R8, R10);
  a.pop([R4, R5, R6, R7, R8, R9, R10, LR]);
  a.bx(LR);
  a.flushLiterals();

  // =========================================================================
  // FLIP DOUBLE BUFFER (Mode 4 DISPCNT bit 4 = 0x0010)
  // =========================================================================
  a.label('flip_buffer');
  a.movImm(R5, STATE_BASE);
  a.ldr(R0, R5, ST_BACKBUF);
  a.movImm(R1, REG_DISPCNT);
  a.cmpImm(R0, 0);
  a.movImm(R2, 0x0404, 'EQ'); // display page 0
  a.movImm(R2, 0x0414, 'NE'); // display page 1
  a.strh(R2, R1, 0);
  a.eorImm(R0, R0, 1);
  a.str(R0, R5, ST_BACKBUF);

  a.pop([R4, R5, R6, R7, R8, R9, R10, R11, LR]);
  a.bx(LR);

  // =========================================================================
  // DRAW CHAR: R0=x (even!), R1=y, R2=charCode, R3=(fg<<8)|bg, R11=vramBase
  // Returns R0 = x + charWidth
  // =========================================================================
  a.label('draw_char');
  a.push([R4, R5, R6, R7, R8, R9, R10, LR]);
  a.movImm(R4, 240);
  a.mul(R5, R1, R4); // R5 = y * 240
  a.addReg(R5, R5, R0);
  a.addReg(R5, R11, R5); // R5 = VRAM dst

  a.andImm(R4, R2, 0xff);
  a.lslImm(R4, R4, 3); // char * 8
  a.ldrLabelAddr(R6, 'font_table');
  a.addReg(R6, R6, R4); // R6 = glyph rows ptr

  a.lsrImm(R7, R3, 8);
  a.andImm(R7, R7, 0xff); // R7 = fg
  a.andImm(R8, R3, 0xff); // R8 = bg

  a.movImm(R9, 8);
  a.label('dch_row');
  a.ldrb(R10, R6, 0);
  a.addImm(R6, R6, 1);

  // Pair 0 (bits 7, 6)
  a.tstImm(R10, 0x80);
  a.mov(R1, R7, 'NE');
  a.mov(R1, R8, 'EQ');
  a.tstImm(R10, 0x40);
  a.mov(R2, R7, 'NE');
  a.mov(R2, R8, 'EQ');
  a.orrReg(R1, R1, R2, 0, 8);
  a.strh(R1, R5, 0);

  // Pair 1 (bits 5, 4)
  a.tstImm(R10, 0x20);
  a.mov(R1, R7, 'NE');
  a.mov(R1, R8, 'EQ');
  a.tstImm(R10, 0x10);
  a.mov(R2, R7, 'NE');
  a.mov(R2, R8, 'EQ');
  a.orrReg(R1, R1, R2, 0, 8);
  a.strh(R1, R5, 2);

  // Pair 2 (bits 3, 2)
  a.tstImm(R10, 0x08);
  a.mov(R1, R7, 'NE');
  a.mov(R1, R8, 'EQ');
  a.tstImm(R10, 0x04);
  a.mov(R2, R7, 'NE');
  a.mov(R2, R8, 'EQ');
  a.orrReg(R1, R1, R2, 0, 8);
  a.strh(R1, R5, 4);

  if (wideBold) {
    a.tstImm(R10, 0x02);
    a.mov(R1, R7, 'NE');
    a.mov(R1, R8, 'EQ');
    a.tstImm(R10, 0x01);
    a.mov(R2, R7, 'NE');
    a.mov(R2, R8, 'EQ');
    a.orrReg(R1, R1, R2, 0, 8);
    a.strh(R1, R5, 6);
  }

  a.addImm(R5, R5, 240);
  a.subImm(R9, R9, 1, 'AL', true);
  a.b('dch_row', 'NE');

  a.addImm(R0, R0, wideBold ? 8 : 6);
  a.pop([R4, R5, R6, R7, R8, R9, R10, LR]);
  a.bx(LR);

  // =========================================================================
  // DRAW CSTR: R0=x, R1=y, R2=cstrPtr, R3=(fg<<8)|bg -> returns R0=endX
  // =========================================================================
  a.label('draw_cstr');
  a.push([R4, R5, R6, LR]);
  a.mov(R4, R2);
  a.mov(R5, R1);
  a.mov(R6, R3);
  a.label('dcs_loop');
  a.ldrb(R2, R4, 0);
  a.cmpImm(R2, 0);
  a.b('dcs_done', 'EQ');
  a.cmpImm(R0, 232);
  a.b('dcs_done', 'HI');
  a.mov(R1, R5);
  a.mov(R3, R6);
  a.bl('draw_char');
  a.addImm(R4, R4, 1);
  a.b('dcs_loop');
  a.label('dcs_done');
  a.pop([R4, R5, R6, LR]);
  a.bx(LR);

  // =========================================================================
  // DRAW UINT: R0=x, R1=y, R2=uintVal, R3=(fg<<8)|bg -> returns R0=endX
  // =========================================================================
  a.label('draw_uint');
  a.push([R4, R5, R6, R7, R8, LR]);
  a.mov(R4, R0);
  a.mov(R5, R1);
  a.mov(R6, R3);
  a.mov(R0, R2);
  a.movImm(R7, 0);
  a.subImm(SP, SP, 16);

  a.label('du_div_loop');
  a.movImm(R1, 10);
  a.bl('udivmod');
  a.addImm(R1, R1, 0x30);
  a.strbReg(R1, SP, R7);
  a.addImm(R7, R7, 1);
  a.cmpImm(R0, 0);
  a.b('du_div_loop', 'NE');

  a.mov(R0, R4);
  a.label('du_draw_loop');
  a.subImm(R7, R7, 1, 'AL', true);
  a.b('du_done', 'MI');
  a.ldrbReg(R2, SP, R7);
  a.mov(R1, R5);
  a.mov(R3, R6);
  a.bl('draw_char');
  a.b('du_draw_loop');

  a.label('du_done');
  a.addImm(SP, SP, 16);
  a.pop([R4, R5, R6, R7, R8, LR]);
  a.bx(LR);

  // =========================================================================
  // DRAW SCRIPTURE LINE: R0=x, R1=y, R2=ptr, R3=len
  // =========================================================================
  a.label('draw_scripture_line');
  a.push([R4, R5, R6, R7, R8, LR]);
  a.mov(R4, R2);
  a.addReg(R5, R2, R3);
  a.mov(R6, R1);
  a.movImm(R7, (1 << 8) | 0);

  a.label('dsl_loop');
  a.cmpReg(R4, R5);
  a.b('dsl_done', 'HS');
  a.ldrb(R2, R4, 0);
  a.addImm(R4, R4, 1);

  a.cmpImm(R2, 0x01);
  a.b('dsl_not_vstart', 'NE');
  a.movImm(R7, (3 << 8) | 0);
  a.b('dsl_loop');

  a.label('dsl_not_vstart');
  a.cmpImm(R2, 0x02);
  a.b('dsl_not_vend', 'NE');
  a.movImm(R7, (1 << 8) | 0);
  a.b('dsl_loop');

  a.label('dsl_not_vend');
  a.cmpImm(R2, 0x04);
  a.b('dsl_not_anchor', 'NE');
  a.label('dsl_skip_anchor');
  a.cmpReg(R4, R5);
  a.b('dsl_done', 'HS');
  a.ldrb(R2, R4, 0);
  a.addImm(R4, R4, 1);
  a.cmpImm(R2, 0x05);
  a.b('dsl_skip_anchor', 'NE');
  a.b('dsl_loop');

  a.label('dsl_not_anchor');
  a.cmpImm(R2, 0x03);
  a.movImm(R2, 0x20, 'EQ'); // dynamic verse separator renders as space in prose mode
  a.cmpImm(R2, 0x20);
  a.b('dsl_loop', 'LO'); // skip any residual control bytes (0x05, 0x0B, etc.)
  a.mov(R1, R6);
  a.mov(R3, R7);
  a.bl('draw_char');
  a.b('dsl_loop');

  a.label('dsl_done');
  a.pop([R4, R5, R6, R7, R8, LR]);
  a.bx(LR);

  // =========================================================================
  // LITERAL POOL + DATA TABLES
  // =========================================================================
  a.flushLiterals();
  a.align(4);

  a.label('palette_table');
  for (const theme of GBA_THEMES) {
    const bgr = getThemeBgr555Palette(theme);
    const bytes = new Uint8Array(16);
    const dv = new DataView(bytes.buffer);
    for (let i = 0; i < 8; i++) {
      dv.setUint16(i * 2, bgr[i], true);
    }
    a.emitBytes(bytes);
  }

  a.align(4);
  a.label('font_table');
  a.emitBytes(buildGbaFontTable(wideBold));

  // Static UI strings (4-byte padded, kept <= 28 chars for 8x8 bold compatibility)
  const emitCStr = (lbl: string, txt: string) => {
    a.align(4);
    a.label(lbl);
    const raw = encodeGbaStringBytes(txt);
    raw.push(0);
    while (raw.length % 4 !== 0) raw.push(0);
    a.emitBytes(raw);
  };

  const isBibleMode = config.studioMode === 'bible';

  emitCStr('str_reader_ftr', 'A:Ch St+L/R:Txt Sel:Clr');
  emitCStr('str_bm_saved', 'Bookmark saved to SRAM!');
  emitCStr('str_toast_prose', isBibleMode ? 'Flow: Prose Paragraphs' : 'Flow: Spacious / Prose');
  emitCStr('str_toast_vpl', isBibleMode ? 'Flow: Verse-per-Line' : 'Flow: Compact / Lines');
  emitCStr('str_toast_14l', 'Density: 14 Lines (9px)');
  emitCStr('str_toast_16l', 'Density: 16 Lines (8px)');
  emitCStr('str_books_hdr', 'Books (L:OT / R:NT)');
  emitCStr('str_secs_hdr', 'Sections (L:Top R:Mid)');
  emitCStr('str_ch_hdr_lbl', 'Ch ');
  emitCStr('str_books_ftr', isBibleMode ? 'A:Ch B/St:Read L+R:Main' : 'A:Chap B/St:Read L+R:Shelf');
  emitCStr('str_books_ftr_bm', isBibleMode ? 'A:Ch Sel:Mark L+R:Main' : 'A:Chap Sel:Mark L+R:Shelf');
  emitCStr('str_chaps_ftr', 'D-Pad:Pick A:Open B:Back');
  emitCStr('str_ver_hdr', isBibleMode ? ' VER' : ' BKS');
  emitCStr(
    'str_main_prompt',
    isBibleMode ? 'Main Menu (Select Bible):' : 'Library Shelf (Select Book):'
  );
  emitCStr('str_bks_sep', isBibleMode ? ' Bks  ' : ' Sec  ');
  emitCStr('str_ch_sfx', ' Ch');
  emitCStr('str_chaps_full_sfx', ' Chapters');
  emitCStr('str_active_tag', 'ACTIVE');
  emitCStr('str_saved_tag', 'SAVED');
  emitCStr('str_main_ftr', 'A:Read  B:Index  Sel:Theme');
  emitCStr('str_srch_code', 'SRCH');
  emitCStr('str_srch_title', isBibleMode ? 'Concordance Word Search' : 'Full-Text Search');
  emitCStr('str_srch_sub', ' Words  ');
  emitCStr('str_conc_hdr', isBibleMode ? 'Concordance' : 'Word Search');
  emitCStr('str_conc_prompt', '> ');
  emitCStr('str_conc_words_lbl', 'hits');
  emitCStr('str_key_del', '<-');
  emitCStr('str_key_ok', 'OK');
  emitCStr('str_conc_pk_ftr', 'A:Type B:Del St:Go L/R:Word');
  emitCStr('str_conc_res_ftr', 'A:Jump B:Word L/R:+/-25');

  // Official GBA Flashcart SRAM signature
  a.align(4);
  a.label('sram_id');
  a.emitBytes([
    0x53, 0x52, 0x41, 0x4d, 0x5f, 0x56, 0x31, 0x31, 0x33, 0x00, 0x00, 0x00,
  ]); // "SRAM_V113\0\0\0"

  return a.assemble();
}

interface BpeDictionary {
  dteTable: Uint8Array; // 240 bytes: 120 (left, right) pairs for 0x88..0xFF
  compressChapter: (raw: Uint8Array) => Uint8Array;
}

function trainBpeDictionary(rawChapters: Uint8Array[]): BpeDictionary {
  const MAX_RULES = 120; // 0x88..0xFF
  const MAX_DEPTH = 12; // max 12 stack frames (~96B) on GBA recursive expand
  const SAMPLE_BUDGET = 192 * 1024;

  // Build evenly sampled training buffer across all translations/chapters
  const totalBytes = rawChapters.reduce((s, c) => s + c.length, 0);
  const sampleChunks: Uint8Array[] = [];
  let sampleLen = 0;
  if (totalBytes <= SAMPLE_BUDGET) {
    for (const c of rawChapters) {
      if (c.length > 0) {
        sampleChunks.push(c);
        sampleLen += c.length;
      }
    }
  } else {
    const stride = Math.max(1, Math.floor(rawChapters.length / 400));
    for (let i = 0; i < rawChapters.length && sampleLen < SAMPLE_BUDGET; i += stride) {
      const c = rawChapters[i];
      if (c.length > 0) {
        sampleChunks.push(c);
        sampleLen += c.length;
      }
    }
  }

  let work = new Uint8Array(sampleLen);
  let wp = 0;
  for (const chunk of sampleChunks) {
    work.set(chunk, wp);
    wp += chunk.length;
  }
  let workLen = sampleLen;

  const dteTable = new Uint8Array(MAX_RULES * 2);
  const depth = new Uint8Array(256);
  const expanded: number[][] = Array.from({ length: 256 }, (_, i) => [i]);
  const pairCounts = new Int32Array(65536);

  let activeRules = 0;
  for (let rule = 0; rule < MAX_RULES; rule++) {
    if (workLen < 8) break;
    pairCounts.fill(0);

    let bestPair = -1;
    let bestCount = 3; // require >= 4 occurrences to be worth a dictionary slot
    for (let i = 0; i < workLen - 1; i++) {
      const a = work[i];
      const b = work[i + 1];
      if (a < 0x20 || b < 0x20) continue;
      if (depth[a] >= MAX_DEPTH || depth[b] >= MAX_DEPTH) continue;
      if (expanded[a].length + expanded[b].length > 24) continue;
      const key = (a << 8) | b;
      const c = (pairCounts[key] = pairCounts[key] + 1);
      if (c > bestCount) {
        bestCount = c;
        bestPair = key;
      }
    }

    if (bestPair < 0) break;
    const left = (bestPair >> 8) & 0xff;
    const right = bestPair & 0xff;
    const tok = 0x88 + rule;

    dteTable[rule * 2] = left;
    dteTable[rule * 2 + 1] = right;
    depth[tok] = Math.max(depth[left], depth[right]) + 1;
    expanded[tok] = [...expanded[left], ...expanded[right]];
    activeRules = rule + 1;

    // Compact work buffer in-place replacing (left, right) -> tok
    let writeIdx = 0;
    let readIdx = 0;
    while (readIdx < workLen) {
      if (readIdx + 1 < workLen && work[readIdx] === left && work[readIdx + 1] === right) {
        work[writeIdx++] = tok;
        readIdx += 2;
      } else {
        work[writeIdx++] = work[readIdx++];
      }
    }
    workLen = writeIdx;
  }

  // Index all active expansions by their first 2 uncompressed bytes, sorted longest-first
  interface PatternEntry {
    tok: number;
    pat: Uint8Array;
  }
  const buckets = new Array<PatternEntry[] | undefined>(65536);
  for (let r = 0; r < activeRules; r++) {
    const tok = 0x88 + r;
    const pat = Uint8Array.from(expanded[tok]);
    if (pat.length < 2) continue;
    const key = (pat[0] << 8) | pat[1];
    let list = buckets[key];
    if (!list) {
      list = [];
      buckets[key] = list;
    }
    list.push({ tok, pat });
  }
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i]) {
      buckets[i]!.sort((a, b) => b.pat.length - a.pat.length);
    }
  }

  // Reusable scratch buffer sized to largest chapter
  let scratch = new Uint8Array(4096);
  const compressChapter = (raw: Uint8Array): Uint8Array => {
    if (activeRules === 0 || raw.length < 2) return raw;
    if (scratch.length < raw.length) {
      scratch = new Uint8Array(Math.max(raw.length, scratch.length * 2));
    }
    let i = 0;
    let outLen = 0;
    const rawLen = raw.length;
    while (i < rawLen) {
      if (i + 1 < rawLen) {
        const list = buckets[(raw[i] << 8) | raw[i + 1]];
        if (list) {
          let matchedTok = -1;
          let matchedLen = 0;
          for (let k = 0; k < list.length; k++) {
            const entry = list[k];
            const pat = entry.pat;
            const pLen = pat.length;
            if (i + pLen > rawLen) continue;
            let ok = true;
            for (let j = 2; j < pLen; j++) {
              if (raw[i + j] !== pat[j]) {
                ok = false;
                break;
              }
            }
            if (ok) {
              matchedTok = entry.tok;
              matchedLen = pLen;
              break;
            }
          }
          if (matchedTok >= 0) {
            scratch[outLen++] = matchedTok;
            i += matchedLen;
            continue;
          }
        }
      }
      scratch[outLen++] = raw[i++];
    }
    return scratch.slice(0, outLen);
  };

  return { dteTable, compressChapter };
}

export function compileGbaRom(
  translationsInput: TranslationInput | TranslationInput[] | ParseReport,
  config: RomBuildConfig
): RomBuildResult {
  const inputs: TranslationInput[] = Array.isArray(translationsInput)
    ? translationsInput
    : 'report' in translationsInput
      ? [translationsInput]
      : [
          {
            code: (config.romTitle || 'BIBLE').split(/\s+/)[0].slice(0, 7) || 'BIBLE',
            name: config.romTitle || 'Holy Bible',
            report: translationsInput,
          },
        ];

  if (inputs.length === 0) {
    throw new Error('At least one Bible translation must be loaded to compile a .gba ROM.');
  }

  const firmware = compileFirmware(config);
  if (0xc0 + firmware.length > DATA_HEADER_OFFSET) {
    throw new Error(`Firmware exceeded reserved 32KB block: ${firmware.length} bytes`);
  }

  // Pre-encode every translation's books, raw chapters & uint16 sorted concordance index
  interface EncodedWord {
    word: string;
    hits: number[];
  }
  interface EncodedTranslation {
    code: string;
    name: string;
    report: ParseReport;
    ntStartBookIdx: number;
    totalChapters: number;
    chapFirstVerse: number[];
    rawChapterBlobs: Uint8Array[];
    compressedChapterBlobs: Uint8Array[];
    concWords: EncodedWord[];
    totalConcHits: number;
    bookTableOffset: number;
    chapTableOffset: number;
    chapVerseTableOffset: number;
    concWordTableOffset: number;
    concHitsTableOffset: number;
  }

  const encodedTranslations: EncodedTranslation[] = [];
  let cursorOffset = TRANS_TABLE_OFFSET + inputs.length * 64; // immediately after DTE_TABLE + transTable
  let totalBooksSum = 0;
  let totalChaptersSum = 0;
  let totalConcWordsSum = 0;
  let totalConcBytesSum = 0;
  const allRawChapters: Uint8Array[] = [];

  for (const input of inputs) {
    const books = input.report.books;
    const indexConcordance = input.includeConcordance !== false;
    let totalChapters = 0;
    let ntStartBookIdx = 0;
    let foundNt = false;
    let hasAnyBibleTestament = false;
    for (let i = 0; i < books.length; i++) {
      if (books[i].testament === 'OT' || books[i].testament === 'NT') {
        hasAnyBibleTestament = true;
      }
      if (!foundNt && books[i].testament === 'NT') {
        ntStartBookIdx = i;
        foundNt = true;
      }
      totalChapters += books[i].chapters.length;
    }

    const isProseBook =
      input.report.libraryMode === 'book' ||
      (input.report.libraryMode !== 'bible' && !hasAnyBibleTestament);

    const rawChapterBlobs: Uint8Array[] = [];
    const chapFirstVerse: number[] = [];
    const wordMap = new Map<string, number[]>();
    let chapVerseBase = 0;

    for (let bIdx = 0; bIdx < books.length; bIdx++) {
      const b = books[bIdx];
      for (let cIdx = 0; cIdx < b.chapters.length; cIdx++) {
        const ch = b.chapters[cIdx];
        chapFirstVerse.push(chapVerseBase);
        let maxVerseInChap = 0;
        const stream: number[] = [];

        ch.verses.forEach((v, idx) => {
          if (v.verse > maxVerseInChap) maxVerseInChap = v.verse;
          // Invisible structural unit anchor 0x04 <unitNum> 0x05 enables exact Search snippets & jumps for ALL books
          stream.push(0x04, ...encodeGbaStringBytes(String(v.verse)), 0x05);

          if (config.showVerseNumbers && !isProseBook) {
            stream.push(0x01);
            const numBytes = encodeGbaStringBytes(String(v.verse));
            stream.push(...numBytes);
            stream.push(0x02);
            stream.push(0x20);
          }
          stream.push(...encodeGbaStringBytes(v.text));
          if (idx < ch.verses.length - 1) {
            if (isProseBook) {
              stream.push(0x0a, 0x0b); // Paragraph break + runtime toggleable blank spacing
            } else {
              stream.push(0x03); // Runtime toggleable verse separator (prose space vs verse-per-line break)
            }
          }

          if (indexConcordance) {
            const globalVerseIdx = chapVerseBase + Math.max(0, v.verse - 1);
            if (globalVerseIdx > 0xffff) {
              throw new Error(
                `Volume "${input.code}" exceeded 65,535 indexed paragraphs/verses for 16-bit full-text search. Disable search indexing on this book or split it into volumes.`
              );
            }
            const cleaned = v.text.replace(/[\x01-\x0b]/g, ' ').replace(/['’]s\b/gi, '');
            const tokens = cleaned.match(/[A-Za-z]{2,}/g);
            if (tokens) {
              const seenInVerse = new Set<string>();
              for (const rawTok of tokens) {
                const w = rawTok.toLowerCase().slice(0, 15);
                if (w.length < 2 || CONCORDANCE_STOP_WORDS.has(w) || seenInVerse.has(w)) continue;
                seenInVerse.add(w);
                let arr = wordMap.get(w);
                if (!arr) {
                  arr = [];
                  wordMap.set(w, arr);
                }
                arr.push(globalVerseIdx);
              }
            }
          }
        });

        chapVerseBase += ch.verses.length === 0 ? 0 : Math.max(1, maxVerseInChap);
        if (chapVerseBase > 0x10000) {
          throw new Error(
            `Volume "${input.code}" paragraph numbering range exceeded 65,536 slots.`
          );
        }

        const rawBlob = Uint8Array.from(stream);
        rawChapterBlobs.push(rawBlob);
        allRawChapters.push(rawBlob);
      }
    }

    const sortedWords = Array.from(wordMap.keys()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const concWords: EncodedWord[] = [];
    let totalConcHits = 0;
    for (const w of sortedWords) {
      const hits = wordMap.get(w)!;
      concWords.push({ word: w, hits });
      totalConcHits += hits.length;
    }

    const bookTableOffset = cursorOffset;
    const chapTableOffset = bookTableOffset + books.length * 32;
    const chapVerseTableOffset = chapTableOffset + totalChapters * 8;
    const chapVerseBytesPadded = Math.ceil((totalChapters * 2) / 4) * 4;
    const concWordTableOffset = chapVerseTableOffset + chapVerseBytesPadded;
    const concHitsTableOffset = concWordTableOffset + concWords.length * 24;
    const concHitsBytesPadded = Math.ceil((totalConcHits * 2) / 4) * 4;
    cursorOffset = concHitsTableOffset + concHitsBytesPadded;

    const cleanCode = (input.code || 'BIBLE')
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 7) || 'BIBLE';
    const cleanName = (input.name || cleanCode).slice(0, 23);

    encodedTranslations.push({
      code: cleanCode,
      name: cleanName,
      report: input.report,
      ntStartBookIdx,
      totalChapters,
      chapFirstVerse,
      rawChapterBlobs,
      compressedChapterBlobs: [],
      concWords,
      totalConcHits,
      bookTableOffset,
      chapTableOffset,
      chapVerseTableOffset,
      concWordTableOffset,
      concHitsTableOffset,
    });

    totalBooksSum += books.length;
    totalChaptersSum += totalChapters;
    totalConcWordsSum += concWords.length;
    totalConcBytesSum += concWords.length * 24 + concHitsBytesPadded + chapVerseBytesPadded;
  }

  // Train shared 120-rule lossless BPE dictionary and compress every chapter blob
  const bpe = trainBpeDictionary(allRawChapters);
  let uncompressedTextBytes = 0;
  let compressedTextBytes = 0;
  for (const t of encodedTranslations) {
    t.compressedChapterBlobs = t.rawChapterBlobs.map((raw) => {
      uncompressedTextBytes += raw.length;
      const comp = bpe.compressChapter(raw);
      compressedTextBytes += comp.length;
      return comp;
    });
  }

  const rawRomSize = cursorOffset + compressedTextBytes;

  if (rawRomSize > MAX_GBA_ROM_BYTES) {
    throw new Error(
      `Combined payload (${(rawRomSize / (1024 * 1024)).toFixed(2)} MB) exceeds the 32.00 MB GBA cartridge hardware address space.`
    );
  }

  let finalRomSize = Math.max(32768, Math.ceil(rawRomSize / 4096) * 4096);
  if (config.padToPowerOfTwo) {
    let p = 32768;
    while (p < rawRomSize && p < MAX_GBA_ROM_BYTES) p *= 2;
    finalRomSize = Math.min(MAX_GBA_ROM_BYTES, p);
  }

  const rom = new Uint8Array(finalRomSize);
  rom.fill(0xff);

  // 1. Write 192-byte GBA Header (0x000..0x0BF)
  rom.fill(0x00, 0x000, 0x0c0);
  const dv = new DataView(rom.buffer);
  dv.setUint32(0x000, 0xea00002e, true); // B 0x080000C0
  rom.set(NINTENDO_LOGO, 0x004);

  const cleanTitle = (config.romTitle || 'HOLY BIBLE')
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .slice(0, 12);
  for (let i = 0; i < 12; i++) {
    rom[0x0a0 + i] = i < cleanTitle.length ? cleanTitle.charCodeAt(i) : 0x00;
  }

  const cleanGameCode = (config.gameCode || 'BHBL')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, 'X')
    .padEnd(4, 'B')
    .slice(0, 4);
  for (let i = 0; i < 4; i++) {
    rom[0x0ac + i] = cleanGameCode.charCodeAt(i);
  }

  rom[0x0b0] = 0x30; // Maker "01"
  rom[0x0b1] = 0x31;
  rom[0x0b2] = 0x96; // Fixed GBA BIOS check byte

  let chk = 0;
  for (let i = 0x0a0; i <= 0x0bc; i++) {
    chk = (chk - rom[i]) & 0xff;
  }
  chk = (chk - 0x19) & 0xff;
  rom[0x0bd] = chk;

  // 2. Write ARM7TDMI Firmware at 0x0C0
  rom.set(firmware, 0x0c0);

  // 3. Write Multi-Translation Data Header at DATA_HEADER_OFFSET (0x008000) + 240B BPE Dictionary
  const charWidth = config.fontStyle === '8x8' ? 8 : 6;
  const colsPerLine = config.fontStyle === '8x8' ? 28 : 38;
  const lineHeight = config.lineSpacing === 'compact' ? 8 : 9;
  const linesPerPage = config.lineSpacing === 'compact' ? 16 : 14;
  const xStart = config.fontStyle === '8x8' ? 8 : 6;

  dv.setUint32(DATA_HEADER_OFFSET + 0, 0x42535645, true); // "ESVB"
  dv.setUint32(DATA_HEADER_OFFSET + 4, encodedTranslations.length, true); // numTranslations
  dv.setUint32(DATA_HEADER_OFFSET + 8, 0x08000000 + TRANS_TABLE_OFFSET, true); // transTablePtr
  dv.setUint32(DATA_HEADER_OFFSET + 12, config.defaultThemeIndex & 3, true);
  dv.setUint32(DATA_HEADER_OFFSET + 16, charWidth, true);
  dv.setUint32(DATA_HEADER_OFFSET + 20, colsPerLine, true);
  dv.setUint32(DATA_HEADER_OFFSET + 24, linesPerPage, true);
  dv.setUint32(DATA_HEADER_OFFSET + 28, lineHeight, true);
  dv.setUint32(DATA_HEADER_OFFSET + 32, config.showVerseNumbers ? 1 : 0, true);
  dv.setUint32(DATA_HEADER_OFFSET + 36, xStart, true);

  // Store null-terminated ROM display title at DATA_HEADER_OFFSET + 40..55 (16 bytes)
  const titleBytes = encodeGbaStringBytes(cleanTitle || 'HOLY BIBLE');
  for (let i = 0; i < 16; i++) {
    rom[DATA_HEADER_OFFSET + 40 + i] = i < titleBytes.length ? titleBytes[i] : 0;
  }
  dv.setUint32(DATA_HEADER_OFFSET + 56, config.bootToMain ? 1 : 0, true);
  dv.setUint32(DATA_HEADER_OFFSET + 60, config.verseLayout === 'verse-per-line' ? 1 : 0, true);

  // Write 240-byte BPE bigram table at DTE_TABLE_OFFSET
  rom.set(bpe.dteTable, DTE_TABLE_OFFSET);

  // 4. Write Translation Table, Book Tables, Chapter Tables, chapFirstVerse, Concordance & Compressed Text Blobs
  let textCursor = cursorOffset;

  for (let tIdx = 0; tIdx < encodedTranslations.length; tIdx++) {
    const t = encodedTranslations[tIdx];
    const tOff = TRANS_TABLE_OFFSET + tIdx * 64;

    const codeBytes = encodeGbaStringBytes(t.code.slice(0, 7));
    for (let i = 0; i < 8; i++) {
      rom[tOff + TE_CODE + i] = i < codeBytes.length ? codeBytes[i] : 0;
    }

    const nameBytes = encodeGbaStringBytes(t.name.slice(0, 23));
    for (let i = 0; i < 24; i++) {
      rom[tOff + TE_NAME + i] = i < nameBytes.length ? nameBytes[i] : 0;
    }

    dv.setUint16(tOff + TE_NUM_BOOKS, t.report.books.length, true);
    dv.setUint16(tOff + TE_NT_START, t.ntStartBookIdx, true);
    dv.setUint32(tOff + TE_TOTAL_CHAPS, t.totalChapters, true);
    dv.setUint32(tOff + TE_CV_PTR, 0x08000000 + t.chapVerseTableOffset, true);
    dv.setUint32(tOff + TE_BOOK_PTR, 0x08000000 + t.bookTableOffset, true);
    dv.setUint32(tOff + TE_CHAP_PTR, 0x08000000 + t.chapTableOffset, true);
    dv.setUint32(tOff + TE_TOTAL_VERSES, t.report.totalVerses, true);
    dv.setUint32(tOff + TE_CONC_WORDS, t.concWords.length, true);
    dv.setUint32(tOff + TE_CONC_PTR, 0x08000000 + t.concWordTableOffset, true);

    // Write uint16 chapFirstVerse[] lookup table
    for (let c = 0; c < t.chapFirstVerse.length; c++) {
      dv.setUint16(t.chapVerseTableOffset + c * 2, t.chapFirstVerse[c], true);
    }

    // Write sorted Concordance WordEntry (24B) + uint16 globalVerseIdx HitEntry (2B) tables
    let hitByteOffset = t.concHitsTableOffset;
    for (let wIdx = 0; wIdx < t.concWords.length; wIdx++) {
      const entry = t.concWords[wIdx];
      const wOff = t.concWordTableOffset + wIdx * 24;
      for (let i = 0; i < 16; i++) {
        rom[wOff + i] = i < entry.word.length ? entry.word.charCodeAt(i) : 0;
      }
      dv.setUint32(wOff + 16, 0x08000000 + hitByteOffset, true);
      dv.setUint32(wOff + 20, entry.hits.length, true);
      for (let hIdx = 0; hIdx < entry.hits.length; hIdx++) {
        dv.setUint16(hitByteOffset + hIdx * 2, entry.hits[hIdx], true);
      }
      hitByteOffset += entry.hits.length * 2;
    }

    let chapIdx = 0;
    for (let bIdx = 0; bIdx < t.report.books.length; bIdx++) {
      const book = t.report.books[bIdx];
      const bOff = t.bookTableOffset + bIdx * 32;
      const bNameBytes = encodeGbaStringBytes(book.name.slice(0, 23));
      for (let i = 0; i < 24; i++) {
        rom[bOff + i] = i < bNameBytes.length ? bNameBytes[i] : 0;
      }
      dv.setUint16(bOff + 24, book.chapters.length, true);
      dv.setUint16(bOff + 26, chapIdx, true);
      const abbr = book.abbrev.slice(0, 4).padEnd(4, ' ');
      for (let i = 0; i < 4; i++) {
        rom[bOff + 28 + i] = abbr.charCodeAt(i);
      }

      for (let cIdx = 0; cIdx < book.chapters.length; cIdx++) {
        const blob = t.compressedChapterBlobs[chapIdx];
        const cOff = t.chapTableOffset + chapIdx * 8;
        dv.setUint32(cOff + 0, 0x08000000 + textCursor, true);
        dv.setUint32(cOff + 4, blob.length, true);
        rom.set(blob, textCursor);
        textCursor += blob.length;
        chapIdx++;
      }
    }
  }

  const safeSlug = (config.romTitle || 'holy_bible')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return {
    rom,
    fileName: `${safeSlug || 'holy_bible'}.gba`,
    romSizeBytes: finalRomSize,
    codeSizeBytes: firmware.length,
    dataSizeBytes: rawRomSize - DATA_HEADER_OFFSET,
    uncompressedTextBytes,
    compressedTextBytes,
    headerChecksum: chk,
    globalCrc32: computeCrc32(rom),
    translationsEncoded: encodedTranslations.length,
    booksEncoded: totalBooksSum,
    chaptersEncoded: totalChaptersSum,
    concordanceWordsEncoded: totalConcWordsSum,
    concordanceBytes: totalConcBytesSum,
  };
}
