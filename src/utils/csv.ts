export type CsvCell = string | number | boolean | null | undefined;

/** Cells starting with these are read as formulas by spreadsheets; cluster data is not trusted. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v: CsvCell): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV, CRLF line ends, formula-looking cells neutralised. */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Saves `csv` as a file (UTF-8 with BOM so Excel reads accents correctly). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function csvFilename(base: string, now: Date = new Date()): string {
  return `${base}-${now.toISOString().slice(0, 10)}.csv`;
}
