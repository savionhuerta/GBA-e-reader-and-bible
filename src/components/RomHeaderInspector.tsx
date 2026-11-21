import React from 'react';
import { RomBuildResult } from '../lib/gbaRomCompiler';

interface RomHeaderInspectorProps {
  buildResult: RomBuildResult;
}

export const RomHeaderInspector: React.FC<RomHeaderInspectorProps> = ({ buildResult }) => {
  const headerBytes = buildResult.rom.slice(0, 192);
  const rows: Array<{ offset: string; hex: string; ascii: string; annotation: string }> = [];

  const getAnnotation = (off: number): string => {
    if (off === 0x00) return 'ARM Entry Branch (B 0x080000C0)';
    if (off >= 0x10 && off <= 0x90) return 'Nintendo Logo Bitmap (156 bytes)';
    if (off === 0xa0) return 'Game Title (12B) + Code (4B)';
    if (off === 0xb0) return 'Maker + 0x96 Fixed + Header Checksum';
    return '';
  };

  for (let off = 0; off < 192; off += 16) {
    const slice = headerBytes.slice(off, off + 16);
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('');
    rows.push({
      offset: `0x${off.toString(16).padStart(3, '0').toUpperCase()}`,
      hex,
      ascii,
      annotation: getAnnotation(off),
    });
  }

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold text-slate-900">
          Cartridge Header Hex Dump (0x000–0x0BF)
        </h4>
        <span className="text-xs font-mono text-slate-500">
          Fixed Byte: 0x{headerBytes[0xb2].toString(16).toUpperCase()} · Checksum: 0x
          {buildResult.headerChecksum.toString(16).padStart(2, '0').toUpperCase()}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 text-slate-200 p-3">
        <table className="w-full text-[11px] font-mono leading-relaxed">
          <tbody>
            {rows.map((r) => (
              <tr key={r.offset} className="hover:bg-slate-900/70">
                <td className="pr-3 text-slate-500 select-none">{r.offset}</td>
                <td className="pr-4 whitespace-nowrap text-slate-100">{r.hex}</td>
                <td className="pr-4 whitespace-nowrap text-indigo-300">{r.ascii}</td>
                <td className="text-slate-400 whitespace-nowrap">{r.annotation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
