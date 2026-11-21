import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  HardDrive,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { GbaHandheldPreview } from './components/GbaHandheldPreview';
import { RomHeaderInspector } from './components/RomHeaderInspector';
import {
  decodeGbaText,
  exportNormalizedBibleJson,
  parseBibleJson,
  ParseReport,
  SAMPLE_FORMAT_JSON,
} from './lib/bibleParser';
import {
  DEMO_ART_OF_WAR_MD,
  DEMO_HANDBOOK_MD,
  DEMO_MEDITATIONS_TXT,
  inferVolumeMeta,
  parseDocumentFile,
  parseDocumentString,
} from './lib/documentParser';
import { GBA_THEMES } from './lib/gbaFont';
import {
  compileGbaRom,
  MAX_GBA_ROM_BYTES,
  RomBuildConfig,
  RomBuildResult,
  TranslationInput,
} from './lib/gbaRomCompiler';

type StudioMode = 'bible' | 'ereader';

interface LibraryVolume {
  id: string;
  code: string;
  name: string;
  report: ParseReport;
  includeConcordance: boolean;
}

interface WorkspaceState {
  volumes: LibraryVolume[];
  config: RomBuildConfig;
  titleManuallyEdited: boolean;
  parseError: string | null;
  downloadNotice: string | null;
  showPasteBox: boolean;
  pastedText: string;
  pastedCode: string;
  pastedName: string;
  inspectVolIdx: number | null;
  inspectBookIdx: number;
  inspectChapIdx: number;
  showRawSample: boolean;
}

const DEFAULT_BIBLE_CONFIG: RomBuildConfig = {
  romTitle: 'HOLY BIBLE',
  gameCode: 'BHBL',
  fontStyle: '6x8',
  lineSpacing: 'comfortable',
  verseLayout: 'paragraph',
  showVerseNumbers: true,
  defaultThemeIndex: 0,
  padToPowerOfTwo: true,
  bootToMain: true,
  studioMode: 'bible',
};

const DEFAULT_EREADER_CONFIG: RomBuildConfig = {
  romTitle: 'GBA READER',
  gameCode: 'BRDR',
  fontStyle: '6x8',
  lineSpacing: 'comfortable',
  verseLayout: 'paragraph',
  showVerseNumbers: false,
  defaultThemeIndex: 0,
  padToPowerOfTwo: true,
  bootToMain: true,
  studioMode: 'ereader',
};

function createInitialWorkspace(mode: StudioMode): WorkspaceState {
  return {
    volumes: [],
    config: mode === 'bible' ? { ...DEFAULT_BIBLE_CONFIG } : { ...DEFAULT_EREADER_CONFIG },
    titleManuallyEdited: false,
    parseError: null,
    downloadNotice: null,
    showPasteBox: false,
    pastedText: '',
    pastedCode: mode === 'bible' ? 'KJV' : 'NOTES',
    pastedName: mode === 'bible' ? 'King James Version' : 'Pocket Field Notes',
    inspectVolIdx: null,
    inspectBookIdx: 0,
    inspectChapIdx: 0,
    showRawSample: false,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB (${bytes.toLocaleString()} B)`;
  }
  return `${(bytes / 1024).toFixed(1)} KB (${bytes.toLocaleString()} B)`;
}

function formatCompactMb(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function renderFormattedLine(rawText: string): React.ReactNode {
  if (!rawText.includes('\x01')) {
    return decodeGbaText(rawText);
  }
  const parts: React.ReactNode[] = [];
  let idx = 0;
  let key = 0;
  while (idx < rawText.length) {
    const start = rawText.indexOf('\x01', idx);
    if (start < 0) {
      parts.push(decodeGbaText(rawText.slice(idx)));
      break;
    }
    if (start > idx) {
      parts.push(decodeGbaText(rawText.slice(idx, start)));
    }
    const end = rawText.indexOf('\x02', start + 1);
    if (end < 0) {
      parts.push(
        <span key={key++} className="font-semibold text-indigo-800">
          {decodeGbaText(rawText.slice(start + 1))}
        </span>
      );
      break;
    }
    parts.push(
      <span key={key++} className="font-semibold text-indigo-800">
        {decodeGbaText(rawText.slice(start + 1, end))}
      </span>
    );
    idx = end + 1;
  }
  return parts;
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [studioMode, setStudioMode] = useState<StudioMode>('bible');
  const [workspaces, setWorkspaces] = useState<Record<StudioMode, WorkspaceState>>(() => ({
    bible: createInitialWorkspace('bible'),
    ereader: createInitialWorkspace('ereader'),
  }));

  const [isDragging, setIsDragging] = useState(false);
  const [stripGutenberg, setStripGutenberg] = useState(true);
  const [showHeaderHex, setShowHeaderHex] = useState(false);

  const active = workspaces[studioMode];
  const isBibleMode = studioMode === 'bible';

  const patchWorkspace = (
    mode: StudioMode,
    updater: (prev: WorkspaceState) => WorkspaceState
  ) => {
    setWorkspaces((prev) => ({
      ...prev,
      [mode]: updater(prev[mode]),
    }));
  };

  const patchActive = (updater: (prev: WorkspaceState) => WorkspaceState) => {
    patchWorkspace(studioMode, updater);
  };

  const { buildResult, compileError } = useMemo<{
    buildResult: RomBuildResult | null;
    compileError: string | null;
  }>(() => {
    if (active.volumes.length === 0) return { buildResult: null, compileError: null };
    try {
      const inputs: TranslationInput[] = active.volumes.map((v) => ({
        code: v.code,
        name: v.name,
        report: v.report,
        includeConcordance: v.includeConcordance,
      }));
      return {
        buildResult: compileGbaRom(inputs, { ...active.config, studioMode }),
        compileError: null,
      };
    } catch (err) {
      return {
        buildResult: null,
        compileError: err instanceof Error ? err.message : 'Failed to compile ROM',
      };
    }
  }, [active.volumes, active.config, studioMode]);

  const activeError = active.parseError ?? compileError;

  const computeSyncedConfig = (
    mode: StudioMode,
    nextList: LibraryVolume[],
    prevCfg: RomBuildConfig,
    manuallyEdited: boolean
  ): RomBuildConfig => {
    if (manuallyEdited || nextList.length === 0) return prevCfg;
    if (mode === 'bible') {
      if (nextList.length === 1) {
        const code = nextList[0].code.slice(0, 5) || 'BIBLE';
        return {
          ...prevCfg,
          romTitle: `${code} BIBLE`.slice(0, 12),
          gameCode: `B${code.replace(/[^A-Z0-9]/g, '').padEnd(3, 'X').slice(0, 3)}`,
        };
      }
      return { ...prevCfg, romTitle: 'HOLY BIBLE', gameCode: 'BHBL' };
    }

    const allBibles = nextList.every((v) => v.report.libraryMode === 'bible');
    if (nextList.length === 1) {
      const code = nextList[0].code.slice(0, 5) || 'BOOK';
      const suffix = allBibles ? 'BIBLE' : 'READR';
      return {
        ...prevCfg,
        romTitle: `${code} ${suffix}`.slice(0, 12),
        gameCode: `${allBibles ? 'B' : 'R'}${code.replace(/[^A-Z0-9]/g, '').padEnd(3, 'X').slice(0, 3)}`,
      };
    }
    if (allBibles) {
      return { ...prevCfg, romTitle: 'HOLY BIBLE', gameCode: 'BHBL' };
    }
    return { ...prevCfg, romTitle: 'GBA READER', gameCode: 'BRDR' };
  };

  const addVolumeFromString = (
    text: string,
    fileName: string,
    explicitCode?: string,
    explicitName?: string
  ) => {
    const modeSnapshot = studioMode;
    const report =
      modeSnapshot === 'bible'
        ? parseBibleJson(text, fileName)
        : parseDocumentString(text, fileName, {
            stripGutenbergBoilerplate: stripGutenberg,
          });

    patchWorkspace(modeSnapshot, (prev) => {
      const inferred = inferVolumeMeta(fileName, report, prev.volumes.length);
      const code =
        (explicitCode || inferred.code)
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, '')
          .slice(0, 7) || (modeSnapshot === 'bible' ? 'BIBLE' : 'BOOK');
      const name = (explicitName || inferred.name).slice(0, 23);

      const newVol: LibraryVolume = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        code,
        name,
        report,
        includeConcordance: true,
      };
      const next = [...prev.volumes, newVol];
      return {
        ...prev,
        volumes: next,
        config: computeSyncedConfig(modeSnapshot, next, prev.config, prev.titleManuallyEdited),
        parseError: null,
        downloadNotice: null,
        showPasteBox: false,
      };
    });
  };

  const handleLoadFiles = async (files: FileList | File[]) => {
    const modeSnapshot = studioMode;
    const list = Array.from(files);
    if (list.length === 0) return;

    patchWorkspace(modeSnapshot, (prev) => ({
      ...prev,
      parseError: null,
      downloadNotice: null,
    }));

    const existingCount = workspaces[modeSnapshot].volumes.length;
    const added: LibraryVolume[] = [];
    const errors: string[] = [];

    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      try {
        let report: ParseReport;
        if (modeSnapshot === 'bible') {
          const text = await file.text();
          report = parseBibleJson(text, file.name);
        } else {
          report = await parseDocumentFile(file, {
            stripGutenbergBoilerplate: stripGutenberg,
          });
        }
        const inferred = inferVolumeMeta(file.name, report, existingCount + added.length);
        added.push({
          id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          code: inferred.code,
          name: inferred.name,
          report,
          includeConcordance: true,
        });
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Unable to parse file'}`);
      }
    }

    patchWorkspace(modeSnapshot, (prev) => {
      const next = added.length > 0 ? [...prev.volumes, ...added] : prev.volumes;
      return {
        ...prev,
        volumes: next,
        config:
          added.length > 0
            ? computeSyncedConfig(modeSnapshot, next, prev.config, prev.titleManuallyEdited)
            : prev.config,
        parseError: errors.length > 0 ? errors.join('\n\n') : null,
      };
    });
  };

  const handleLoadSampleBible = () => {
    const report = parseBibleJson(SAMPLE_FORMAT_JSON, 'web_sample_scripture.json');
    const demoVol: LibraryVolume = {
      id: `demo-web-${Date.now()}`,
      code: 'WEB',
      name: 'World English (Sample)',
      report,
      includeConcordance: true,
    };
    patchWorkspace('bible', (prev) => {
      const next = [demoVol];
      return {
        ...prev,
        volumes: next,
        config: computeSyncedConfig('bible', next, prev.config, prev.titleManuallyEdited),
        parseError: null,
        downloadNotice: null,
        inspectVolIdx: null,
        inspectBookIdx: 0,
        inspectChapIdx: 0,
        showPasteBox: false,
      };
    });
  };

  const handleLoadDemoShelf = () => {
    const medReport = parseDocumentString(DEMO_MEDITATIONS_TXT, 'meditations.txt', {
      stripGutenbergBoilerplate: false,
    });
    const artReport = parseDocumentString(DEMO_ART_OF_WAR_MD, 'art_of_war.md');
    const guideReport = parseDocumentString(DEMO_HANDBOOK_MD, 'pocket_reader_guide.md');

    const demoList: LibraryVolume[] = [
      {
        id: `demo-med-${Date.now()}`,
        code: 'MEDIT',
        name: 'Meditations (I-III)',
        report: medReport,
        includeConcordance: true,
      },
      {
        id: `demo-art-${Date.now() + 1}`,
        code: 'WAR',
        name: 'The Art of War',
        report: artReport,
        includeConcordance: true,
      },
      {
        id: `demo-guide-${Date.now() + 2}`,
        code: 'GUIDE',
        name: 'Pocket Reader Guide',
        report: guideReport,
        includeConcordance: true,
      },
    ];
    patchWorkspace('ereader', (prev) => ({
      ...prev,
      volumes: demoList,
      config: computeSyncedConfig('ereader', demoList, prev.config, prev.titleManuallyEdited),
      parseError: null,
      downloadNotice: null,
      inspectVolIdx: null,
      inspectBookIdx: 0,
      inspectChapIdx: 0,
      showPasteBox: false,
    }));
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleLoadFiles(e.dataTransfer.files);
    }
  };

  const handleUpdateVolume = (
    idx: number,
    patch: Partial<Pick<LibraryVolume, 'code' | 'name' | 'includeConcordance'>>
  ) => {
    patchActive((prev) => ({
      ...prev,
      volumes: prev.volumes.map((item, i) => (i === idx ? { ...item, ...patch } : item)),
    }));
  };

  const handleMoveVolume = (idx: number, dir: -1 | 1) => {
    patchActive((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.volumes.length) return prev;
      const next = [...prev.volumes];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item);
      let nextInspect = prev.inspectVolIdx;
      if (prev.inspectVolIdx === idx) nextInspect = target;
      else if (prev.inspectVolIdx === target) nextInspect = idx;
      return { ...prev, volumes: next, inspectVolIdx: nextInspect };
    });
  };

  const handleRemoveVolume = (idx: number) => {
    const modeSnapshot = studioMode;
    patchWorkspace(modeSnapshot, (prev) => {
      const next = prev.volumes.filter((_, i) => i !== idx);
      let nextInspect = prev.inspectVolIdx;
      if (prev.inspectVolIdx === idx) nextInspect = null;
      else if (prev.inspectVolIdx !== null && prev.inspectVolIdx > idx) {
        nextInspect = prev.inspectVolIdx - 1;
      }
      return {
        ...prev,
        volumes: next,
        config: computeSyncedConfig(modeSnapshot, next, prev.config, prev.titleManuallyEdited),
        inspectVolIdx: nextInspect,
      };
    });
  };

  const handleDownloadRom = () => {
    if (!buildResult) {
      fileInputRef.current?.click();
      return;
    }
    const copy = new Uint8Array(buildResult.rom.length);
    copy.set(buildResult.rom);
    const blob = new Blob([copy.buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildResult.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    patchActive((prev) => ({
      ...prev,
      downloadNotice: `Downloaded ${buildResult.fileName} (${formatBytes(buildResult.romSizeBytes)})`,
    }));
  };

  const handleDownloadNormalizedJson = (vol: LibraryVolume) => {
    const jsonStr = exportNormalizedBibleJson(vol.report);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const base = vol.report.sourceName.replace(/\.[^.]+$/, '');
    link.download = `${base}_normalized.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const inspectedVol =
    active.inspectVolIdx !== null ? active.volumes[active.inspectVolIdx] ?? null : null;
  const inspectedBook =
    inspectedVol?.report.books[active.inspectBookIdx] ?? inspectedVol?.report.books[0];
  const inspectedChapter =
    inspectedBook?.chapters[active.inspectChapIdx] ?? inspectedBook?.chapters[0];

  const totalPayloadBytes = useMemo(
    () => active.volumes.reduce((sum, v) => sum + v.report.totalBytes, 0),
    [active.volumes]
  );
  const compiledPayloadBytes = buildResult
    ? buildResult.codeSizeBytes + buildResult.dataSizeBytes
    : totalPayloadBytes;
  const capacityPct = Math.min(100, (compiledPayloadBytes / MAX_GBA_ROM_BYTES) * 100);
  const volumeCodes = useMemo(() => active.volumes.map((v) => v.code), [active.volumes]);

  return (
    <div className="min-h-screen bg-[#F6F7F9] text-slate-900 flex flex-col">
      {/* Top Navigation Bar + Studio Mode Switcher */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <a
              href="#top"
              className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
            >
              {isBibleMode ? 'GBA Scripture Studio' : 'GBA E-Reader Studio'}
            </a>

            {/* 1-Click Bible <-> E-Reader Converter Switcher */}
            <div
              role="group"
              aria-label="Workspace Mode Switcher"
              className="inline-flex items-center p-1 bg-slate-100 border border-slate-200 rounded-lg shrink-0"
            >
              <button
                type="button"
                aria-pressed={isBibleMode}
                onClick={() => setStudioMode('bible')}
                className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                  isBibleMode
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Bible Studio</span>
              </button>
              <button
                type="button"
                aria-pressed={!isBibleMode}
                onClick={() => setStudioMode('ereader')}
                className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
                  !isBibleMode
                    ? 'bg-white text-indigo-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>E-Reader Converter</span>
              </button>
            </div>
          </div>

          <nav className="hidden xl:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#library"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              {isBibleMode ? 'Translations' : 'Library'}
            </a>
            <a
              href="#rom-settings"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              ROM Settings
            </a>
            <a
              href="#hardware-preview"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Hardware Preview
            </a>
            <a
              href="#flashcart-guide"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Flashcart Guide
            </a>
          </nav>

          <div className="shrink-0">
            <button
              type="button"
              onClick={handleDownloadRom}
              className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700"
            >
              <Download className="w-4 h-4" />
              {buildResult
                ? 'Download .gba'
                : isBibleMode
                  ? 'Upload JSON'
                  : 'Add Books'}
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1 max-w-[1320px] w-full mx-auto px-4 sm:px-8 py-8">
        {/* Workspace Title Header */}
        <div className="mb-8 pb-6 border-b border-slate-200 flex flex-col gap-2">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            {isBibleMode
              ? 'Scripture ROM Compiler for Game Boy Advance'
              : 'Multi-Book E-Reader Compiler for Game Boy Advance'}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-slate-600">
            {isBibleMode ? (
              <>
                <span>Compile multi-translation Bible JSONs into one 32 MB .gba cartridge</span>
                <span aria-hidden="true">·</span>
                <span>Parallel verse sync</span>
                <span aria-hidden="true">·</span>
                <span>Concordance + SRAM_V113 saves</span>
              </>
            ) : (
              <>
                <span>Convert .txt, .md, .epub, .html &amp; Bible .json into one 32 MB ROM</span>
                <span aria-hidden="true">·</span>
                <span>Per-book SRAM_V113 resume</span>
                <span aria-hidden="true">·</span>
                <span>Full-text BPE search</span>
              </>
            )}
          </div>
        </div>

        {/* Main 2-Column Studio Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Source List, Settings, Output */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            {/* Step 01 */}
            <section
              id="library"
              className="bg-white border border-slate-200 rounded-xl p-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    {isBibleMode ? '01. Bible Translations (.json)' : '01. Cartridge Library'}
                  </h2>
                  <p className="text-sm text-slate-600">
                    {isBibleMode
                      ? 'Load one or more Bible JSON translations (KJV, ESV, WEB, NIV) onto a single cartridge.'
                      : 'Add novels, manuals, notes, EPUBs, or Bible JSONs. Bundle dozens of books onto one flashcart ROM.'}
                  </p>
                </div>
                {active.volumes.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        patchActive((p) => ({ ...p, showPasteBox: !p.showPasteBox }))
                      }
                      className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap"
                    >
                      {active.showPasteBox
                        ? 'Hide Paste'
                        : isBibleMode
                          ? 'Paste JSON'
                          : 'Paste Text'}
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {isBibleMode ? 'Add Translation' : 'Add Book'}
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={
                  isBibleMode
                    ? '.json,application/json'
                    : '.txt,.md,.markdown,.epub,.html,.htm,.xhtml,.json,text/plain,text/markdown,application/epub+zip,text/html,application/json'
                }
                className="sr-only"
                onChange={(e) => {
                  if (e.target.files) {
                    void handleLoadFiles(e.target.files);
                  }
                  e.target.value = '';
                }}
              />

              {/* E-Reader import options */}
              {!isBibleMode && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={stripGutenberg}
                      onChange={(e) => setStripGutenberg(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
                    />
                    <span>Auto-trim Project Gutenberg legal headers &amp; footers on .txt import</span>
                  </label>
                  <span className="font-mono text-[11px] text-slate-500">
                    .txt · .md · .epub · .html · .json
                  </span>
                </div>
              )}

              {active.volumes.length === 0 ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                    isDragging
                      ? 'border-indigo-600 bg-indigo-50/50'
                      : 'border-slate-300 bg-slate-50/70 hover:border-slate-400'
                  }`}
                >
                  <div className="mx-auto w-11 h-11 rounded-lg bg-white border border-slate-200 flex items-center justify-center mb-3">
                    {isBibleMode ? (
                      <BookOpen className="w-5 h-5 text-indigo-700" />
                    ) : (
                      <FileText className="w-5 h-5 text-indigo-700" />
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mb-1">
                    {isBibleMode
                      ? 'Drop one or more Bible JSON files here'
                      : 'Drop your books, plain text, Markdown, EPUB, or JSON files here'}
                  </p>
                  <p className="text-xs text-slate-500 max-w-md mx-auto mb-5">
                    {isBibleMode
                      ? 'Supports nested object maps, book arrays, flat chapter/verse arrays, and reference-keyed JSONs. Fits 3–4 full Bibles on a 32 MB flashcart.'
                      : 'Chapters are auto-detected and safely chunked for Game Boy Advance RAM. Fits ~15–25 full novels with word search on a single 32 MB ROM.'}
                  </p>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <Upload className="w-4 h-4" />
                      {isBibleMode ? 'Choose Bible JSON(s)' : 'Choose Book Files'}
                    </button>
                    <button
                      type="button"
                      onClick={isBibleMode ? handleLoadSampleBible : handleLoadDemoShelf}
                      className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                      {isBibleMode ? 'Load Sample Scripture' : 'Load 3-Book Demo Shelf'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchActive((p) => ({ ...p, showPasteBox: !p.showPasteBox }))
                      }
                      className="px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 underline-offset-4 hover:underline whitespace-nowrap"
                    >
                      {active.showPasteBox
                        ? 'Hide Paste'
                        : isBibleMode
                          ? 'Paste JSON'
                          : 'Paste Text / MD'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border-t border-slate-200 pt-4 space-y-4">
                  {/* 32 MB Cartridge Space Meter */}
                  <div className="flex flex-col gap-1.5 pb-3 border-b border-slate-100">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700">
                        {isBibleMode
                          ? `Bundled Translations (${active.volumes.length}) · BPE Compressed + Concordance`
                          : `Bundled Books (${active.volumes.length}) · BPE Compressed + 16-bit Search Index`}
                      </span>
                      <span className="font-mono text-slate-600">
                        {formatCompactMb(compiledPayloadBytes)} / 32.00 MB max cartridge space
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          capacityPct > 90 ? 'bg-amber-600' : 'bg-indigo-700'
                        }`}
                        style={{ width: `${Math.max(3, capacityPct)}%` }}
                      />
                    </div>
                  </div>

                  {/* Volume Rows */}
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
                    {active.volumes.map((vol, idx) => {
                      const isInspecting = active.inspectVolIdx === idx;
                      const unitLabel = vol.report.libraryMode === 'bible' ? 'vs' : 'para';
                      const otCount = vol.report.books.filter((b) => b.testament === 'OT').length;
                      const ntCount = vol.report.books.filter((b) => b.testament === 'NT').length;
                      return (
                        <div key={vol.id} className="p-3.5 bg-white">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-start gap-2.5 flex-1 min-w-[240px]">
                              <div className="flex flex-col gap-0.5 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => handleMoveVolume(idx, -1)}
                                  disabled={idx === 0}
                                  title="Move up"
                                  className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-25"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleMoveVolume(idx, 1)}
                                  disabled={idx === active.volumes.length - 1}
                                  title="Move down"
                                  className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-25"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2">
                                <div className="sm:col-span-3">
                                  <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">
                                    Code
                                  </label>
                                  <input
                                    type="text"
                                    maxLength={7}
                                    value={vol.code}
                                    onChange={(e) =>
                                      handleUpdateVolume(idx, {
                                        code: e.target.value
                                          .toUpperCase()
                                          .replace(/[^A-Z0-9_-]/g, ''),
                                      })
                                    }
                                    className="w-full px-2 py-1 text-xs font-mono font-semibold text-indigo-800 bg-slate-50 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-600"
                                  />
                                </div>
                                <div className="sm:col-span-9">
                                  <label className="block text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">
                                    {isBibleMode
                                      ? 'Translation Label (Max 23 Chars)'
                                      : 'Shelf Title (Max 23 Chars)'}
                                  </label>
                                  <input
                                    type="text"
                                    maxLength={23}
                                    value={vol.name}
                                    onChange={(e) =>
                                      handleUpdateVolume(idx, { name: e.target.value })
                                    }
                                    className="w-full px-2.5 py-1 text-xs font-medium text-slate-900 bg-slate-50 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-600"
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-3 sm:pt-4">
                              <button
                                type="button"
                                onClick={() =>
                                  patchActive((p) => ({
                                    ...p,
                                    inspectVolIdx: isInspecting ? null : idx,
                                    inspectBookIdx: 0,
                                    inspectChapIdx: 0,
                                  }))
                                }
                                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-800 whitespace-nowrap"
                              >
                                {isInspecting ? 'Hide Check' : 'Inspect Text'}
                                {isInspecting ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDownloadNormalizedJson(vol)}
                                className="text-xs font-medium text-slate-500 hover:text-slate-900 underline underline-offset-4 whitespace-nowrap"
                              >
                                Export .json
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRemoveVolume(idx)}
                                title={`Remove ${vol.code}`}
                                className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="mt-2 pl-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono">
                              <span className="truncate max-w-[160px]" title={vol.report.sourceName}>
                                {vol.report.sourceName}
                              </span>
                              <span>·</span>
                              {isBibleMode ? (
                                <span>
                                  {vol.report.totalBooks} bk ({otCount} OT/{ntCount} NT)
                                </span>
                              ) : (
                                <span className="font-sans text-slate-600">
                                  {vol.report.detectedFormat}
                                </span>
                              )}
                              <span>·</span>
                              <span>{vol.report.totalChapters.toLocaleString()} ch</span>
                              <span>·</span>
                              <span>
                                {vol.report.totalVerses.toLocaleString()} {unitLabel}
                              </span>
                              <span>·</span>
                              <span>{formatCompactMb(vol.report.totalBytes)} raw</span>
                            </div>
                            <label className="inline-flex items-center gap-1.5 font-sans text-xs font-medium text-slate-700 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={vol.includeConcordance}
                                onChange={(e) =>
                                  handleUpdateVolume(idx, { includeConcordance: e.target.checked })
                                }
                                className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
                              />
                              <span>{isBibleMode ? 'Concordance Index' : 'Search Index'}</span>
                            </label>
                          </div>

                          {vol.report.warnings.length > 0 && (
                            <div className="mt-2.5 ml-6 p-2.5 rounded-lg border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1">
                              {vol.report.warnings.map((w, wIdx) => (
                                <p key={wIdx}>{w}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Quick Drop Zone */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
                    }}
                    className={`rounded-lg border border-dashed px-4 py-3 text-center text-xs cursor-pointer transition-colors ${
                      isDragging
                        ? 'border-indigo-600 bg-indigo-50 text-indigo-800'
                        : 'border-slate-300 bg-slate-50/70 text-slate-600 hover:border-slate-400 hover:text-slate-900'
                    }`}
                  >
                    {isBibleMode
                      ? 'Drop another Bible .json translation to bundle onto this cartridge'
                      : 'Drop another .txt, .md, .epub, .html, or Bible .json to add it to this cartridge'}
                  </div>

                  {/* Text Spot-Check Drawer */}
                  {inspectedVol && inspectedBook && (
                    <div className="pt-4 border-t border-slate-200">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <span className="text-xs font-mono font-semibold text-indigo-700">
                            [{inspectedVol.code}]
                          </span>
                          {inspectedVol.report.books.length > 1 && (
                            <label className="text-xs font-medium text-slate-600 flex items-center gap-2">
                              {isBibleMode ? 'Book' : 'Section'}
                              <select
                                value={active.inspectBookIdx}
                                onChange={(e) =>
                                  patchActive((p) => ({
                                    ...p,
                                    inspectBookIdx: Number(e.target.value),
                                    inspectChapIdx: 0,
                                  }))
                                }
                                className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900"
                              >
                                {inspectedVol.report.books.map((b, bIdx) => (
                                  <option key={`${b.name}-${bIdx}`} value={bIdx}>
                                    {b.name} ({b.chapters.length} ch)
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          <label className="text-xs font-medium text-slate-600 flex items-center gap-2">
                            Chapter
                            <select
                              value={active.inspectChapIdx}
                              onChange={(e) =>
                                patchActive((p) => ({
                                  ...p,
                                  inspectChapIdx: Number(e.target.value),
                                }))
                              }
                              className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 font-mono"
                            >
                              {inspectedBook.chapters.map((c, cIdx) => (
                                <option key={c.chapter} value={cIdx}>
                                  {c.chapter} ({c.verses.length}{' '}
                                  {inspectedVol.report.libraryMode === 'bible' ? 'vs' : '¶'})
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            patchActive((p) => ({ ...p, showRawSample: !p.showRawSample }))
                          }
                          className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4"
                        >
                          {active.showRawSample ? 'Hide Source Excerpt' : 'View Source Excerpt'}
                        </button>
                      </div>

                      {active.showRawSample && inspectedVol.report.rawPreview && (
                        <pre className="mb-3 max-h-44 overflow-auto bg-slate-950 text-slate-200 rounded-lg p-3 text-[11px] font-mono leading-relaxed">
                          {inspectedVol.report.rawPreview}
                        </pre>
                      )}

                      <div className="max-h-48 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs leading-relaxed text-slate-700 space-y-2">
                        {inspectedChapter?.verses.slice(0, 30).map((v) => (
                          <p key={v.verse}>
                            {inspectedVol.report.libraryMode === 'bible' && (
                              <span className="font-mono font-semibold text-indigo-700 mr-1.5">
                                {v.verse}{' '}
                              </span>
                            )}
                            {renderFormattedLine(v.text)}
                          </p>
                        ))}
                        {(inspectedChapter?.verses.length ?? 0) > 30 && (
                          <p className="text-slate-500 font-mono pt-1">
                            Showing first 30 of {inspectedChapter?.verses.length} items.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {active.showPasteBox && (
                <div className="mt-4 pt-4 border-t border-slate-200 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div className="sm:col-span-3">
                      <input
                        type="text"
                        maxLength={7}
                        value={active.pastedCode}
                        onChange={(e) =>
                          patchActive((p) => ({
                            ...p,
                            pastedCode: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
                          }))
                        }
                        placeholder={isBibleMode ? 'Code (KJV)' : 'Code (NOTES)'}
                        className="w-full px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="sm:col-span-9">
                      <input
                        type="text"
                        maxLength={23}
                        value={active.pastedName}
                        onChange={(e) =>
                          patchActive((p) => ({ ...p, pastedName: e.target.value }))
                        }
                        placeholder={
                          isBibleMode
                            ? 'Translation Name (e.g. King James Version)'
                            : 'Book Title (e.g. Pocket Field Notes)'
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <textarea
                    value={active.pastedText}
                    onChange={(e) =>
                      patchActive((p) => ({ ...p, pastedText: e.target.value }))
                    }
                    rows={5}
                    placeholder={
                      isBibleMode
                        ? 'Paste raw Bible JSON content here...'
                        : 'Paste plain text, Markdown (# Chapter 1 ...), or Bible JSON here...'
                    }
                    className="w-full rounded-lg border border-slate-300 p-3 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          addVolumeFromString(
                            active.pastedText,
                            `${active.pastedCode.toLowerCase() || 'pasted'}.${
                              isBibleMode ? 'json' : 'txt'
                            }`,
                            active.pastedCode,
                            active.pastedName
                          );
                          patchActive((p) => ({ ...p, pastedText: '' }));
                        } catch (err) {
                          patchActive((p) => ({
                            ...p,
                            parseError:
                              err instanceof Error ? err.message : 'Failed to parse pasted content',
                          }));
                        }
                      }}
                      disabled={!active.pastedText.trim()}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg disabled:opacity-40"
                    >
                      {isBibleMode ? 'Add Pasted JSON' : 'Add Pasted Book'}
                    </button>
                  </div>
                </div>
              )}

              {activeError && (
                <div className="mt-4 p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 whitespace-pre-wrap font-mono">
                  {activeError}
                </div>
              )}
            </section>

            {/* Step 02: Reader & ROM Configuration */}
            <section
              id="rom-settings"
              className="bg-white border border-slate-200 rounded-xl p-6"
            >
              <div className="mb-5">
                <h2 className="font-display text-lg font-semibold text-slate-900">
                  02. Reader &amp; Cartridge Settings
                </h2>
                <p className="text-sm text-slate-600">
                  Configure cartridge header metadata, LCD typography density,{' '}
                  {isBibleMode ? 'verse flow' : 'paragraph flow'}, and palette.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 pb-5 border-b border-slate-100">
                <div>
                  <label
                    htmlFor="rom-title"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    ROM Header Title (Max 12 ASCII)
                  </label>
                  <input
                    id="rom-title"
                    type="text"
                    maxLength={12}
                    value={active.config.romTitle}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, '');
                      patchActive((p) => ({
                        ...p,
                        titleManuallyEdited: true,
                        config: { ...p.config, romTitle: val },
                      }));
                    }}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>

                <div>
                  <label
                    htmlFor="game-code"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Cartridge Game Code (4 Chars)
                  </label>
                  <input
                    id="game-code"
                    type="text"
                    maxLength={4}
                    value={active.config.gameCode}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                      patchActive((p) => ({
                        ...p,
                        titleManuallyEdited: true,
                        config: { ...p.config, gameCode: val },
                      }));
                    }}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 py-5 border-b border-slate-100">
                {/* Font Size */}
                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-2">
                    Bitmap Font Cell
                  </span>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, fontStyle: '6x8' },
                        }))
                      }
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        active.config.fontStyle === '6x8'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      6×8 Crisp (38 cols)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, fontStyle: '8x8' },
                        }))
                      }
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        active.config.fontStyle === '8x8'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      8×8 Bold (28 cols)
                    </button>
                  </div>
                </div>

                {/* Line Spacing */}
                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-2">
                    Line Density
                  </span>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, lineSpacing: 'comfortable' },
                        }))
                      }
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        active.config.lineSpacing === 'comfortable'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      14 Lines (9px)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, lineSpacing: 'compact' },
                        }))
                      }
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        active.config.lineSpacing === 'compact'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      16 Lines (8px)
                    </button>
                  </div>
                </div>

                {/* Verse / Paragraph Flow */}
                <div>
                  <span className="block text-xs font-medium text-slate-700 mb-2">
                    {isBibleMode ? 'Verse Layout' : 'Paragraph Flow'}
                  </span>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, verseLayout: 'paragraph' },
                        }))
                      }
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        active.config.verseLayout === 'paragraph'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {isBibleMode ? 'Prose Paragraphs' : 'Spacious / Prose'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, verseLayout: 'verse-per-line' },
                        }))
                      }
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        active.config.verseLayout === 'verse-per-line'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {isBibleMode ? 'Verse-per-Line' : 'Compact / Lines'}
                    </button>
                  </div>
                </div>

                {/* Checkboxes */}
                <div className="flex flex-col justify-center gap-2">
                  <label className="inline-flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active.config.bootToMain}
                      onChange={(e) =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, bootToMain: e.target.checked },
                        }))
                      }
                      className="w-4 h-4 rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
                    />
                    {isBibleMode ? 'Boot to Main Translation Menu' : 'Boot to Library Shelf'}
                  </label>
                  <label className="inline-flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active.config.showVerseNumbers}
                      onChange={(e) =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, showVerseNumbers: e.target.checked },
                        }))
                      }
                      className="w-4 h-4 rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
                    />
                    {isBibleMode
                      ? 'Show accent verse numbers'
                      : 'Show accent verse numbers (Bible JSONs)'}
                  </label>
                  <label className="inline-flex items-center gap-2.5 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active.config.padToPowerOfTwo}
                      onChange={(e) =>
                        patchActive((p) => ({
                          ...p,
                          config: { ...p.config, padToPowerOfTwo: e.target.checked },
                        }))
                      }
                      className="w-4 h-4 rounded border-slate-300 text-indigo-700 focus:ring-indigo-600"
                    />
                    Pad ROM to power-of-two size for flashcarts
                  </label>
                </div>
              </div>

              {/* Default Boot Palette */}
              <div className="pt-5">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-medium text-slate-700">
                    Default Boot Palette (Cycle anytime with SELECT)
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {GBA_THEMES.map((theme, idx) => {
                    const activeTheme = active.config.defaultThemeIndex === idx;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() =>
                          patchActive((p) => ({
                            ...p,
                            config: { ...p.config, defaultThemeIndex: idx },
                          }))
                        }
                        className={`text-left p-2.5 rounded-lg border transition-colors ${
                          activeTheme
                            ? 'border-indigo-700 bg-indigo-50/40'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1">
                            <span
                              className="w-3.5 h-3.5 rounded-sm border border-black/15"
                              style={{ backgroundColor: theme.colors.bg }}
                            />
                            <span
                              className="w-3.5 h-3.5 rounded-sm border border-black/15"
                              style={{ backgroundColor: theme.colors.ink }}
                            />
                            <span
                              className="w-3.5 h-3.5 rounded-sm border border-black/15"
                              style={{ backgroundColor: theme.colors.verse }}
                            />
                          </div>
                          {activeTheme && <Check className="w-3.5 h-3.5 text-indigo-700" />}
                        </div>
                        <div className="text-xs font-semibold text-slate-900">{theme.name}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* Step 03: Compiled ROM Output */}
            <section className="bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900">
                    03. Compiled GBA Binary
                  </h2>
                  <p className="text-sm text-slate-600">
                    {isBibleMode
                      ? 'Includes official Nintendo boot logo, header checksum, BPE decoder, and SRAM_V113 saves.'
                      : 'Includes official Nintendo boot logo, header checksum, BPE decoder, and per-book SRAM_V113 saves.'}
                  </p>
                </div>
                {buildResult && (
                  <button
                    type="button"
                    onClick={handleDownloadRom}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-700 hover:bg-indigo-800 rounded-lg transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    Download {buildResult.fileName}
                  </button>
                )}
              </div>

              {buildResult ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 py-4 border-y border-slate-100">
                    <div>
                      <div className="text-xs text-slate-500">ROM Binary Size</div>
                      <div className="text-sm font-semibold font-mono text-slate-900">
                        {formatBytes(buildResult.romSizeBytes)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">
                        {isBibleMode ? 'Translations Bundled' : 'Books Bundled'}
                      </div>
                      <div className="text-sm font-semibold font-mono text-slate-900">
                        {buildResult.translationsEncoded} ({buildResult.chaptersEncoded.toLocaleString()}{' '}
                        ch)
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">BPE Compressed Text</div>
                      <div className="text-sm font-semibold font-mono text-slate-900">
                        {formatCompactMb(buildResult.compressedTextBytes)} (was{' '}
                        {formatCompactMb(buildResult.uncompressedTextBytes)})
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">
                        {isBibleMode ? 'Concordance Index' : 'Search Index (16-bit)'}
                      </div>
                      <div className="text-sm font-semibold font-mono text-slate-900">
                        {buildResult.concordanceWordsEncoded.toLocaleString()} words (
                        {formatBytes(buildResult.concordanceBytes)})
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Header / CRC32</div>
                      <div className="text-sm font-semibold font-mono text-slate-900">
                        0x{buildResult.headerChecksum.toString(16).padStart(2, '0').toUpperCase()} ·{' '}
                        {buildResult.globalCrc32.toString(16).padStart(8, '0').toUpperCase()}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Save Hardware ID</div>
                      <div className="text-sm font-semibold font-mono text-slate-900">
                        SRAM_V113 · ERD4
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setShowHeaderHex((v) => !v)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      <HardDrive className="w-3.5 h-3.5" />
                      {showHeaderHex ? 'Hide 192-Byte Header Dump' : 'Inspect 192-Byte Header Dump'}
                    </button>
                    {active.downloadNotice && (
                      <span className="text-xs font-medium text-emerald-700">
                        {active.downloadNotice}
                      </span>
                    )}
                  </div>

                  {showHeaderHex && <RomHeaderInspector buildResult={buildResult} />}
                </>
              ) : (
                <div className="py-6 border-t border-slate-100 text-sm text-slate-500">
                  {isBibleMode
                    ? 'Load a Bible JSON translation (or click Load Sample Scripture) above to compile your .gba ROM.'
                    : 'Add one or more books (.txt, .md, .epub, .html, or Bible .json) above to compile your .gba cartridge.'}
                </div>
              )}
            </section>
          </div>

          {/* Right Column: Interactive GBA Handheld Preview */}
          <aside id="hardware-preview" className="lg:col-span-5 lg:sticky lg:top-24">
            <GbaHandheldPreview
              buildResult={buildResult}
              romTitle={active.config.romTitle}
              defaultThemeIndex={active.config.defaultThemeIndex}
              translationCodes={volumeCodes}
              studioMode={studioMode}
            />
          </aside>
        </div>

        {/* Bottom Reference Section: Flashcart Guide & Controls */}
        <section
          id="flashcart-guide"
          className="mt-12 pt-8 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-8"
        >
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 mb-2">
              {isBibleMode ? 'Parallel Verse Sync & SRAM' : 'Per-Book SRAM Library Saves'}
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              {isBibleMode ? (
                <>
                  Switch translations anytime with <span className="font-mono text-slate-800">L + R</span> — the
                  firmware automatically keeps your current book, chapter, and exact verse aligned, while
                  saving your progress and bookmark inside <span className="font-mono text-slate-800">SRAM_V113</span>.
                </>
              ) : (
                <>
                  Every book on your cartridge gets its own independent save slot inside the flashcart’s{' '}
                  <span className="font-mono text-slate-800">SRAM_V113</span> memory. Switch freely between novels,
                  manuals, and notes with <span className="font-mono text-slate-800">L + R</span> — each volume remembers
                  its exact chapter and scroll line across power cycles.
                </>
              )}
            </p>
          </div>

          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 mb-2">
              32 MB Cartridge Capacity
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              {isBibleMode ? (
                <>
                  Shared 120-rule lossless Byte-Pair Encoding shrinks full Bibles down to ~2.4 MB each with
                  complete Concordance indices — letting 3 to 4 complete translations fit cleanly on one 32 MB
                  flashcart ROM.
                </>
              ) : (
                <>
                  Shared 120-rule lossless Byte-Pair Encoding shrinks typical plain-text books by ~40%. Three to four full-length
                  novels plus complete word-search indices fit in roughly 2–3 MB — leaving room for 15–25+ searchable books on one 32 MB flashcart ROM.
                </>
              )}
            </p>
          </div>

          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 mb-2">
              On-Hardware Controls
            </h3>
            <div className="text-xs text-slate-600 space-y-1.5">
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">A or START (reading)</span>
                <span>{isBibleMode ? 'Open Books / Chapters' : 'Open Chapters / Sections'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">L + R Together</span>
                <span>{isBibleMode ? 'Return to Main Menu' : 'Return to Library Shelf'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">D-Pad Up / Down</span>
                <span>Scroll line by line (or pick item)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">D-Pad Left / Right</span>
                <span>Page Up / Page Down</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">L / R Bumpers</span>
                <span>{isBibleMode ? 'Prev/Next Ch (OT/NT in Books)' : 'Prev / Next Chapter'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">B (while reading)</span>
                <span>Save Quick Bookmark to SRAM</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">SELECT (tap)</span>
                <span>Cycle 4 Themes (or Jump Bookmark)</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">START + A / SELECT + A</span>
                <span>{isBibleMode ? 'Concordance Word Search' : 'Full-Text Search & Snippets'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/70">
                <span className="font-mono font-semibold text-slate-800">START + L</span>
                <span>
                  {isBibleMode ? 'Toggle Prose / Verse-per-Line' : 'Toggle Spacious / Compact Flow'}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="font-mono font-semibold text-slate-800">START + R</span>
                <span>Toggle 14 Lines (9px) / 16 Lines (8px)</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
