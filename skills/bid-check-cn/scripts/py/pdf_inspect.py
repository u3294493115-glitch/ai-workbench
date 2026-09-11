#!/usr/bin/env python3
"""bid-check-cn PDF inspect adapter (PyMuPDF only).

Subcommands:
  summary <pdf_path>                 -> per-page metadata JSON
  render   <pdf_path> <pages_csv> <out_dir> [dpi]
  text     <pdf_path> [out_path]     -> per-page text JSON or written file
                                         with === PAGE N === markers

All output is a single JSON object on stdout: {"ok": bool, ...}.
This adapter does NOT implement PDF parsing / rendering / OCR. It only
delegates to PyMuPDF (pymupdf).
"""
from __future__ import annotations

import json
import os
import sys

import pymupdf

# Force stdout to UTF-8 on Windows (default GBK breaks Chinese JSON output).
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def _doc_open(path: str):
    """Open PDF with explicit error surfacing (no silent skip)."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"PDF not found: {path}")
    doc = pymupdf.open(path)
    if doc.is_closed:
        raise ValueError(f"PDF closed / corrupt: {path}")
    if doc.needs_pass:
        raise ValueError(f"PDF password-protected: {path}")
    if doc.is_encrypted:
        raise ValueError(f"PDF encrypted: {path}")
    if len(doc) == 0:
        raise ValueError(f"PDF has 0 pages: {path}")
    return doc


def cmd_summary(path: str) -> dict:
    try:
        doc = _doc_open(path)
    except Exception as e:
        return {"ok": False, "error": str(e), "pdf_path": path}
    try:
        pages = []
        for i in range(len(doc)):
            page = doc[i]
            text_chars = len(page.get_text("text").strip())
            images = page.get_images(full=True)
            max_image_frac = 0.0
            page_area = page.rect.width * page.rect.height
            for img in images:
                xref = img[0]
                rects = page.get_image_rects(xref)
                for r in rects:
                    a = r.width * r.height
                    if page_area > 0:
                        f = a / page_area
                        if f > max_image_frac:
                            max_image_frac = f
            pages.append({
                "page": i + 1,
                "text_chars": text_chars,
                "image_count": len(images),
                "max_image_frac": round(max_image_frac, 4),
            })
        return {"ok": True, "pdf_path": path, "pdf_pages": len(doc), "pages": pages}
    except Exception as e:
        return {"ok": False, "error": str(e), "pdf_path": path}
    finally:
        doc.close()


def cmd_render(path: str, pages_csv: str, out_dir: str, dpi: int = 150) -> dict:
    try:
        doc = _doc_open(path)
    except Exception as e:
        return {"ok": False, "error": str(e), "pdf_path": path}
    try:
        os.makedirs(out_dir, exist_ok=True)
        rendered = []
        failures = []
        zoom = dpi / 72
        mat = pymupdf.Matrix(zoom, zoom)
        try:
            page_nums = [int(x) for x in pages_csv.split(",") if x.strip()]
        except ValueError as e:
            return {"ok": False, "error": f"invalid pages_csv: {pages_csv} ({e})"}
        for n in page_nums:
            if n < 1 or n > len(doc):
                failures.append({"page": n, "error": f"out_of_range (1..{len(doc)})"})
                continue
            try:
                page = doc[n - 1]
                pix = page.get_pixmap(matrix=mat, alpha=False)
                png_bytes = pix.tobytes("png")
                out_file = os.path.join(out_dir, f"p-{n}.png")
                with open(out_file, "wb") as f:
                    f.write(png_bytes)
                rendered.append({"page": n, "path": out_file, "bytes": len(png_bytes)})
            except Exception as e:
                failures.append({"page": n, "error": str(e)})
        return {"ok": True, "pdf_path": path, "out_dir": out_dir, "dpi": dpi, "rendered": rendered, "failures": failures}
    except Exception as e:
        return {"ok": False, "error": str(e), "pdf_path": path}
    finally:
        doc.close()


def cmd_text(path: str, out_path: str | None = None) -> dict:
    """Extract per-page text. Returns JSON with full text payload (truncation
    handled by caller if needed). When out_path is given, also writes a
    `=== PAGE N ===`-delimited text file for human/grep consumption.

    Failure modes (must surface as ok=false, never silent skip):
      - missing/empty/locked/encrypted/0-page PDF
      - invalid out_path (parent dir not creatable, permission denied)
    """
    try:
        doc = _doc_open(path)
    except Exception as e:
        return {"ok": False, "error": str(e), "pdf_path": path}
    try:
        pages = []
        total_chars = 0
        for i in range(len(doc)):
            page = doc[i]
            text = page.get_text("text") or ""
            pages.append({
                "page": i + 1,
                "text_chars": len(text.strip()),
                "text": text,
            })
            total_chars += len(text)
        result = {
            "ok": True,
            "pdf_path": path,
            "pdf_pages": len(doc),
            "total_chars": total_chars,
            "pages": pages,
        }
        if out_path:
            try:
                parent = os.path.dirname(out_path)
                if parent:
                    os.makedirs(parent, exist_ok=True)
                with open(out_path, "w", encoding="utf-8") as f:
                    for p in pages:
                        f.write(f"=== PAGE {p['page']} ===\n")
                        f.write(p["text"])
                        f.write("\n")
                result["out_path"] = out_path
                result["out_bytes"] = os.path.getsize(out_path)
            except Exception as e:
                return {"ok": False, "error": f"failed to write out_path: {e}", "pdf_path": path}
        return result
    except Exception as e:
        return {"ok": False, "error": str(e), "pdf_path": path}
    finally:
        doc.close()


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(json.dumps({"ok": False, "error": "usage: pdf_inspect.py summary <pdf> | render <pdf> <pages_csv> <out_dir> [dpi] | text <pdf> [out_path]"}))
        return 2
    cmd = argv[1]
    if cmd == "summary":
        if len(argv) < 3:
            print(json.dumps({"ok": False, "error": "summary requires <pdf_path>"}))
            return 2
        print(json.dumps(cmd_summary(argv[2]), ensure_ascii=False))
        return 0
    if cmd == "render":
        if len(argv) < 5:
            print(json.dumps({"ok": False, "error": "render requires <pdf_path> <pages_csv> <out_dir> [dpi]"}))
            return 2
        dpi = int(argv[5]) if len(argv) >= 6 else 150
        print(json.dumps(cmd_render(argv[2], argv[3], argv[4], dpi), ensure_ascii=False))
        return 0
    if cmd == "text":
        if len(argv) < 3:
            print(json.dumps({"ok": False, "error": "text requires <pdf_path> [out_path]"}))
            return 2
        out_path = argv[3] if len(argv) >= 4 else None
        print(json.dumps(cmd_text(argv[2], out_path), ensure_ascii=False))
        return 0
    print(json.dumps({"ok": False, "error": f"unknown command: {cmd}"}))
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))