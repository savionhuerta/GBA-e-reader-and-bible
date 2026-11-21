import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, Power } from 'lucide-react';
import { GbaButton, GbaEmulator } from '../lib/gbaEmulator';
import { RomBuildResult } from '../lib/gbaRomCompiler';

interface GbaHandheldPreviewProps {
  buildResult: RomBuildResult | null;
  romTitle: string;
  defaultThemeIndex: number;
  translationCodes?: string[];
  studioMode?: 'bible' | 'ereader';
}

const SRAM_PERSIST_BYTES = 512;

export const GbaHandheldPreview: React.FC<GbaHandheldPreviewProps> = ({
  buildResult,
  romTitle,
  defaultThemeIndex,
  translationCodes = [],
  studioMode = 'bible',
}) => {
  const sramStorageKey =
    studioMode === 'bible' ? 'gba_scripture_sram_v4' : 'gba_ereader_sram_v4';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const emuRef = useRef<GbaEmulator | null>(null);
  const rafRef = useRef<number | null>(null);

  const [pressedButtons, setPressedButtons] = useState<Set<GbaButton>>(new Set());
  const [emuState, setEmuState] = useState<{
    mode: number;
    book: number;
    chapter: number;
    scrollLine: number;
    theme: number;
    numLines: number;
    translation: number;
  } | null>(null);
  const [emuError, setEmuError] = useState<string | null>(null);

  const prevThemePropRef = useRef<number>(defaultThemeIndex);

  // Initialize or reload emulator whenever compiled ROM changes
  useEffect(() => {
    if (!buildResult) {
      emuRef.current = null;
      setEmuState(null);
      return;
    }

    const themeChanged = prevThemePropRef.current !== defaultThemeIndex;
    prevThemePropRef.current = defaultThemeIndex;

    let initialSram: Uint8Array | undefined;
    try {
      const savedB64 = localStorage.getItem(sramStorageKey);
      if (savedB64) {
        const bin = atob(savedB64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        // If user explicitly picked a new boot theme swatch in the studio, update ERD4 SRAM theme + checksum
        if (
          themeChanged &&
          arr.length >= 23 &&
          arr[0] === 0x45 &&
          arr[1] === 0x52 &&
          arr[2] === 0x44 &&
          arr[3] === 0x34
        ) {
          arr[10] = defaultThemeIndex & 3;
          let sum = 0x5a;
          for (let i = 0; i < 22; i++) sum = (sum + arr[i]) & 0xff;
          arr[22] = sum;
        }
        initialSram = arr;
      }
    } catch {
      // Ignore storage read errors
    }

    const emu = new GbaEmulator(buildResult.rom, initialSram, (sramData) => {
      try {
        // Save first 512 bytes of SRAM (ERD4 header + per-book/bible saved slots)
        let str = '';
        for (let i = 0; i < SRAM_PERSIST_BYTES; i++) str += String.fromCharCode(sramData[i]);
        localStorage.setItem(sramStorageKey, btoa(str));
      } catch {
        // Ignore storage write errors
      }
    });

    emuRef.current = emu;
    setEmuError(null);

    // Run 2 boot frames immediately so initial screen renders without delay
    emu.stepFrame();
    emu.stepFrame();
    setEmuState(emu.getDebugState());
    if (emu.lastError) setEmuError(emu.lastError);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const imgData = ctx ? ctx.createImageData(240, 160) : null;

    let frameCounter = 0;
    const loop = () => {
      const currentEmu = emuRef.current;
      if (currentEmu) {
        currentEmu.stepFrame();
        if (currentEmu.lastError) {
          setEmuError(currentEmu.lastError);
          return;
        }
        if (ctx && imgData) {
          const fb = currentEmu.renderFramebuffer();
          imgData.data.set(fb);
          ctx.putImageData(imgData, 0, 0);
        }
        frameCounter++;
        if (frameCounter % 8 === 0) {
          setEmuState(currentEmu.getDebugState());
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [buildResult, sramStorageKey]);

  const setBtn = (btn: GbaButton, isDown: boolean) => {
    const emu = emuRef.current;
    if (emu) {
      emu.setButton(btn, isDown);
    }
    setPressedButtons((prev) => {
      const next = new Set(prev);
      if (isDown) next.add(btn);
      else next.delete(btn);
      return next;
    });
  };

  // Keyboard bindings when not typing into inputs
  useEffect(() => {
    const keyMap: Record<string, GbaButton> = {
      ArrowUp: 'UP',
      ArrowDown: 'DOWN',
      ArrowLeft: 'LEFT',
      ArrowRight: 'RIGHT',
      w: 'UP',
      W: 'UP',
      s: 'DOWN',
      S: 'DOWN',
      a: 'LEFT',
      A: 'LEFT',
      d: 'RIGHT',
      D: 'RIGHT',
      x: 'A',
      X: 'A',
      k: 'A',
      K: 'A',
      z: 'B',
      Z: 'B',
      j: 'B',
      J: 'B',
      q: 'L',
      Q: 'L',
      e: 'R',
      E: 'R',
      Enter: 'START',
      Shift: 'SELECT',
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      const btn = keyMap[ev.key];
      if (btn && emuRef.current) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(ev.key)) {
          ev.preventDefault();
        }
        setBtn(btn, true);
      }
    };

    const onKeyUp = (ev: KeyboardEvent) => {
      const btn = keyMap[ev.key];
      if (btn && emuRef.current) {
        setBtn(btn, false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const handleReboot = () => {
    const emu = emuRef.current;
    if (!emu) return;
    emu.reset();
    emu.stepFrame();
    emu.stepFrame();
    setEmuState(emu.getDebugState());
  };

  const handleClearSram = () => {
    try {
      localStorage.removeItem(sramStorageKey);
    } catch {
      // Ignore
    }
    const emu = emuRef.current;
    if (!emu) return;
    emu.sram.fill(0xff);
    emu.reset();
    emu.stepFrame();
    emu.stepFrame();
    setEmuState(emu.getDebugState());
  };

  const handleTriggerLR = () => {
    const emu = emuRef.current;
    if (!emu) return;
    emu.setButton('L', true);
    emu.setButton('R', true);
    setPressedButtons((prev) => new Set(prev).add('L').add('R'));
    setTimeout(() => {
      emuRef.current?.setButton('L', false);
      emuRef.current?.setButton('R', false);
      setPressedButtons((prev) => {
        const next = new Set(prev);
        next.delete('L');
        next.delete('R');
        return next;
      });
    }, 65);
  };

  const handleTriggerCombo = (mod: 'START' | 'SELECT', btn: 'L' | 'R' | 'A') => {
    const emu = emuRef.current;
    if (!emu) return;
    emu.setButton(mod, true);
    setPressedButtons((prev) => new Set(prev).add(mod));
    setTimeout(() => {
      emuRef.current?.setButton(btn, true);
      setPressedButtons((prev) => new Set(prev).add(btn));
    }, 25);
    setTimeout(() => {
      emuRef.current?.setButton(btn, false);
      setPressedButtons((prev) => {
        const next = new Set(prev);
        next.delete(btn);
        return next;
      });
    }, 70);
    setTimeout(() => {
      emuRef.current?.setButton(mod, false);
      setPressedButtons((prev) => {
        const next = new Set(prev);
        next.delete(mod);
        return next;
      });
    }, 95);
  };

  const btnBind = (btn: GbaButton) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      setBtn(btn, true);
    },
    onPointerUp: () => setBtn(btn, false),
    onPointerLeave: () => {
      if (pressedButtons.has(btn)) setBtn(btn, false);
    },
    onPointerCancel: () => setBtn(btn, false),
  });

  const modeLabel = emuState
    ? emuState.mode === 0
      ? 'Reader'
      : emuState.mode === 1
        ? studioMode === 'bible'
          ? 'Books'
          : 'Sections'
        : emuState.mode === 2
          ? 'Chapters'
          : emuState.mode === 3
            ? studioMode === 'bible'
              ? 'Main Menu'
              : 'Library Shelf'
            : studioMode === 'bible'
              ? 'Concordance'
              : 'Search'
    : 'Standby';

  const activeTransCode =
    emuState && translationCodes[emuState.translation]
      ? translationCodes[emuState.translation]
      : translationCodes[0] ?? '';

  return (
    <div className="flex flex-col gap-4">
      {/* GBA Shell Container */}
      <div className="rounded-2xl bg-[#2E296B] p-4 sm:p-5 shadow-sm border border-[#231F54] text-white select-none">
        {/* Top Shoulder Triggers */}
        <div className="flex items-center justify-between mb-3 px-1">
          <button
            type="button"
            {...btnBind('L')}
            disabled={!buildResult}
            aria-label="L Shoulder Button (Previous Chapter / Old Testament)"
            className={`px-5 py-1.5 rounded-t-lg text-xs font-mono font-semibold tracking-wider border border-slate-500/40 transition-transform active:translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40 ${
              pressedButtons.has('L')
                ? 'bg-slate-300 text-slate-900 translate-y-0.5'
                : 'bg-slate-200/90 text-slate-800 hover:bg-white'
            }`}
          >
            L · PREV CH
          </button>

          <div className="flex items-center gap-2 text-[11px] font-mono text-indigo-200/90">
            <span className="truncate max-w-[120px]">
              {romTitle || (studioMode === 'bible' ? 'GBA BIBLE' : 'GBA READER')}
            </span>
            <span aria-hidden="true">·</span>
            <span>{modeLabel}</span>
          </div>

          <button
            type="button"
            {...btnBind('R')}
            disabled={!buildResult}
            aria-label="R Shoulder Button (Next Chapter / New Testament)"
            className={`px-5 py-1.5 rounded-t-lg text-xs font-mono font-semibold tracking-wider border border-slate-500/40 transition-transform active:translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40 ${
              pressedButtons.has('R')
                ? 'bg-slate-300 text-slate-900 translate-y-0.5'
                : 'bg-slate-200/90 text-slate-800 hover:bg-white'
            }`}
          >
            NEXT CH · R
          </button>
        </div>

        {/* Dark LCD Bezel */}
        <div className="rounded-xl bg-[#141519] p-3 sm:p-4 border border-black/60">
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  buildResult ? 'bg-emerald-400' : 'bg-slate-600'
                }`}
                aria-hidden="true"
              />
              <span className="text-[11px] font-mono text-slate-400">
                {buildResult ? 'POWER · 240×160' : 'NO ROM LOADED'}
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-500">ARM7TDMI · MODE 4</span>
          </div>

          {/* Authentic 3:2 240x160 Canvas Screen */}
          <div className="relative w-full aspect-[3/2] bg-[#0B0C10] rounded-md overflow-hidden border border-slate-800">
            <canvas
              ref={canvasRef}
              width={240}
              height={160}
              className="w-full h-full block pixelated"
            />
            {!buildResult && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#0F1218]">
                <p className="text-sm font-medium text-slate-200 mb-1">
                  {studioMode === 'bible'
                    ? 'Load a Bible JSON translation or sample scripture to boot'
                    : 'Add a book (.txt, .md, .epub, .html, or .json) to boot'}
                </p>
                <p className="text-xs text-slate-400 max-w-xs">
                  The live preview runs your compiled .gba binary directly on an ARM7TDMI emulator.
                </p>
              </div>
            )}
            {emuError && (
              <div className="absolute inset-0 flex items-center justify-center p-4 bg-red-950/90 text-xs font-mono text-red-200">
                {emuError}
              </div>
            )}
          </div>
        </div>

        {/* Tactile Controls Deck */}
        <div className="mt-4 flex items-center justify-between gap-2 px-1">
          {/* Cross D-Pad */}
          <div className="grid grid-cols-3 grid-rows-3 w-28 h-28 shrink-0" role="group" aria-label="D-Pad">
            <div />
            <button
              type="button"
              {...btnBind('UP')}
              disabled={!buildResult}
              aria-label="D-Pad Up"
              className={`rounded-t-md border border-slate-700 flex items-center justify-center text-xs font-mono transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ${
                pressedButtons.has('UP') ? 'bg-slate-600 text-white' : 'bg-[#262933] text-slate-300 hover:bg-[#323642]'
              }`}
            >
              ▲
            </button>
            <div />
            <button
              type="button"
              {...btnBind('LEFT')}
              disabled={!buildResult}
              aria-label="D-Pad Left"
              className={`rounded-l-md border border-slate-700 flex items-center justify-center text-xs font-mono transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ${
                pressedButtons.has('LEFT') ? 'bg-slate-600 text-white' : 'bg-[#262933] text-slate-300 hover:bg-[#323642]'
              }`}
            >
              ◀
            </button>
            <div className="bg-[#262933] border-y border-slate-700 flex items-center justify-center">
              <div className="w-3.5 h-3.5 rounded-full bg-[#1B1D24]" />
            </div>
            <button
              type="button"
              {...btnBind('RIGHT')}
              disabled={!buildResult}
              aria-label="D-Pad Right"
              className={`rounded-r-md border border-slate-700 flex items-center justify-center text-xs font-mono transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ${
                pressedButtons.has('RIGHT') ? 'bg-slate-600 text-white' : 'bg-[#262933] text-slate-300 hover:bg-[#323642]'
              }`}
            >
              ▶
            </button>
            <div />
            <button
              type="button"
              {...btnBind('DOWN')}
              disabled={!buildResult}
              aria-label="D-Pad Down"
              className={`rounded-b-md border border-slate-700 flex items-center justify-center text-xs font-mono transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ${
                pressedButtons.has('DOWN') ? 'bg-slate-600 text-white' : 'bg-[#262933] text-slate-300 hover:bg-[#323642]'
              }`}
            >
              ▼
            </button>
            <div />
          </div>

          {/* Center START / SELECT */}
          <div className="flex flex-col items-center gap-2.5 self-end pb-1">
            <button
              type="button"
              {...btnBind('START')}
              disabled={!buildResult}
              className={`px-3.5 py-2 rounded-full text-[11px] font-mono font-semibold tracking-wider border border-slate-600/60 transition-transform focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 whitespace-nowrap ${
                pressedButtons.has('START')
                  ? 'bg-slate-400 text-slate-900 scale-95'
                  : 'bg-[#262933] text-slate-200 hover:bg-[#323642]'
              }`}
            >
              START
            </button>
            <button
              type="button"
              {...btnBind('SELECT')}
              disabled={!buildResult}
              className={`px-3.5 py-2 rounded-full text-[11px] font-mono font-semibold tracking-wider border border-slate-600/60 transition-transform focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 whitespace-nowrap ${
                pressedButtons.has('SELECT')
                  ? 'bg-slate-400 text-slate-900 scale-95'
                  : 'bg-[#262933] text-slate-200 hover:bg-[#323642]'
              }`}
            >
              SELECT
            </button>
          </div>

          {/* B & A Buttons */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex flex-col items-center gap-1 mt-5">
              <button
                type="button"
                {...btnBind('B')}
                disabled={!buildResult}
                aria-label="B Button (Save Bookmark / Back)"
                className={`w-12 h-12 rounded-full font-display font-bold text-base border border-slate-600 shadow-inner transition-transform focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ${
                  pressedButtons.has('B')
                    ? 'bg-slate-400 text-slate-950 scale-95'
                    : 'bg-[#262933] text-slate-100 hover:bg-[#323642]'
                }`}
              >
                B
              </button>
              <span className="text-[10px] font-mono text-indigo-200/80">Mark/Back</span>
            </div>
            <div className="flex flex-col items-center gap-1 -mt-4">
              <button
                type="button"
                {...btnBind('A')}
                disabled={!buildResult}
                aria-label="A Button (Book Index / Select)"
                className={`w-12 h-12 rounded-full font-display font-bold text-base border border-slate-600 shadow-inner transition-transform focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 ${
                  pressedButtons.has('A')
                    ? 'bg-slate-400 text-slate-950 scale-95'
                    : 'bg-[#262933] text-slate-100 hover:bg-[#323642]'
                }`}
              >
                A
              </button>
              <span className="text-[10px] font-mono text-indigo-200/80">Ch / OK</span>
            </div>
          </div>
        </div>
      </div>

      {/* Emulator Hardware Actions + Keyboard Map */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-slate-600">
            {emuState ? (
              <span className="font-mono">
                {activeTransCode ? `${activeTransCode} · ` : ''}
                {studioMode === 'bible' ? 'Book' : 'Sec'} #{emuState.book + 1} · Ch{' '}
                {emuState.chapter + 1} · Line {emuState.scrollLine + 1}/
                {Math.max(1, emuState.numLines)}
              </span>
            ) : (
              <span>Waiting for compiled ROM</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTriggerLR}
              disabled={!buildResult}
              className="px-2.5 py-1.5 text-xs font-mono font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {studioMode === 'bible' ? 'L+R Main' : 'L+R Library'}
            </button>
            <button
              type="button"
              onClick={() => handleTriggerCombo('START', 'L')}
              disabled={!buildResult}
              className="px-2.5 py-1.5 text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              Start+L Flow
            </button>
            <button
              type="button"
              onClick={() => handleTriggerCombo('START', 'R')}
              disabled={!buildResult}
              className="px-2.5 py-1.5 text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              Start+R 14/16
            </button>
            <button
              type="button"
              onClick={() => handleTriggerCombo('START', 'A')}
              disabled={!buildResult}
              className="px-2.5 py-1.5 text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              {studioMode === 'bible' ? 'Start+A Concordance' : 'Start+A Search'}
            </button>
            <button
              type="button"
              onClick={handleReboot}
              disabled={!buildResult}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <Power className="w-3.5 h-3.5" />
              Cold Reboot
            </button>
            <button
              type="button"
              onClick={handleClearSram}
              disabled={!buildResult}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset SRAM
            </button>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-2.5 text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <strong className="font-mono text-slate-700">Arrows / WASD</strong> Move &amp; Page
          </span>
          <span>
            <strong className="font-mono text-slate-700">X</strong> A
          </span>
          <span>
            <strong className="font-mono text-slate-700">Z</strong> B
          </span>
          <span>
            <strong className="font-mono text-slate-700">Q / E</strong> L / R (Q+E{' '}
            {studioMode === 'bible' ? 'Main' : 'Shelf'})
          </span>
          <span>
            <strong className="font-mono text-slate-700">Shift</strong> Theme
          </span>
          <span>
            <strong className="font-mono text-slate-700">Enter</strong> Index (Enter+Q/E/X Combos)
          </span>
        </div>
      </div>
    </div>
  );
};
