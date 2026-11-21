export type Cond =
  | 'EQ'
  | 'NE'
  | 'HS'
  | 'LO'
  | 'MI'
  | 'PL'
  | 'VS'
  | 'VC'
  | 'HI'
  | 'LS'
  | 'GE'
  | 'LT'
  | 'GT'
  | 'LE'
  | 'AL';

const COND_CODE: Record<Cond, number> = {
  EQ: 0x0,
  NE: 0x1,
  HS: 0x2,
  LO: 0x3,
  MI: 0x4,
  PL: 0x5,
  VS: 0x6,
  VC: 0x7,
  HI: 0x8,
  LS: 0x9,
  GE: 0xa,
  LT: 0xb,
  GT: 0xc,
  LE: 0xd,
  AL: 0xe,
};

export type Reg = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export const R0: Reg = 0;
export const R1: Reg = 1;
export const R2: Reg = 2;
export const R3: Reg = 3;
export const R4: Reg = 4;
export const R5: Reg = 5;
export const R6: Reg = 6;
export const R7: Reg = 7;
export const R8: Reg = 8;
export const R9: Reg = 9;
export const R10: Reg = 10;
export const R11: Reg = 11;
export const R12: Reg = 12;
export const SP: Reg = 13;
export const LR: Reg = 14;
export const PC: Reg = 15;

function encodeArmImm(val: number): number | null {
  const u = val >>> 0;
  for (let rot = 0; rot < 16; rot++) {
    const shift = rot * 2;
    const rotated = shift === 0 ? u : ((u << shift) | (u >>> (32 - shift))) >>> 0;
    if (rotated <= 0xff) {
      return (rot << 8) | rotated;
    }
  }
  return null;
}

interface Fixup {
  wordIndex: number;
  kind: 'branch' | 'ldr_pc' | 'adr' | 'word_ptr';
  target: string;
  cond?: Cond;
  link?: boolean;
  rd?: Reg;
}

export class ArmAssembler {
  private words: number[] = [];
  private labels = new Map<string, number>();
  private fixups: Fixup[] = [];
  private literals: Array<{ value: number; label: string }> = [];
  private labelLiterals: Array<{ target: string; litLabel: string }> = [];
  private literalCounter = 0;
  public readonly baseAddress: number;

  constructor(baseAddress = 0x080000c0) {
    this.baseAddress = baseAddress;
  }

  get currentOffset(): number {
    return this.words.length * 4;
  }

  get currentAddress(): number {
    return this.baseAddress + this.currentOffset;
  }

  label(name: string): this {
    if (this.labels.has(name)) {
      throw new Error(`Duplicate ARM label: ${name}`);
    }
    this.labels.set(name, this.currentOffset);
    return this;
  }

  emitWord(word: number): this {
    this.words.push(word >>> 0);
    return this;
  }

  emitWordLabel(targetLabel: string): this {
    const idx = this.words.length;
    this.words.push(0);
    this.fixups.push({ wordIndex: idx, kind: 'word_ptr', target: targetLabel });
    return this;
  }

  emitBytes(bytes: Uint8Array | number[]): this {
    const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const pad = (4 - (arr.length % 4)) % 4;
    for (let i = 0; i < arr.length; i += 4) {
      const b0 = arr[i] ?? 0;
      const b1 = arr[i + 1] ?? 0;
      const b2 = arr[i + 2] ?? 0;
      const b3 = arr[i + 3] ?? 0;
      this.emitWord(b0 | (b1 << 8) | (b2 << 16) | (b3 << 24));
    }
    if (pad > 0 && arr.length % 4 === 0) {
      // already aligned
    }
    return this;
  }

  align(bytes: number): this {
    while (this.currentOffset % bytes !== 0) {
      this.emitWord(0);
    }
    return this;
  }

  private dp(
    cond: Cond,
    opcode: number,
    s: number,
    rn: Reg,
    rd: Reg,
    iBit: number,
    op2: number
  ): this {
    const c = COND_CODE[cond];
    const word = (c << 28) | (iBit << 25) | (opcode << 21) | (s << 20) | (rn << 16) | (rd << 12) | (op2 & 0xfff);
    return this.emitWord(word);
  }

  mov(rd: Reg, rm: Reg, cond: Cond = 'AL'): this {
    return this.dp(cond, 13, 0, 0, rd, 0, rm);
  }

  movImm(rd: Reg, imm: number, cond: Cond = 'AL'): this {
    const enc = encodeArmImm(imm);
    if (enc !== null) {
      return this.dp(cond, 13, 0, 0, rd, 1, enc);
    }
    const inv = encodeArmImm(~imm >>> 0);
    if (inv !== null) {
      return this.dp(cond, 15, 0, 0, rd, 1, inv);
    }
    return this.ldrLit(rd, imm, cond);
  }

  ldrLit(rd: Reg, val: number, cond: Cond = 'AL'): this {
    const u = val >>> 0;
    let existing = this.literals.find((l) => l.value === u);
    if (!existing) {
      existing = { value: u, label: `__lit_${this.literalCounter++}` };
      this.literals.push(existing);
    }
    return this.ldrLabel(rd, existing.label, cond);
  }

  ldrLabelAddr(rd: Reg, targetLabel: string, cond: Cond = 'AL'): this {
    let existing = this.labelLiterals.find((l) => l.target === targetLabel);
    if (!existing) {
      existing = { target: targetLabel, litLabel: `__addr_${this.literalCounter++}` };
      this.labelLiterals.push(existing);
    }
    return this.ldrLabel(rd, existing.litLabel, cond);
  }

  flushLiterals(): this {
    for (const lit of this.literals) {
      this.label(lit.label);
      this.emitWord(lit.value);
    }
    this.literals = [];
    for (const llit of this.labelLiterals) {
      this.label(llit.litLabel);
      this.emitWordLabel(llit.target);
    }
    this.labelLiterals = [];
    return this;
  }

  addImm(rd: Reg, rn: Reg, imm: number, cond: Cond = 'AL', setFlags = false): this {
    const enc = encodeArmImm(imm);
    if (enc === null) throw new Error(`addImm out of ARM immediate range: ${imm}`);
    return this.dp(cond, 4, setFlags ? 1 : 0, rn, rd, 1, enc);
  }

  subImm(rd: Reg, rn: Reg, imm: number, cond: Cond = 'AL', setFlags = false): this {
    const enc = encodeArmImm(imm);
    if (enc === null) throw new Error(`subImm out of ARM immediate range: ${imm}`);
    return this.dp(cond, 2, setFlags ? 1 : 0, rn, rd, 1, enc);
  }

  addReg(rd: Reg, rn: Reg, rm: Reg, shiftType: 0 | 1 | 2 | 3 = 0, shiftAmt = 0, cond: Cond = 'AL'): this {
    const op2 = ((shiftAmt & 0x1f) << 7) | (shiftType << 5) | rm;
    return this.dp(cond, 4, 0, rn, rd, 0, op2);
  }

  subReg(rd: Reg, rn: Reg, rm: Reg, cond: Cond = 'AL'): this {
    return this.dp(cond, 2, 0, rn, rd, 0, rm);
  }

  rsbImm(rd: Reg, rn: Reg, imm: number, cond: Cond = 'AL'): this {
    const enc = encodeArmImm(imm);
    if (enc === null) throw new Error(`rsbImm out of range: ${imm}`);
    return this.dp(cond, 3, 0, rn, rd, 1, enc);
  }

  andImm(rd: Reg, rn: Reg, imm: number, cond: Cond = 'AL'): this {
    const enc = encodeArmImm(imm);
    if (enc === null) throw new Error(`andImm out of range: ${imm}`);
    return this.dp(cond, 0, 0, rn, rd, 1, enc);
  }

  andReg(rd: Reg, rn: Reg, rm: Reg, cond: Cond = 'AL'): this {
    return this.dp(cond, 0, 0, rn, rd, 0, rm);
  }

  orrImm(rd: Reg, rn: Reg, imm: number, cond: Cond = 'AL'): this {
    const enc = encodeArmImm(imm);
    if (enc === null) throw new Error(`orrImm out of range: ${imm}`);
    return this.dp(cond, 12, 0, rn, rd, 1, enc);
  }

  orrReg(rd: Reg, rn: Reg, rm: Reg, shiftType: 0 | 1 | 2 | 3 = 0, shiftAmt = 0, cond: Cond = 'AL'): this {
    const op2 = ((shiftAmt & 0x1f) << 7) | (shiftType << 5) | rm;
    return this.dp(cond, 12, 0, rn, rd, 0, op2);
  }

  eorImm(rd: Reg, rn: Reg, imm: number, cond: Cond = 'AL'): this {
    const enc = encodeArmImm(imm);
    if (enc === null) throw new Error(`eorImm out of range: ${imm}`);
    return this.dp(cond, 1, 0, rn, rd, 1, enc);
  }

  lslImm(rd: Reg, rm: Reg, shift: number, cond: Cond = 'AL'): this {
    const op2 = ((shift & 0x1f) << 7) | rm;
    return this.dp(cond, 13, 0, 0, rd, 0, op2);
  }

  lsrImm(rd: Reg, rm: Reg, shift: number, cond: Cond = 'AL'): this {
    const s = shift === 32 ? 0 : shift & 0x1f;
    const op2 = (s << 7) | (1 << 5) | rm;
    return this.dp(cond, 13, 0, 0, rd, 0, op2);
  }

  cmpImm(rn: Reg, imm: number, cond: Cond = 'AL'): this {
    const enc = encodeArmImm(imm);
    if (enc === null) throw new Error(`cmpImm out of range: ${imm}`);
    return this.dp(cond, 10, 1, rn, 0, 1, enc);
  }

  cmpReg(rn: Reg, rm: Reg, cond: Cond = 'AL'): this {
    return this.dp(cond, 10, 1, rn, 0, 0, rm);
  }

  tstImm(rn: Reg, imm: number, cond: Cond = 'AL'): this {
    const enc = encodeArmImm(imm);
    if (enc === null) throw new Error(`tstImm out of range: ${imm}`);
    return this.dp(cond, 8, 1, rn, 0, 1, enc);
  }

  tstReg(rn: Reg, rm: Reg, cond: Cond = 'AL'): this {
    return this.dp(cond, 8, 1, rn, 0, 0, rm);
  }

  mul(rd: Reg, rm: Reg, rs: Reg, cond: Cond = 'AL'): this {
    if (rd === rm) {
      throw new Error(`ARM7TDMI MUL requires Rd (${rd}) != Rm (${rm})`);
    }
    const c = COND_CODE[cond];
    return this.emitWord((c << 28) | (rd << 16) | (rs << 8) | (0b1001 << 4) | rm);
  }

  private memTransfer(
    cond: Cond,
    isLoad: number,
    isByte: number,
    rd: Reg,
    rn: Reg,
    offset: number
  ): this {
    if (Math.abs(offset) > 4095) {
      throw new Error(`LDR/STR offset out of range: ${offset}`);
    }
    const c = COND_CODE[cond];
    const u = offset >= 0 ? 1 : 0;
    const absOff = Math.abs(offset) & 0xfff;
    const word = (c << 28) | (1 << 26) | (1 << 24) | (u << 23) | (isByte << 22) | (isLoad << 20) | (rn << 16) | (rd << 12) | absOff;
    return this.emitWord(word);
  }

  ldr(rd: Reg, rn: Reg, offset = 0, cond: Cond = 'AL'): this {
    return this.memTransfer(cond, 1, 0, rd, rn, offset);
  }

  str(rd: Reg, rn: Reg, offset = 0, cond: Cond = 'AL'): this {
    return this.memTransfer(cond, 0, 0, rd, rn, offset);
  }

  ldrb(rd: Reg, rn: Reg, offset = 0, cond: Cond = 'AL'): this {
    return this.memTransfer(cond, 1, 1, rd, rn, offset);
  }

  strb(rd: Reg, rn: Reg, offset = 0, cond: Cond = 'AL'): this {
    return this.memTransfer(cond, 0, 1, rd, rn, offset);
  }

  ldrRegOffset(rd: Reg, rn: Reg, rm: Reg, shiftAmt = 0, isByte = false, cond: Cond = 'AL'): this {
    const c = COND_CODE[cond];
    const op2 = ((shiftAmt & 0x1f) << 7) | rm;
    const word = (c << 28) | (1 << 26) | (1 << 25) | (1 << 24) | (1 << 23) | ((isByte ? 1 : 0) << 22) | (1 << 20) | (rn << 16) | (rd << 12) | op2;
    return this.emitWord(word);
  }

  strRegOffset(rd: Reg, rn: Reg, rm: Reg, shiftAmt = 0, isByte = false, cond: Cond = 'AL'): this {
    const c = COND_CODE[cond];
    const op2 = ((shiftAmt & 0x1f) << 7) | rm;
    const word = (c << 28) | (1 << 26) | (1 << 25) | (1 << 24) | (1 << 23) | ((isByte ? 1 : 0) << 22) | (0 << 20) | (rn << 16) | (rd << 12) | op2;
    return this.emitWord(word);
  }

  ldrbReg(rd: Reg, rn: Reg, rm: Reg, cond: Cond = 'AL'): this {
    return this.ldrRegOffset(rd, rn, rm, 0, true, cond);
  }

  strbReg(rd: Reg, rn: Reg, rm: Reg, cond: Cond = 'AL'): this {
    return this.strRegOffset(rd, rn, rm, 0, true, cond);
  }

  ldrh(rd: Reg, rn: Reg, offset = 0, cond: Cond = 'AL'): this {
    if (Math.abs(offset) > 255) throw new Error(`LDRH offset out of range: ${offset}`);
    const c = COND_CODE[cond];
    const u = offset >= 0 ? 1 : 0;
    const abs = Math.abs(offset) & 0xff;
    const word = (c << 28) | (1 << 24) | (u << 23) | (1 << 22) | (1 << 20) | (rn << 16) | (rd << 12) | ((abs >> 4) << 8) | 0xb0 | (abs & 0xf);
    return this.emitWord(word);
  }

  strh(rd: Reg, rn: Reg, offset = 0, cond: Cond = 'AL'): this {
    if (Math.abs(offset) > 255) throw new Error(`STRH offset out of range: ${offset}`);
    const c = COND_CODE[cond];
    const u = offset >= 0 ? 1 : 0;
    const abs = Math.abs(offset) & 0xff;
    const word = (c << 28) | (1 << 24) | (u << 23) | (1 << 22) | (0 << 20) | (rn << 16) | (rd << 12) | ((abs >> 4) << 8) | 0xb0 | (abs & 0xf);
    return this.emitWord(word);
  }

  ldrhReg(rd: Reg, rn: Reg, rm: Reg, cond: Cond = 'AL'): this {
    const c = COND_CODE[cond];
    const word = (c << 28) | (1 << 24) | (1 << 23) | (1 << 20) | (rn << 16) | (rd << 12) | 0xb0 | rm;
    return this.emitWord(word);
  }

  strhReg(rd: Reg, rn: Reg, rm: Reg, cond: Cond = 'AL'): this {
    const c = COND_CODE[cond];
    const word = (c << 28) | (1 << 24) | (1 << 23) | (0 << 20) | (rn << 16) | (rd << 12) | 0xb0 | rm;
    return this.emitWord(word);
  }

  push(regs: Reg[], cond: Cond = 'AL'): this {
    const mask = regs.reduce<number>((acc, r) => acc | (1 << r), 0);
    const c = COND_CODE[cond];
    return this.emitWord((c << 28) | (0b10010010 << 20) | (SP << 16) | mask);
  }

  pop(regs: Reg[], cond: Cond = 'AL'): this {
    const mask = regs.reduce<number>((acc, r) => acc | (1 << r), 0);
    const c = COND_CODE[cond];
    return this.emitWord((c << 28) | (0b10001011 << 20) | (SP << 16) | mask);
  }

  b(target: string, cond: Cond = 'AL'): this {
    const idx = this.words.length;
    this.words.push(0);
    this.fixups.push({ wordIndex: idx, kind: 'branch', target, cond, link: false });
    return this;
  }

  bl(target: string, cond: Cond = 'AL'): this {
    const idx = this.words.length;
    this.words.push(0);
    this.fixups.push({ wordIndex: idx, kind: 'branch', target, cond, link: true });
    return this;
  }

  bx(rn: Reg, cond: Cond = 'AL'): this {
    const c = COND_CODE[cond];
    return this.emitWord((c << 28) | 0x012fff10 | rn);
  }

  ldrLabel(rd: Reg, target: string, cond: Cond = 'AL'): this {
    const idx = this.words.length;
    this.words.push(0);
    this.fixups.push({ wordIndex: idx, kind: 'ldr_pc', target, cond, rd });
    return this;
  }

  adr(rd: Reg, target: string, cond: Cond = 'AL'): this {
    const idx = this.words.length;
    this.words.push(0);
    this.fixups.push({ wordIndex: idx, kind: 'adr', target, cond, rd });
    return this;
  }

  assemble(): Uint8Array {
    if (this.literals.length > 0 || this.labelLiterals.length > 0) {
      this.flushLiterals();
    }

    for (const f of this.fixups) {
      const targetOff = this.labels.get(f.target);
      if (targetOff === undefined) {
        throw new Error(`Undefined ARM label: "${f.target}"`);
      }
      const instrOff = f.wordIndex * 4;
      const pcOff = instrOff + 8;

      if (f.kind === 'branch') {
        const relBytes = targetOff - pcOff;
        if (relBytes < -33554432 || relBytes > 33554428) {
          throw new Error(`Branch to "${f.target}" out of range: ${relBytes}`);
        }
        const imm24 = (relBytes >> 2) & 0x00ffffff;
        const c = COND_CODE[f.cond ?? 'AL'];
        const lBit = f.link ? 1 << 24 : 0;
        this.words[f.wordIndex] = ((c << 28) | (0b101 << 25) | lBit | imm24) >>> 0;
      } else if (f.kind === 'ldr_pc') {
        const rel = targetOff - pcOff;
        if (Math.abs(rel) > 4095) {
          throw new Error(`PC-relative LDR to "${f.target}" out of range: ${rel}`);
        }
        const c = COND_CODE[f.cond ?? 'AL'];
        const u = rel >= 0 ? 1 : 0;
        const abs = Math.abs(rel) & 0xfff;
        this.words[f.wordIndex] =
          ((c << 28) | (1 << 26) | (1 << 24) | (u << 23) | (1 << 20) | (PC << 16) | ((f.rd ?? 0) << 12) | abs) >>> 0;
      } else if (f.kind === 'adr') {
        const rel = targetOff - pcOff;
        const abs = Math.abs(rel);
        const enc = encodeArmImm(abs);
        if (enc === null) {
          throw new Error(`ADR offset to "${f.target}" cannot be encoded as ARM immediate: ${rel}`);
        }
        const c = COND_CODE[f.cond ?? 'AL'];
        const op = rel >= 0 ? 4 : 2; // ADD or SUB
        this.words[f.wordIndex] = ((c << 28) | (1 << 25) | (op << 21) | (PC << 16) | ((f.rd ?? 0) << 12) | enc) >>> 0;
      } else if (f.kind === 'word_ptr') {
        this.words[f.wordIndex] = (this.baseAddress + targetOff) >>> 0;
      }
    }

    const out = new Uint8Array(this.words.length * 4);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < this.words.length; i++) {
      dv.setUint32(i * 4, this.words[i], true);
    }
    return out;
  }
}
