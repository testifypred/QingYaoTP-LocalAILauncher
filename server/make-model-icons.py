"""
模型品牌图标处理：裁掉白边 → 补成正方形 → 缩到 128px 白底 PNG。

为什么保留白底：OpenAI 的 logo 是纯黑结，放到暗色卡片上会看不见；
统一白底方块（前端再加圆角）能让四个图标在任何主题下都清晰、且风格一致。
"""
import os
import sys
from PIL import Image, ImageChops

OUT = r"D:\LocalModels\server\vendor\models"
SRC = {
    "microsoft": r"C:\Users\lenovo\AppData\Roaming\dsh-desktop\harness\attachments\v1\objects\bc\bc16429e02434ddee523bb67b1282327ca5b374b7e88f1ebffb4051df59ee988",
    "qwen": r"C:\Users\lenovo\AppData\Roaming\dsh-desktop\harness\attachments\v1\objects\72\724f8eaf4a0d5c759050a318c8e8a5750e82695ff961a290ab52d03ef6a10817",
    "openai": r"C:\Users\lenovo\AppData\Roaming\dsh-desktop\harness\attachments\v1\objects\dd\dd742803109cf9b79b83d8251991c8c852a59187a225512570c43ef85a0f9b86",
    "deepseek": r"C:\Users\lenovo\AppData\Roaming\dsh-desktop\harness\attachments\v1\objects\a0\a0d0d7f69430ad52044d49b87901f4fac86a833149487dd575acc1a618cec2ae",
}
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
    os.makedirs(OUT, exist_ok=True)
    for k, v in SRC.items():
        if not os.path.exists(v):
            sys.exit(f"缺少源文件：{v}")
        process(k, v)
