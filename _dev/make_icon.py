"""生成应用图标：工具箱（提手 + 方盒）+ 内部三节点关系图。

   设计说明
   - 大尺寸（>=32px）：完整形态——提手、圆角方盒、内部三节点三角图
   - 小尺寸（<32px）：去掉连线、放大圆点，只保留"盒子里三个点"的轮廓
   - 每个尺寸单独绘制（不是缩放大图），小尺寸才不糊

   用法： python make_icon.py
   产出： src/icon.ico, src/icon.png
"""
import io
import os
import struct
import tempfile

from PIL import Image, ImageDraw

PINE = (43, 87, 154, 255)     # Word 蓝 #2b579a（与界面主色一致）
PAPER = (253, 252, 249, 255)  # 纸白


def draw_icon(size, ss=6):
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 底板
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=PINE)

    # 24 单位设计网格 -> 画布
    small = size < 32
    box = S * (0.76 if small else 0.66)
    sc = box / 24.0
    off = (S - box) / 2.0
    T = lambda p: (off + p[0] * sc, off + p[1] * sc)

    stroke = S * (0.046 if small else 0.030)

    # 提手（20px 以下省掉，否则只剩噪声）
    if size >= 20:
        hy = 2.8 if small else 2.9
        d.line([T((9.7, 4.9)), T((9.7, hy))], fill=PAPER, width=int(round(stroke)))
        d.line([T((14.3, 4.9)), T((14.3, hy))], fill=PAPER, width=int(round(stroke)))
        d.line([T((9.7, hy)), T((14.3, hy))], fill=PAPER, width=int(round(stroke)))

    # 箱体
    d.rounded_rectangle(
        [T((3.5, 4.9)), T((20.5, 20.5))],
        radius=int(2.3 * sc),
        outline=PAPER,
        width=int(round(stroke)),
    )

    if small:
        # 小尺寸：三个大圆点，不画连线
        nodes = [((12, 9.6), 2.35), ((7.7, 16.4), 2.35), ((16.3, 16.4), 2.35)]
        for (p, r) in nodes:
            cx, cy = T(p)
            rr = r * sc
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=PAPER)
    else:
        # 大尺寸：三节点 + 三边
        a, b, c = (12, 9.0), (7.2, 16.8), (16.8, 16.8)
        node_r = 1.75
        for p, q in ((a, b), (a, c), (b, c)):
            dx, dy = q[0] - p[0], q[1] - p[1]
            L = (dx * dx + dy * dy) ** 0.5
            ux, uy = dx / L, dy / L
            gap = node_r + 0.5
            d.line([
                T((p[0] + ux * gap, p[1] + uy * gap)),
                T((q[0] - ux * gap, q[1] - uy * gap)),
            ], fill=PAPER, width=int(round(stroke)))
        for n in (a, b, c):
            cx, cy = T(n)
            rr = node_r * sc
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=PAPER)

    return img.resize((size, size), Image.LANCZOS)


def bmp_entry(img):
    """把一帧编码成 ICO 里的 BMP(DIB) 条目：32bpp XOR 位图 + 1bpp AND 掩码。
       shell 只可靠地支持 BMP 条目（PNG 仅对 256 有保证），所以小尺寸必须走这里。"""
    w, h = img.size
    px = img.convert("RGBA").load()

    rows = []
    for y in range(h - 1, -1, -1):          # 位图自下而上
        row = bytearray()
        for x in range(w):
            r, g, b, a = px[x, y]
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    xor = b"".join(rows)

    # AND 掩码：每个像素 1 bit，1 表示透明；每行补齐到 4 字节
    stride = ((w + 31) // 32) * 4
    mask = bytearray(stride * h)
    for y in range(h):
        yy = h - 1 - y
        for x in range(w):
            if px[x, y][3] == 0:
                mask[yy * stride + (x // 8)] |= (0x80 >> (x % 8))

    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0,
                         len(xor) + len(mask), 0, 0, 0, 0)
    return header + xor + bytes(mask)


def write_ico(path, frames):
    """手写 ICO 容器：<=128 用 BMP 条目，256 用 PNG（与系统惯例一致）。"""
    blobs = []
    for img in frames:
        if img.width >= 256:
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            blobs.append(buf.getvalue())
        else:
            blobs.append(bmp_entry(img))

    n = len(frames)
    header = struct.pack("<HHH", 0, 1, n)
    offset = 6 + 16 * n
    entries = b""
    for img, blob in zip(frames, blobs):
        w = img.width if img.width < 256 else 0
        h = img.height if img.height < 256 else 0
        entries += struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)

    with open(path, "wb") as f:
        f.write(header + entries + b"".join(blobs))


def preview(frames):
    """拼一张预览图，方便检查各尺寸。"""
    pad = 20
    w = sum(f.width + pad for f in frames) + pad
    h = max(f.height for f in frames) + pad * 2
    sheet = Image.new("RGB", (w, h), (243, 242, 241))
    x = pad
    for f in frames:
        sheet.paste(f, (x, pad), f)
        x += f.width + pad
    out = os.path.join(tempfile.gettempdir(), "icon-preview.png")
    sheet.save(out)
    return out


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "src")
    os.makedirs(out_dir, exist_ok=True)

    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = [draw_icon(n) for n in sizes]

    ico = os.path.join(out_dir, "icon.ico")
    write_ico(ico, frames)
    frames[-1].save(os.path.join(out_dir, "icon.png"), format="PNG")

    print("wrote", os.path.abspath(ico))
    print("preview", preview(frames))


if __name__ == "__main__":
    main()
