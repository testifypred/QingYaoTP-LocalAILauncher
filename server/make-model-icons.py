"""
模型品牌图标处理：裁掉白边 → 补成正方形 → 缩到 128px 白底 PNG。

为什么保留白底：OpenAI 的 logo 是纯黑结，放到暗色卡片上会看不见；
统一白底方块（前端再加圆角）能让四个图标在任何主题下都清晰、且风格一致。
"""
import os
import sys
from PIL import Image, ImageChops

# 输出固定到本脚本同级的 vendor\models（仓库内相对路径，换台机器照样能跑）
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor", "models")

# 源图由命令行传入：name=path（各人本地的图片路径不同，不写死、不入库）
#   python make-model-icons.py microsoft=<png> qwen=<png> openai=<png> deepseek=<png>
SRC = {}
for _arg in sys.argv[1:]:
    _name, _sep, _path = _arg.partition("=")
    if _sep:
        SRC[_name.strip()] = _path.strip()
SIZE = 128
PAD = 0.10  # 四周留白比例


def white_to_bbox(im):
    """找出非白内容的包围盒（容差 12，避免压缩噪点被当成内容）"""
    rgb = im.convert("RGB")
    white = Image.new("RGB", rgb.size, (255, 255, 255))
    diff = ImageChops.difference(rgb, white).convert("L")
    mask = diff.point(lambda v: 255 if v > 12 else 0)
    return mask.getbbox()


def process(name, path):
    im = Image.open(path).convert("RGBA")
    bbox = white_to_bbox(im)
    if not bbox:
        raise SystemExit(f"{name}: 整张图都是白的？")
    im = im.crop(bbox)

    # 补成正方形，内容居中
    w, h = im.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    canvas.paste(im, ((side - w) // 2, (side - h) // 2), im)

    # 再按比例留白，最后缩到 128
    inner = int(SIZE * (1 - PAD * 2))
    canvas = canvas.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255))
    off = (SIZE - inner) // 2
    out.paste(canvas, (off, off), canvas)

    dst = os.path.join(OUT, f"{name}.png")
    out.save(dst, "PNG", optimize=True)
    print(f"{name:10s} 原图 {Image.open(path).size} → 内容 {w}x{h} → {dst} ({os.path.getsize(dst)} B)")


if __name__ == "__main__":
    if not SRC:
        sys.exit("用法: python make-model-icons.py microsoft=<png> qwen=<png> openai=<png> deepseek=<png>")
    os.makedirs(OUT, exist_ok=True)
    for k, v in SRC.items():
        if not os.path.exists(v):
            sys.exit(f"缺少源文件：{k} -> {v}")
        process(k, v)
