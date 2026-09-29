#!/usr/bin/env python3
"""生成 iOS 主屏图标与 favicon。

iOS 图标铁律（本次踩坑后定版）：
1. 必须是全出血正方形、完全不透明 —— iOS 会自己套超椭圆遮罩；
   若把圆角/描边烘进 PNG，两层圆角叠加会在四角露出黑楔、描边被裁。
2. 内容要留安全边距：遮罩在四角裁切，主视觉不能顶边。
3. 不用字体字形（☯ 等在不同渲染器下可能缺字形/变成彩色 emoji），
   太极图直接用几何绘制，结果确定性。
"""
from PIL import Image, ImageDraw, ImageFilter
import math

SS = 4                       # 超采样倍率，抗锯齿
S = 180 * SS                 # 工作画布 720

# 品牌色（与站点一致）
BG_TOP = (27, 22, 38)        # #1B1626
BG_BOT = (14, 12, 21)        # #0E0C15
GOLD = (217, 184, 119)       # #D9B877
CREAM = (244, 224, 176)      # #F4E0B0
DEEP = (10, 9, 16)           # 太极暗半（近黑，与背景拉开反差）
RING = (217, 184, 119)


def vertical_gradient(size, top, bot):
    img = Image.new('RGB', size)
    px = img.load()
    h = size[1]
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(size[0]):
            px[x, y] = c
    return img


def with_radial_glow(img, center, radius, color, strength):
    """叠加一个柔和的径向光晕（金色调），提升图标在深色壁纸上的层次。"""
    glow = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(glow)
    cx, cy = center
    steps = 60
    for i in range(steps, 0, -1):
        f = i / steps
        r = radius * f
        a = int(strength * (1 - f) ** 2)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=a)
    glow = glow.filter(ImageFilter.GaussianBlur(radius * 0.08))
    overlay = Image.new('RGB', img.size, color)
    return Image.composite(overlay, img, glow)


def draw_taijitu(draw, cx, cy, R, light, dark, outline=None, ow=0):
    """几何法画太极图（竖向 S 分割，上半亮、下半暗）。

    构造：大圆亮色 → 下半扇区暗色 → 上/下各一个小圆（R/2）互填 → 两枚点。
    逐层覆盖后即为经典 S 形，无需贝塞尔。
    注意：dark 必须与背景有明显反差，否则暗鱼融进背景、只剩亮部，
    图标会被读成「8」而不是阴阳鱼（第一版踩坑）。"""
    bb = [cx - R, cy - R, cx + R, cy + R]
    draw.ellipse(bb, fill=light)
    draw.pieslice(bb, 0, 180, fill=dark)          # 下半暗
    r2 = R / 2
    # 上方小圆（暗）中心 (cx, cy - R/2)，下方小圆（亮）中心 (cx, cy + R/2)
    draw.ellipse([cx - r2, cy - R / 2 - r2, cx + r2, cy - R / 2 + r2], fill=dark)
    draw.ellipse([cx - r2, cy + R / 2 - r2, cx + r2, cy + R / 2 + r2], fill=light)
    # 两枚点：颜色与其所在区域相反
    dr = R / 6.5
    draw.ellipse([cx - dr, cy - R / 2 - dr, cx + dr, cy - R / 2 + dr], fill=light)
    draw.ellipse([cx - dr, cy + R / 2 - dr, cx + dr, cy + R / 2 + dr], fill=dark)
    if outline:
        draw.ellipse(bb, outline=outline, width=ow)


def make_icon(out_size=180, ring=True):
    img = vertical_gradient((S, S), BG_TOP, BG_BOT)
    cx, cy = S // 2, int(S * 0.50)
    img = with_radial_glow(img, (cx, int(S * 0.34)), int(S * 0.52), GOLD, 46)

    d = ImageDraw.Draw(img)
    R = int(S * 0.27)                    # 太极半径：直径约占 54%，留足遮罩安全边
    if ring:
        rr = int(R * 1.30)               # 外环，完整圆形，不会被遮罩裁到
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], outline=RING, width=int(S * 0.012))
    draw_taijitu(d, cx, cy, R, CREAM, DEEP, outline=GOLD, ow=int(S * 0.010))

    return img.resize((out_size, out_size), Image.LANCZOS)


def save(img, path):
    img.save(path, 'PNG', optimize=True)
    print(f'  {path}  {img.size[0]}x{img.size[1]}')


if __name__ == '__main__':
    import sys, os
    here = os.path.dirname(os.path.abspath(__file__))
    web = os.path.join(here, '..', 'web')
    print('生成图标:')
    save(make_icon(180), os.path.join(web, 'apple-touch-icon.png'))
    save(make_icon(32, ring=False), os.path.join(web, 'favicon-32.png'))
    save(make_icon(192), os.path.join(web, 'icon-192.png'))
    save(make_icon(512), os.path.join(web, 'icon-512.png'))
