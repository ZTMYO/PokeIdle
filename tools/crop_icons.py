# -*- coding: utf-8 -*-
"""裁剪宝可梦图标边缘空白，让小图标放大显示时更清晰。
做法：按 alpha 阈值取内容包围盒 → 裁剪 → 四周补 2px 透明边距 → 原位覆盖保存。"""
import os
from PIL import Image

ICON_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'pokemon-data', 'icon')
PAD = 2          # 裁剪后保留的透明边距
THRESHOLD = 16   # alpha 大于该值才算内容（滤掉边缘半透明杂点）
MAX_LEN = 56     # 若单边超过原始尺寸则跳过（异常保护）

changed = skipped = failed = 0

for name in sorted(os.listdir(ICON_DIR)):
    if not name.lower().endswith('.png'):
        continue
    path = os.path.join(ICON_DIR, name)
    try:
        im = Image.open(path).convert('RGBA')
        w, h = im.size
        alpha = im.getchannel('A')
        bbox = alpha.point(lambda a: 255 if a > THRESHOLD else 0).getbbox()
        if not bbox:
            skipped += 1
            continue
        l, t, r, b = bbox
        # 加上边距，但不超过原始尺寸
        l = max(l - PAD, 0)
        t = max(t - PAD, 0)
        r = min(r + PAD, w)
        b = min(b + PAD, h)
        # 内容已充满原图（无空白可裁）则跳过
        if (l, t, r, b) == (0, 0, w, h):
            skipped += 1
            continue
        if max(w, h) > MAX_LEN * 2:
            skipped += 1
            continue
        im.crop((l, t, r, b)).save(path, 'PNG')
        changed += 1
    except Exception as e:
        failed += 1
        print(f'[FAIL] {name}: {e}')

print(f'done: changed={changed} skipped={skipped} failed={failed}')
