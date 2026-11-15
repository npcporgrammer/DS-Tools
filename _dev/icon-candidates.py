"""图标候选 v2：对比图，修正排版。
   用法： python icon-candidates.py
   产出： %TEMP%/icon-candidates.png
"""
import os
import tempfile
from PIL import Image, ImageDraw, ImageFont

PINE = (47, 93, 80, 255)
PAPER = (253, 252, 249, 255)
OCHRE = (198, 145, 63, 255)

SIZES = [256, 64, 32, 16]


def blank(size, ss=4):
    img = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size * ss - 1, size * ss - 1],
                        radius=int(size * ss * 0.23), fill=PINE)
    return img, d


def mapper(size, box_ratio=0.62):
    box = size * box_ratio
    scale = box / 24.0
    off = (size - box) / 2.0
    return (lambda p: (off + p[0] * scale, off + p[1] * scale)), scale


def bez(p0, p1, p2, p3, n=24):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0]
        y = u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]
        pts.append((x, y))
    return pts


def brace_path(mirror=False):
    """左花括号，x 从 10 收向 7.2，腰点在 (8.4,12)"""
    pts = []
    pts += bez((10.2, 3.6), (7.6, 3.6), (7.2, 4.6), (7.2, 6.6))
    pts += bez((7.2, 6.6), (7.2, 9.4), (7.2, 10.4), (8.6, 12.0))
    pts += bez((8.6, 12.0), (7.2, 13.6), (7.2, 14.6), (7.2, 17.4))
    pts += bez((7.2, 17.4), (7.2, 19.4), (7.6, 20.4), (10.2, 20.4))
    if mirror:
        pts = [(24.0 - x, y) for x, y in pts]
    return pts


def polyline(d, T, pts, w, color=PAPER):
    d.line([T(p) for p in pts], fill=color, width=w, joint="curve")


# ---------------- 方案 ----------------

def mark_graph(d, T, scale, w):
    for p, q in (((12, 5.6), (5.4, 18)), ((12, 5.6), (18.6, 18))):
        dx, dy = q[0]-p[0], q[1]-p[1]
        L = (dx*dx+dy*dy) ** 0.5
        ux, uy = dx/L, dy/L
        d.line([T((p[0]+ux*3.3, p[1]+uy*3.3)), T((q[0]-ux*3.3, q[1]-uy*3.3))], fill=PAPER, width=w)
    d.line([T((8.1, 18)), T((15.9, 18))], fill=PAPER, width=w)
    cx, cy = T((12, 5.6)); r = 2.7*scale
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=PAPER)
    for n in ((5.4, 18), (18.6, 18)):
        cx, cy = T(n); r = 2.7*scale
        d.ellipse([cx-r, cy-r, cx+r, cy+r], outline=PAPER, width=w)


def mark_lattice(d, T, scale, w):
    top, l, r, bot = (12, 4.4), (4.8, 12), (19.2, 12), (12, 19.6)
    for a, b in ((top, l), (top, r), (l, bot), (r, bot)):
        d.line([T(a), T(b)], fill=PAPER, width=w)
    for n in (l, r, bot):
        cx, cy = T(n); rr = 2.3*scale
        d.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], fill=PINE, outline=PAPER, width=w)
    cx, cy = T(top); rr = 2.3*scale
    d.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], fill=PAPER)


def mark_braces(d, T, scale, w):
    polyline(d, T, brace_path(False), w)
    polyline(d, T, brace_path(True), w)
    cx, cy = T((12, 12)); r = 1.7*scale
    d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=PAPER)


def mark_box(d, T, scale, w):
    """工具箱：带提手的方盒 + 内部的图节点"""
    # 提手
    d.line([T((9.4, 4.6)), T((9.4, 2.6))], fill=PAPER, width=w)
    d.line([T((14.6, 4.6)), T((14.6, 2.6))], fill=PAPER, width=w)
    d.line([T((9.4, 2.6)), T((14.6, 2.6))], fill=PAPER, width=w)
    # 箱体
    d.rounded_rectangle([T((3.6, 4.6)), T((20.4, 20.4))], radius=int(2.2*scale),
                        outline=PAPER, width=w)
    # 箱内：三节点
    a, b, c = (12, 9.2), (7.6, 16.4), (16.4, 16.4)
    for p, q in ((a, b), (a, c), (b, c)):
        d.line([T(p), T(q)], fill=PAPER, width=w)
    for n, fill in ((a, PAPER), (b, PINE), (c, PINE)):
        cx, cy = T(n); rr = 1.55*scale
        d.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], fill=fill, outline=PAPER, width=w)


def mark_subset(d, T, scale, w):
    """加粗的 ⊂（真子集）"""
    d.arc([T((4.0, 3.0)), T((20.0, 21.0))], start=60, end=300, fill=PAPER, width=int(w*1.6))


MARKS = [
    ("A 旧：图节点", mark_graph),
    ("B 偏序格", mark_lattice),
    ("C 花括号元素", mark_braces),
    ("D 工具箱+图", mark_box),
    ("E ⊂ 子集", mark_subset),
]


def render(fn, size, ss=4):
    img, d = blank(size, ss)
    T, scale = mapper(size * ss)
    fn(d, T, scale, max(1, int(round(size * ss * 0.028))))
    return img.resize((size, size), Image.LANCZOS)


def main():
    pad = 28
    label_w = 190
    row_h = 256 + 30
    sheet_w = label_w + len(SIZES) * (256 + pad) + pad
    sheet_h = len(MARKS) * row_h + pad
    sheet = Image.new("RGB", (sheet_w, sheet_h), (243, 242, 241))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("msyh.ttc", 16)
    except Exception:
        font = ImageFont.load_default()

    for r, (label, fn) in enumerate(MARKS):
        y = pad + r * row_h
        d.text((pad, y + 118), label, fill=(40, 40, 40), font=font)
        for c, s in enumerate(SIZES):
            img = render(fn, s)
            x = label_w + c * (256 + pad)
            sheet.paste(img, (x, y + (256 - s) // 2), img)

    out = os.path.join(tempfile.gettempdir(), "icon-candidates.png")
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
