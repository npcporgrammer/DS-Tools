"""生成应用图标：与界面左上角同一个图论标记（三节点 + 三条边）。
   用法： python make_icon.py
   产出： src/icon.ico, src/icon.png
"""
import os
from PIL import Image, ImageDraw

ACCENT = (47, 93, 80, 255)      # 墨绿
WHITE = (253, 252, 249, 255)

# 24x24 设计坐标（与 index.html 里的 SVG 完全一致）
A = (12.0, 5.6)
B = (5.4, 18.0)
C = (18.6, 18.0)
R = 2.7
EDGE_GAP = 3.3


def shorten(p, q, gap):
    dx, dy = q[0] - p[0], q[1] - p[1]
    length = (dx * dx + dy * dy) ** 0.5
    ux, uy = dx / length, dy / length
    return (p[0] + ux * gap, p[1] + uy * gap), (q[0] - ux * gap, q[1] - uy * gap)


def render(size, supersample=4):
    s = size * supersample
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(s * 0.23)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=ACCENT)

    # 标记区：占边长的 64%，居中
    box = s * 0.64
    scale = box / 24.0
    off = (s - box) / 2.0

    def T(pt):
        return (off + pt[0] * scale, off + pt[1] * scale)

    tiny = size <= 24          # 小尺寸：只留三个顶点，去掉连线
    stroke = s * 0.026
    R2 = R * (1.30 if tiny else 1.0)

    def disc(node, filled):
        cx, cy = T(node)
        rr = R2 * scale
        if filled:
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=WHITE)
        else:
            # 实心白盘再挖掉内圈：小尺寸下环才够实、边缘才够硬
            d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=WHITE)
            inner = rr - stroke * 0.92
            d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=ACCENT)

    if not tiny:
        p1, p2 = shorten(A, B, EDGE_GAP)
        d.line([T(p1), T(p2)], fill=WHITE, width=int(round(stroke)))
        p1, p2 = shorten(A, C, EDGE_GAP)
        d.line([T(p1), T(p2)], fill=WHITE, width=int(round(stroke)))
        d.line([T((B[0] + R + 0.1, B[1])), T((C[0] - R - 0.1, C[1]))],
               fill=WHITE, width=int(round(stroke)))

    disc(A, True)
    disc(B, tiny)     # 小尺寸全部实心，否则 1px 的环会糊成一团
    disc(C, tiny)

    return img.resize((size, size), Image.LANCZOS)


def write_ico(path, frames):
    """手写 ICO 容器：每个尺寸用各自渲染的 PNG，而不是把 256 缩小。"""
    import struct, io

    blobs = []
    for img in frames:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        blobs.append(buf.getvalue())

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


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "src")
    os.makedirs(out_dir, exist_ok=True)

    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [render(n) for n in sizes]

    ico = os.path.join(out_dir, "icon.ico")
    write_ico(ico, frames)
    frames[-1].save(os.path.join(out_dir, "icon.png"), format="PNG")

    # 便于检查小尺寸：放大后另存
    import tempfile
    for s, img in ((16, frames[0]), (32, frames[2])):
        img.resize((s * 10, s * 10), Image.NEAREST).save(
            os.path.join(tempfile.gettempdir(), "ic%d-x10.png" % s)
        )

    print("wrote", os.path.abspath(ico))


if __name__ == "__main__":
    main()
