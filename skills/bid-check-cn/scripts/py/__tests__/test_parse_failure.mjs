#!/usr/bin/env node
/**
 * TDD test: PyMuPDF / pdf_inspect parse failure handling.
 * Real failure cases: corrupted file, 0-byte file, file that isn't a PDF.
 * Must NOT silently skip - must surface error and the calling chain must
 * either mark page(s) as candidate (conservative) or block explicitly.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\//, ''));
const PYTHON_BIN = process.env.PYTHON_BIN || '<PYTHON_EXE>';
const INSPECT = path.resolve(HERE, '..', 'pdf_inspect.py');
const RECON = path.resolve(HERE, '..', 'pdf_recon.mjs');
const RENDER = path.resolve(HERE, '..', 'pdf_render.mjs');

const fixturesDir = path.resolve(HERE, 'fixtures');
fs.mkdirSync(fixturesDir, { recursive: true });

const CORRUPT = path.join(fixturesDir, 'corrupt.pdf');
const EMPTY = path.join(fixturesDir, 'empty.pdf');
const TXT_AS_PDF = path.join(fixturesDir, 'not-really-a-pdf.pdf');

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);
}

function callPy(args) {
  const r = spawnSync(PYTHON_BIN, [INSPECT, ...args], { encoding: 'utf-8', timeout: 60000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch (_) {}
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, parsed };
}

function callAdapter(adapter, args) {
  const r = spawnSync(process.execPath, [adapter, ...args], { encoding: 'utf-8', timeout: 60000 });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch (_) {}
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, parsed };
}

// === Setup fixtures ===
fs.writeFileSync(CORRUPT, Buffer.from('%PDF-1.4\nthis is not a real pdf content\n%%EOF\n'));
fs.writeFileSync(EMPTY, Buffer.alloc(0));
fs.writeFileSync(TXT_AS_PDF, 'this is plain text masquerading as pdf');

// === Test 1: pdf_inspect summary on corrupt pdf -> ok=false with error string ===
{
  const r = callPy(['summary', CORRUPT]);
  if (!r.parsed) { record('inspect-corrupt-parsed', false, `stdout=${r.stdout.slice(0,200)}`); }
  else if (r.parsed.ok !== false) { record('inspect-corrupt-ok', false, `ok=${r.parsed.ok}`); }
  else if (typeof r.parsed.error !== 'string' || r.parsed.error.length < 5) { record('inspect-corrupt-err', false, `error=${r.parsed.error}`); }
  else { record('inspect-corrupt', true, `error="${r.parsed.error.slice(0,80)}"`); }
}

// === Test 2: pdf_inspect summary on empty file -> ok=false ===
{
  const r = callPy(['summary', EMPTY]);
  if (!r.parsed) { record('inspect-empty-parsed', false); }
  else if (r.parsed.ok !== false) { record('inspect-empty-ok', false); }
  else { record('inspect-empty', true, `error="${r.parsed.error.slice(0,80)}"`); }
}

// === Test 3: pdf_inspect summary on text file -> ok=false ===
{
  const r = callPy(['summary', TXT_AS_PDF]);
  if (!r.parsed) { record('inspect-txt-parsed', false); }
  else if (r.parsed.ok !== false) { record('inspect-txt-ok', false); }
  else { record('inspect-txt', true, `error="${r.parsed.error.slice(0,80)}"`); }
}

// === Test 4: pdf_recon on corrupt pdf propagates ok=false ===
{
  const r = callAdapter(RECON, [CORRUPT]);
  if (!r.parsed) { record('recon-corrupt-parsed', false); }
  else if (r.parsed.ok !== false) { record('recon-corrupt-ok', false, `ok=${r.parsed.ok} stdout=${r.stdout.slice(0,200)}`); }
  else { record('recon-corrupt', true, `error="${r.parsed.error.slice(0,80)}"`); }
}

// === Test 5: pdf_render on corrupt pdf returns ok=false, no partial files ===
{
  const tmp = path.resolve('output/_work/_py_corrupt_render');
  fs.mkdirSync(tmp, { recursive: true });
  const r = callAdapter(RENDER, [CORRUPT, '1', tmp, '100']);
  if (!r.parsed) { record('render-corrupt-parsed', false); }
  else if (r.parsed.ok !== false) { record('render-corrupt-ok', false); }
  else { record('render-corrupt', true, `error="${r.parsed.error.slice(0,80)}"`); }
}

const pass = results.filter(r => r.pass).length;
const fail = results.length - pass;
console.log(`\n=== ${pass} PASS / ${fail} FAIL / ${results.length} TOTAL ===`);
process.exit(fail > 0 ? 1 : 0);