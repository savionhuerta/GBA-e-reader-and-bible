export type GbaButton =
  | 'A'
  | 'B'
  | 'SELECT'
  | 'START'
  | 'RIGHT'
  | 'LEFT'
  | 'UP'
  | 'DOWN'
  | 'R'
  | 'L';

const BUTTON_BIT: Record<GbaButton, number> = {
  A: 0,
  B: 1,
  SELECT: 2,
  START: 3,
  RIGHT: 4,
  LEFT: 5,
  UP: 6,
  DOWN: 7,
  R: 8,
  L: 9,
};

export class GbaEmulator {
  private rom: Uint8Array;
  private ewram = new Uint8Array(256 * 1024);
  private iwram = new Uint8Array(32 * 1024);
  private pal = new Uint8Array(1024);
  private vram = new Uint8Array(96 * 1024);
  public sram = new Uint8Array(64 * 1024);

  private regs = new Uint32Array(16);
  private flagN = false;
  private flagZ = false;
  private flagC = false;
  private flagV = false;

  private dispcnt = 0x0404;
  private vcount = 0;
  private keyMask = 0x03ff; // active-low: bit=1 means released, bit=0 means pressed

  private frameBuffer = new Uint8ClampedArray(240 * 160 * 4);
  private sramDirty = false;
  private onSramSave?: (sram: Uint8Array) => void;

  public totalInstructions = 0;
  public lastError: string | null = null;

  constructor(rom: Uint8Array, initialSram?: Uint8Array, onSramSave?: (sram: Uint8Array) => void) {
    this.rom = rom;
    this.sram.fill(0xff);
    if (initialSram) {
      this.sram.set(initialSram.subarray(0, this.sram.length));
    }
    this.onSramSave = onSramSave;
    this.reset();
  }

  reset(): void {
    this.ewram.fill(0);
    this.iwram.fill(0);
    this.pal.fill(0);
    this.vram.fill(0);
    this.regs.fill(0);
    this.regs[13] = 0x03007f00; // SP
    this.regs[15] = 0x08000000; // PC
    this.flagN = false;
    this.flagZ = false;
    this.flagC = false;
    this.flagV = false;
    this.dispcnt = 0x0404;
    this.vcount = 0;
    this.totalInstructions = 0;
    this.lastError = null;
  }

  setButton(btn: GbaButton, pressed: boolean): void {
    const bit = 1 << BUTTON_BIT[btn];
    if (pressed) {
      this.keyMask &= ~bit;
    } else {
      this.keyMask |= bit;
    }
  }

  releaseAllButtons(): void {
    this.keyMask = 0x03ff;
  }

  private read8(addr: number): number {
    const a = addr >>> 0;
    const region = a >>> 24;
    if (region === 0x08 || region === 0x09) {
      const off = a - 0x08000000;
      return off < this.rom.length ? this.rom[off] : 0xff;
    }
    if (region === 0x02) return this.ewram[a & 0x3ffff];
    if (region === 0x03) return this.iwram[a & 0x7fff];
    if (region === 0x05) return this.pal[a & 0x3ff];
    if (region === 0x06) {
      let off = a & 0x1ffff;
      if (off >= 0x18000) off -= 0x8000;
      return this.vram[off];
    }
    if (region === 0x0e) return this.sram[a & 0xffff];
    if (region === 0x04) {
      const io = a & 0x3ff;
      if (io === 0x000) return this.dispcnt & 0xff;
      if (io === 0x001) return (this.dispcnt >> 8) & 0xff;
      if (io === 0x006) return this.vcount & 0xff;
      if (io === 0x007) return (this.vcount >> 8) & 0xff;
      if (io === 0x130) return this.keyMask & 0xff;
      if (io === 0x131) return (this.keyMask >> 8) & 0xff;
    }
    return 0;
  }

  private read16(addr: number): number {
    const a = (addr & ~1) >>> 0;
    return this.read8(a) | (this.read8(a + 1) << 8);
  }

  private read32(addr: number): number {
    const a = (addr & ~3) >>> 0;
    const region = a >>> 24;
    if (region === 0x08 || region === 0x09) {
      const off = a - 0x08000000;
      if (off + 3 < this.rom.length) {
        return (
          (this.rom[off] |
            (this.rom[off + 1] << 8) |
            (this.rom[off + 2] << 16) |
            (this.rom[off + 3] << 24)) >>>
          0
        );
      }
    }
    return (
      (this.read8(a) |
        (this.read8(a + 1) << 8) |
        (this.read8(a + 2) << 16) |
        (this.read8(a + 3) << 24)) >>>
      0
    );
  }

  private write8(addr: number, val: number): void {
    const a = addr >>> 0;
    const v = val & 0xff;
    const region = a >>> 24;
    if (region === 0x02) {
      this.ewram[a & 0x3ffff] = v;
    } else if (region === 0x03) {
      this.iwram[a & 0x7fff] = v;
    } else if (region === 0x0e) {
      this.sram[a & 0xffff] = v;
      this.sramDirty = true;
    } else if (region === 0x05) {
      // GBA ignores 8-bit writes to Palette/VRAM, mirrors halfword on real hardware
      const off = a & 0x3fe;
      this.pal[off] = v;
      this.pal[off + 1] = v;
    } else if (region === 0x06) {
      let off = a & 0x1fffe;
      if (off >= 0x18000) off -= 0x8000;
      this.vram[off] = v;
      this.vram[off + 1] = v;
    }
  }

  private write16(addr: number, val: number): void {
    const a = (addr & ~1) >>> 0;
    const v = val & 0xffff;
    const region = a >>> 24;
    if (region === 0x02) {
      const off = a & 0x3ffff;
      this.ewram[off] = v & 0xff;
      this.ewram[off + 1] = (v >> 8) & 0xff;
    } else if (region === 0x03) {
      const off = a & 0x7fff;
      this.iwram[off] = v & 0xff;
      this.iwram[off + 1] = (v >> 8) & 0xff;
    } else if (region === 0x05) {
      const off = a & 0x3ff;
      this.pal[off] = v & 0xff;
      this.pal[off + 1] = (v >> 8) & 0xff;
    } else if (region === 0x06) {
      let off = a & 0x1ffff;
      if (off >= 0x18000) off -= 0x8000;
      this.vram[off] = v & 0xff;
      this.vram[off + 1] = (v >> 8) & 0xff;
    } else if (region === 0x04) {
      const io = a & 0x3ff;
      if (io === 0x000) this.dispcnt = v;
    } else if (region === 0x0e) {
      this.sram[a & 0xffff] = v & 0xff;
      this.sramDirty = true;
    }
  }

  private write32(addr: number, val: number): void {
    const a = (addr & ~3) >>> 0;
    const v = val >>> 0;
    this.write16(a, v & 0xffff);
    this.write16(a + 2, (v >>> 16) & 0xffff);
  }

  private checkCond(cond: number): boolean {
    switch (cond) {
      case 0x0:
        return this.flagZ;
      case 0x1:
        return !this.flagZ;
      case 0x2:
        return this.flagC;
      case 0x3:
        return !this.flagC;
      case 0x4:
        return this.flagN;
      case 0x5:
        return !this.flagN;
      case 0x6:
        return this.flagV;
      case 0x7:
        return !this.flagV;
      case 0x8:
        return this.flagC && !this.flagZ;
      case 0x9:
        return !this.flagC || this.flagZ;
      case 0xa:
        return this.flagN === this.flagV;
      case 0xb:
        return this.flagN !== this.flagV;
      case 0xc:
        return !this.flagZ && this.flagN === this.flagV;
      case 0xd:
        return this.flagZ || this.flagN !== this.flagV;
      case 0xe:
        return true;
      default:
        return false;
    }
  }

  private ror32(val: number, shift: number): number {
    const s = shift & 31;
    if (s === 0) return val >>> 0;
    return ((val >>> s) | (val << (32 - s))) >>> 0;
  }

  private addWithFlags(a: number, b: number, carryIn: number, setFlags: boolean): number {
    const ua = a >>> 0;
    const ub = b >>> 0;
    const sum = ua + ub + carryIn;
    const res = sum >>> 0;
    if (setFlags) {
      this.flagN = (res & 0x80000000) !== 0;
      this.flagZ = res === 0;
      this.flagC = sum > 0xffffffff;
      this.flagV = ((~(ua ^ ub) & (ua ^ res)) & 0x80000000) !== 0;
    }
    return res;
  }

  private subWithFlags(a: number, b: number, borrowIn: number, setFlags: boolean): number {
    // a - b - borrowIn = a + ~b + (1 - borrowIn)
    const ua = a >>> 0;
    const ub = b >>> 0;
    const diff = ua - ub - borrowIn;
    const res = diff >>> 0;
    if (setFlags) {
      this.flagN = (res & 0x80000000) !== 0;
      this.flagZ = res === 0;
      this.flagC = ua >= ub + borrowIn;
      this.flagV = (((ua ^ ub) & (ua ^ res)) & 0x80000000) !== 0;
    }
    return res;
  }

  private setLogicFlags(res: number, carry: boolean): void {
    this.flagN = (res & 0x80000000) !== 0;
    this.flagZ = (res >>> 0) === 0;
    this.flagC = carry;
  }

  private stepInstruction(): boolean {
    const pc = this.regs[15] >>> 0;
    const instr = this.read32(pc);
    this.regs[15] = (pc + 4) >>> 0;
    this.totalInstructions++;

    const cond = (instr >>> 28) & 0xf;
    if (!this.checkCond(cond)) {
      return false;
    }

    let readVcount = false;

    // BX Rm
    if ((instr & 0x0ffffff0) === 0x012fff10) {
      const rm = instr & 0xf;
      const target = rm === 15 ? pc + 8 : this.regs[rm];
      this.regs[15] = (target & ~1) >>> 0;
      return false;
    }

    // B / BL
    if ((instr & 0x0e000000) === 0x0a000000) {
      const l = (instr & 0x01000000) !== 0;
      let imm24 = instr & 0x00ffffff;
      if (imm24 & 0x00800000) imm24 |= 0xff000000;
      if (l) {
        this.regs[14] = (pc + 4) >>> 0;
      }
      this.regs[15] = (pc + 8 + (imm24 << 2)) >>> 0;
      return false;
    }

    // Block Data Transfer (LDM / STM)
    if ((instr & 0x0e000000) === 0x08000000) {
      const p = (instr & 0x01000000) !== 0;
      const u = (instr & 0x00800000) !== 0;
      const w = (instr & 0x00200000) !== 0;
      const l = (instr & 0x00100000) !== 0;
      const rn = (instr >>> 16) & 0xf;
      const regList = instr & 0xffff;

      let count = 0;
      for (let i = 0; i < 16; i++) if (regList & (1 << i)) count++;

      const base = this.regs[rn] >>> 0;
      let addr = u ? base : (base - count * 4) >>> 0;
      const finalBase = u ? (base + count * 4) >>> 0 : (base - count * 4) >>> 0;

      if (u && p) addr = (addr + 4) >>> 0;
      if (!u && !p) addr = (addr + 4) >>> 0;

      for (let r = 0; r < 16; r++) {
        if (regList & (1 << r)) {
          if (l) {
            this.regs[r] = this.read32(addr);
          } else {
            const val = r === 15 ? pc + 8 : this.regs[r];
            this.write32(addr, val);
          }
          addr = (addr + 4) >>> 0;
        }
      }
      if (w && !(l && (regList & (1 << rn)))) {
        this.regs[rn] = finalBase;
      }
      return false;
    }

    // Single Data Transfer (LDR / STR / LDRB / STRB)
    if ((instr & 0x0c000000) === 0x04000000) {
      const iBit = (instr & 0x02000000) !== 0;
      const p = (instr & 0x01000000) !== 0;
      const u = (instr & 0x00800000) !== 0;
      const b = (instr & 0x00400000) !== 0;
      const w = (instr & 0x00200000) !== 0;
      const l = (instr & 0x00100000) !== 0;
      const rn = (instr >>> 16) & 0xf;
      const rd = (instr >>> 12) & 0xf;

      let offset = 0;
      if (!iBit) {
        offset = instr & 0xfff;
      } else {
        const rm = instr & 0xf;
        const shiftType = (instr >>> 5) & 3;
        const shiftAmt = (instr >>> 7) & 0x1f;
        const val = rm === 15 ? pc + 8 : this.regs[rm];
        if (shiftType === 0) offset = (val << shiftAmt) >>> 0;
        else if (shiftType === 1) offset = shiftAmt === 0 ? 0 : val >>> shiftAmt;
        else if (shiftType === 2) offset = shiftAmt === 0 ? (val & 0x80000000 ? 0xffffffff : 0) : (val >> shiftAmt) >>> 0;
        else offset = this.ror32(val, shiftAmt);
      }

      const base = rn === 15 ? pc + 8 : this.regs[rn];
      const ea = (u ? base + offset : base - offset) >>> 0;
      const addr = p ? ea : base;

      if (l) {
        this.regs[rd] = b ? this.read8(addr) : this.read32(addr);
      } else {
        const val = rd === 15 ? pc + 8 : this.regs[rd];
        if (b) this.write8(addr, val);
        else this.write32(addr, val);
      }
      if ((!p || w) && rn !== 15) {
        this.regs[rn] = ea;
      }
      return false;
    }

    // Multiply (MUL / MLA)
    if ((instr & 0x0fc000f0) === 0x00000090) {
      const aBit = (instr & 0x00200000) !== 0;
      const sBit = (instr & 0x00100000) !== 0;
      const rd = (instr >>> 16) & 0xf;
      const rn = (instr >>> 12) & 0xf;
      const rs = (instr >>> 8) & 0xf;
      const rm = instr & 0xf;
      let res = Math.imul(this.regs[rm], this.regs[rs]) >>> 0;
      if (aBit) res = (res + this.regs[rn]) >>> 0;
      this.regs[rd] = res;
      if (sBit) {
        this.flagN = (res & 0x80000000) !== 0;
        this.flagZ = res === 0;
      }
      return false;
    }

    // Halfword Data Transfer (LDRH / STRH)
    if ((instr & 0x0e000090) === 0x00000090 && (instr & 0x60) !== 0) {
      const p = (instr & 0x01000000) !== 0;
      const u = (instr & 0x00800000) !== 0;
      const iBit = (instr & 0x00400000) !== 0;
      const w = (instr & 0x00200000) !== 0;
      const l = (instr & 0x00100000) !== 0;
      const rn = (instr >>> 16) & 0xf;
      const rd = (instr >>> 12) & 0xf;
      const sh = (instr >>> 5) & 3;
      const offset = iBit ? ((instr >>> 4) & 0xf0) | (instr & 0xf) : this.regs[instr & 0xf];

      const base = rn === 15 ? pc + 8 : this.regs[rn];
      const ea = (u ? base + offset : base - offset) >>> 0;
      const addr = p ? ea : base;

      if (addr === 0x04000006) readVcount = true;

      if (l) {
        if (sh === 1) {
          this.regs[rd] = this.read16(addr);
        } else if (sh === 2) {
          const b = this.read8(addr);
          this.regs[rd] = (b & 0x80 ? b | 0xffffff00 : b) >>> 0;
        } else if (sh === 3) {
          const h = this.read16(addr);
          this.regs[rd] = (h & 0x8000 ? h | 0xffff0000 : h) >>> 0;
        }
      } else if (sh === 1) {
        this.write16(addr, this.regs[rd]);
      }

      if ((!p || w) && rn !== 15) {
        this.regs[rn] = ea;
      }
      return readVcount;
    }

    // Data Processing
    if ((instr & 0x0c000000) === 0x00000000) {
      const iBit = (instr & 0x02000000) !== 0;
      const opcode = (instr >>> 21) & 0xf;
      const sBit = (instr & 0x00100000) !== 0;
      const rn = (instr >>> 16) & 0xf;
      const rd = (instr >>> 12) & 0xf;

      let op2 = 0;
      let shiftCarry = this.flagC;

      if (iBit) {
        const imm8 = instr & 0xff;
        const rot = ((instr >>> 8) & 0xf) * 2;
        op2 = this.ror32(imm8, rot);
        if (rot !== 0) shiftCarry = (op2 & 0x80000000) !== 0;
      } else {
        const rm = instr & 0xf;
        const regShift = (instr & 0x10) !== 0;
        const shiftType = (instr >>> 5) & 3;
        const rmVal = rm === 15 ? pc + 8 : this.regs[rm];
        let amt = regShift ? this.regs[(instr >>> 8) & 0xf] & 0xff : (instr >>> 7) & 0x1f;

        if (shiftType === 0) {
          if (amt === 0) {
            op2 = rmVal >>> 0;
          } else if (amt < 32) {
            shiftCarry = ((rmVal >>> (32 - amt)) & 1) !== 0;
            op2 = (rmVal << amt) >>> 0;
          } else if (amt === 32) {
            shiftCarry = (rmVal & 1) !== 0;
            op2 = 0;
          } else {
            shiftCarry = false;
            op2 = 0;
          }
        } else if (shiftType === 1) {
          if (!regShift && amt === 0) amt = 32;
          if (amt === 0) {
            op2 = rmVal >>> 0;
          } else if (amt < 32) {
            shiftCarry = ((rmVal >>> (amt - 1)) & 1) !== 0;
            op2 = rmVal >>> amt;
          } else if (amt === 32) {
            shiftCarry = (rmVal & 0x80000000) !== 0;
            op2 = 0;
          } else {
            shiftCarry = false;
            op2 = 0;
          }
        } else if (shiftType === 2) {
          if (!regShift && amt === 0) amt = 32;
          if (amt === 0) {
            op2 = rmVal >>> 0;
          } else if (amt < 32) {
            shiftCarry = ((rmVal >>> (amt - 1)) & 1) !== 0;
            op2 = (rmVal >> amt) >>> 0;
          } else {
            shiftCarry = (rmVal & 0x80000000) !== 0;
            op2 = shiftCarry ? 0xffffffff : 0;
          }
        } else {
          if (!regShift && amt === 0) {
            // RRX
            shiftCarry = (rmVal & 1) !== 0;
            op2 = ((this.flagC ? 0x80000000 : 0) | (rmVal >>> 1)) >>> 0;
          } else if (amt === 0) {
            op2 = rmVal >>> 0;
          } else {
            const r = amt & 31;
            op2 = this.ror32(rmVal, r);
            shiftCarry = (op2 & 0x80000000) !== 0;
          }
        }
      }

      const op1 = (rn === 15 ? pc + 8 : this.regs[rn]) >>> 0;
      let res = 0;
      let writeRd = true;

      switch (opcode) {
        case 0: // AND
          res = (op1 & op2) >>> 0;
          if (sBit) this.setLogicFlags(res, shiftCarry);
          break;
        case 1: // EOR
          res = (op1 ^ op2) >>> 0;
          if (sBit) this.setLogicFlags(res, shiftCarry);
          break;
        case 2: // SUB
          res = this.subWithFlags(op1, op2, 0, sBit);
          break;
        case 3: // RSB
          res = this.subWithFlags(op2, op1, 0, sBit);
          break;
        case 4: // ADD
          res = this.addWithFlags(op1, op2, 0, sBit);
          break;
        case 5: // ADC
          res = this.addWithFlags(op1, op2, this.flagC ? 1 : 0, sBit);
          break;
        case 6: // SBC
          res = this.subWithFlags(op1, op2, this.flagC ? 0 : 1, sBit);
          break;
        case 7: // RSC
          res = this.subWithFlags(op2, op1, this.flagC ? 0 : 1, sBit);
          break;
        case 8: // TST
          res = (op1 & op2) >>> 0;
          this.setLogicFlags(res, shiftCarry);
          writeRd = false;
          break;
        case 9: // TEQ
          res = (op1 ^ op2) >>> 0;
          this.setLogicFlags(res, shiftCarry);
          writeRd = false;
          break;
        case 10: // CMP
          this.subWithFlags(op1, op2, 0, true);
          writeRd = false;
          break;
        case 11: // CMN
          this.addWithFlags(op1, op2, 0, true);
          writeRd = false;
          break;
        case 12: // ORR
          res = (op1 | op2) >>> 0;
          if (sBit) this.setLogicFlags(res, shiftCarry);
          break;
        case 13: // MOV
          res = op2 >>> 0;
          if (sBit) this.setLogicFlags(res, shiftCarry);
          break;
        case 14: // BIC
          res = (op1 & ~op2) >>> 0;
          if (sBit) this.setLogicFlags(res, shiftCarry);
          break;
        case 15: // MVN
          res = ~op2 >>> 0;
          if (sBit) this.setLogicFlags(res, shiftCarry);
          break;
      }

      if (writeRd) {
        this.regs[rd] = res >>> 0;
      }
      return false;
    }

    this.lastError = `Unsupported ARM opcode 0x${instr.toString(16).padStart(8, '0')} at 0x${pc.toString(16)}`;
    return false;
  }

  /**
   * Advances one full GBA frame (228 scanlines: 0..159 visible, 160..227 VBlank).
   */
  stepFrame(): void {
    if (this.lastError) return;

    for (let scanline = 0; scanline < 228; scanline++) {
      this.vcount = scanline;
      let vcountPolls = 0;
      // Generous instruction budget per scanline so Mode 4 rendering completes cleanly
      for (let i = 0; i < 6000; i++) {
        const polled = this.stepInstruction();
        if (this.lastError) return;
        if (polled) {
          vcountPolls++;
          if (vcountPolls >= 2) {
            break; // Fast-forward wait_vblank polling loop
          }
        }
      }
    }

    if (this.sramDirty && this.onSramSave) {
      this.sramDirty = false;
      this.onSramSave(this.sram);
    }
  }

  renderFramebuffer(): Uint8ClampedArray {
    const pageOffset = (this.dispcnt & 0x0010) !== 0 ? 0xa000 : 0x0000;
    const out = this.frameBuffer;

    // Pre-decode 256 palette colors
    const palR = new Uint8Array(256);
    const palG = new Uint8Array(256);
    const palB = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const bgr = this.pal[i * 2] | (this.pal[i * 2 + 1] << 8);
      const r5 = bgr & 0x1f;
      const g5 = (bgr >> 5) & 0x1f;
      const b5 = (bgr >> 10) & 0x1f;
      palR[i] = (r5 << 3) | (r5 >> 2);
      palG[i] = (g5 << 3) | (g5 >> 2);
      palB[i] = (b5 << 3) | (b5 >> 2);
    }

    const totalPixels = 240 * 160;
    for (let p = 0; p < totalPixels; p++) {
      const idx = this.vram[pageOffset + p];
      const o = p * 4;
      out[o] = palR[idx];
      out[o + 1] = palG[idx];
      out[o + 2] = palB[idx];
      out[o + 3] = 255;
    }
    return out;
  }

  getDebugState(): {
    mode: number;
    book: number;
    chapter: number;
    scrollLine: number;
    theme: number;
    numLines: number;
    translation: number;
  } {
    const dv = new DataView(this.iwram.buffer);
    return {
      mode: dv.getUint32(0x00, true),
      book: dv.getUint32(0x04, true),
      chapter: dv.getUint32(0x08, true),
      scrollLine: dv.getUint32(0x0c, true),
      theme: dv.getUint32(0x10, true),
      numLines: dv.getUint32(0x14, true),
      translation: dv.getUint32(0x4c, true),
    };
  }
}
