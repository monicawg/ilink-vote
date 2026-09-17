#!/usr/bin/env python3
"""
Render candidate case PDFs to sanitized page images.

- Renders every page to 1600px-wide WebP (+ JPG fallback) with no metadata.
- Paints masks over PII regions (PDF point coordinates) and labels them.
- Writes a 640px thumbnail of page 1 per case.

Usage:  python3 tools/render_cases.py  (run from the ilink-vote/ folder)
Source PDFs live OUTSIDE the repo (they contain PII) — see SRC below.
"""
import os, sys
import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SRC_DIR = os.path.join(os.path.dirname(REPO))  # ../ (iLink 互動網頁)
OUT = os.path.join(REPO, "assets", "cases")

WIDTH = 1600
THUMB_W = 640
PAPER = (246, 243, 236)  # warm white, matches the site background

# (x0, y0, x1, y1) in PDF points; label optional
SOURCES = {
    "A": {"file": "Case A.pdf", "masks": {
        1: [((404, 372, 512, 397), "CANDIDATE A")],          # 報告人：姓名
        3: [((166, 356, 224, 374), None)],                    # 截圖 "Hi <name>"
        9: [((90, 336, 115, 363), "WHITE"), ((118, 337, 190, 354), "WHITE"),
            ((90, 445, 115, 472), "WHITE"), ((118, 446, 190, 460), "WHITE")],  # 模擬貼文帳號＋頭像
        11: [((63, 343, 100, 356), None)],                    # 模擬貼文帳號
    }},
    "B": {"file": "CASE B.pdf", "masks": {}},
    "C": {"file": "Case C.pdf", "masks": {}},                 # exported from CASE C.pptx
    "D": {"file": "Case D.pdf", "masks": {
        1: [((46, 424, 250, 449), "CANDIDATE D")],            # 提案人：姓名｜職稱
    }},
}


def font(size):
    for p in ["/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/HelveticaNeue.ttc"]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def render(case, spec):
    path = os.path.join(SRC_DIR, spec["file"])
    if not os.path.exists(path):
        print(f"[{case}] SKIP — missing {path}")
        return 0
    doc = fitz.open(path)
    out = os.path.join(OUT, case)
    os.makedirs(out, exist_ok=True)
    for i, page in enumerate(doc, start=1):
        scale = WIDTH / page.rect.width
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
        draw = ImageDraw.Draw(img)
        for (x0, y0, x1, y1), label in spec["masks"].get(i, []):
            box = (x0 * scale, y0 * scale, x1 * scale, y1 * scale)
            # sample the page's own background near the box so the patch blends in
            sx, sy = int(max(box[0] - 6, 0)), int(box[1] + (box[3] - box[1]) / 2)
            if label == "WHITE":
                fill, label = (255, 255, 255), None
            else:
                fill = img.getpixel((sx, sy)) if label is None else PAPER
            draw.rectangle(box, fill=fill)
            if label:
                h, w = box[3] - box[1], box[2] - box[0]
                f = font(int(min(h * 0.55, w / (len(label) * 0.62))))
                draw.text((box[0] + 8, box[1] + (box[3] - box[1]) * 0.2), label, fill=(17, 17, 17), font=f)
        img.save(os.path.join(out, f"p{i:02d}.webp"), "WEBP", quality=80, method=6)
        small = img.resize((900, int(img.height * 900 / img.width)), Image.LANCZOS)
        small.save(os.path.join(out, f"p{i:02d}.s.webp"), "WEBP", quality=78, method=6)  # phone-size variant
        img.save(os.path.join(out, f"p{i:02d}.jpg"), "JPEG", quality=82, optimize=True)
        if i == 1:
            th = img.resize((THUMB_W, int(img.height * THUMB_W / img.width)), Image.LANCZOS)
            th.save(os.path.join(out, "thumb.webp"), "WEBP", quality=80, method=6)
            th.save(os.path.join(out, "thumb.jpg"), "JPEG", quality=82, optimize=True)
    print(f"[{case}] {len(doc)} pages → {out}")
    return len(doc)


if __name__ == "__main__":
    only = sys.argv[1:] or list(SOURCES)
    for c in only:
        render(c, SOURCES[c])
