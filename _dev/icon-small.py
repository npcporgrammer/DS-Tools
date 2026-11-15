"""D 方案的小尺寸简化对比。"""
import os, tempfile
from PIL import Image, ImageDraw, ImageFont

PINE = (47, 93, 80, 255)
PAPER = (253, 252, 249, 255)
SIZES = [64, 48, 32, 24, 16]


def blank(size, ss=6):
    img = Image.new("RGBA", (size*ss, size*ss), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size*ss-1, size*ss-1], radius=int(size*ss*0.23), fill=PINE)
    return img, d


def mapper(size, r=0.66):
    box = size*r; sc = box/24.0; off = (size-box)/2.0
    return (lambda p: (off+p[0]*sc, off+p[1]*sc)), sc


def box_outline(d, T, sc, w, with_handle=True):
    if with_handle:
        d.line([T((9.6, 4.8)), T((9.6, 2.7))], fill=PAPER, width=w)
        d.line([T((14.4, 4.8)), T((14.4, 2.7))], fill=PAPER, width=w)
        d.line([T((9.6, 2.7)), T((14.4, 2.7))], fill=PAPER, width=w)
    d.rounded_rectangle([T((3.4, 4.8)), T((20.6, 20.6))], radius=int(2.4*sc),
                        outline=PAPER, width=w)


def d1(d, T, sc, w):   # 原始：节点图
    box_outline(d, T, sc, w)
    a, b, c = (12, 9.4), (7.4, 16.6), (16.6, 16.6)
    for p, q in ((a, b), (a, c), (b, c)):
        d.line([T(p), T(q)], fill=PAPER, width=w)
    for n in (a, b, c):
        cx, cy = T(n); r = 1.5*sc
        d.ellipse([cx-r, cy-r, cx+r, cy+r], fill=PAPER)


def d2(d, T, sc, w):   # 实心三角
    box_outline(d, T, sc, w)
    d.polygon([T((12, 8.6)), T((6.8, 17.2)), T((17.2, 17.2))], fill=PAPER)


def d3(d, T, sc, w):   # 无提手 + 实心三角
    box_outline(d, T, sc, w, with_handle=False)
    d.polygon([T((12, 9.0)), T((7.0, 17.0)), T((17.0, 17.0))], fill=PAPER)


def d4(d, T, sc, w):   # 只留提手+实心三角，去掉方框
    d.line([T((8.6, 8.0)), T((8.6, 5.4))], fill=PAPER, width=w)
    d.line([T((15.4, 8.0)), T((15.4, 5.4))], fill=PAPER, width=w)
    d.line([T((8.6, 5.4)), T((15.4, 5.4))], fill=PAPER, width=w)
    d.polygon([T((12, 9.4)), T((5.6, 19.4)), T((18.4, 19.4))], fill=PAPER)


MARKS = [("D1 节点", d1), ("D2 实心三角", d2), ("D3 无提手", d3), ("D4 无框", d4)]


def render(fn, size, w_ratio):
    ss = 6
    img, d = blank(size, ss)
    T, sc = mapper(size*ss)
    fn(d, T, sc, max(1, int(round(size*ss*w_ratio))))
    return img.resize((size, size), Image.LANCZOS)


def main():
    pad = 22
    label_w = 130
    cols = len(SIZES)
    sheet_w = label_w + cols*(70+pad) + pad
    sheet_h = len(MARKS)*(70+pad) + pad
    sheet = Image.new("RGB", (sheet_w, sheet_h), (243, 242, 241))
    d = ImageDraw.Draw(sheet)
    try:
        f = ImageFont.truetype("msyh.ttc", 15)
    except Exception:
        f = ImageFont.load_default()

    for r, (label, fn) in enumerate(MARKS):
        y = pad + r*(70+pad)
        d.text((pad, y+24), label, fill=(40, 40, 40), font=f)
        for c, s in enumerate(SIZES):
            # 小尺寸适当加粗笔画
            wr = 0.030 if s >= 32 else 0.036
            img = render(fn, s, wr)
            x = label_w + c*(70+pad)
            sheet.paste(img, (x, y), img)

    out = os.path.join(tempfile.gettempdir(), "icon-small-variants.png")
    sheet.save(out)
    print(out)


if __name__ == "__main__":
    main()
