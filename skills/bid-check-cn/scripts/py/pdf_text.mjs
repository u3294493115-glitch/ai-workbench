#!/usr/bin/env node
/**
 * bid-check-cn thin PDF text-extract adapter (v3.3.0-pymupdf closure fix).
 *
 * Wraps scripts/py/pdf_inspect.py text. All PDF text extraction delegated to
 * PyMuPDF (pymupdf).
 *
 * Usage:
 *   node scripts/py/pdf_text.mjs <pdf_path> [out_path]
 *
 * - Without out_path: returns JSON with full per-page text in `pages[].text`.
 * - With out_path: also writes a `=== PAGE N ===`-delimited text file
 *   (suitable for grep / human reading / Stage 1 keyword search).
 *
 * Failure modes (ok=false, never silent):
 *   - PDF missing/corrupt/encrypted/0-page
 *   - write failure (parent dir not creatable, permission denied)
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const PYTHON_BIN = process.env.PYTHON_BIN
  || '<PYTHON_EXE>';
const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'pdf_inspect.py');

function usage() {
  console.log(JSON.stringify({ ok: false, error: 'usage: node scripts/py/pdf_text.mjs <pdf_path> [out_path]' }, null, 2));
  process.exit(0);
}

const [pdfPath, outPath] = process.argv.slice(2);
if (!pdfPath) usage();

if (!fs.existsSync(pdfPath)) {
  console.log(JSON.stringify({ ok: false, error: `pdf not found: ${pdfPath}` }, null, 2));
  process.exit(0);
}
if (!fs.existsSync(SCRIPT)) {
  console.log(JSON.stringify({ ok: false, error: `pdf_inspect.py missing: ${SCRIPT}` }, null, 2));
  process.exit(0);
}

const pyArgs = [SCRIPT, 'text', pdfPath];
if (outPath) pyArgs.push(outPath);

const r = spawnSync(PYTHON_BIN, pyArgs, { encoding: 'utf-8', timeout: 300000 });
let inspect;
try { inspect = JSON.parse(r.stdout); } catch (e) {
  console.log(JSON.stringify({ ok: false, error: `pdf_inspect.py returned non-JSON: ${r.stdout.slice(0,200)} stderr=${r.stderr.slice(0,200)}` }, null, 2));
  process.exit(0);
}

if (!inspect || inspect.ok !== true) {
  console.log(JSON.stringify({ ok: false, error: inspect?.error || 'pdf_inspect.py returned ok=false', pdf_path: inspect?.pdf_path || pdfPath }, null, 2));
  process.exit(0);
}

const totalChars = inspect.total_chars || 0;
const out = {
  ok: true,
  pdf_path: path.resolve(pdfPath),
  pdf_pages: inspect.pdf_pages,
  total_chars: totalChars,
  pages: inspect.pages || [],
  out_path: inspect.out_path ? path.resolve(inspect.out_path) : undefined,
  out_bytes: inspect.out_bytes || undefined,
};
console.log(JSON.stringify(out, null, 2));
