# -*- coding: utf-8 -*-
"""把 Sprite-0001.png 的红色地砖/图案配色替换为赌场绿色配色。

颜色映射（保持原图亮度层次，色相统一为绿色系）：
  亮图案   #f05050 -> #5fae80
  亮地砖   #d05030 -> #47916b
  阴影图案 #a86058 -> #3d7a5c
  阴影地砖 #a04840 -> #2f6048
  更暗红   #985838 -> #26503c
处理前自动备份原图到 tools/backups/（幂等：备份已存在则跳过）。
"""
import os
import shutil

from PIL import Image

SRC = r"tools/Sprite-0001.png"
BACKUP_DIR = r"tools/backups"

MAP = {
    (0xF0, 0x50, 0x50): (0x5F, 0xAE, 0x80),  # 亮图案
    (0xD0, 0x50, 0x30): (0x47, 0x91, 0x6B),  # 亮地砖
    (0xA8, 0x60, 0x58): (0x3D, 0x7A, 0x5C),  # 阴影图案
    (0xA0, 0x48, 0x40): (0x2F, 0x60, 0x48),  # 阴影地砖
    (0x98, 0x58, 0x38): (0x26, 0x50, 0x3C),  # 更暗红
}


def main():
    if not os.path.exists(SRC):
        print("找不到", SRC)
        return

    # 备份原图（幂等）
    os.makedirs(BACKUP_DIR, exist_ok=True)
    bak = os.path.join(BACKUP_DIR, os.path.basename(SRC))
    if not os.path.exists(bak):
        shutil.copy2(SRC, bak)
        print("已备份 ->", bak)
    else:
        print("备份已存在，跳过:", bak)

    img = Image.open(SRC).convert("RGBA")
    px = img.load()
    changed = 0
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if (r, g, b) in MAP:
                px[x, y] = (*MAP[(r, g, b)], a)
                changed += 1
    img.save(SRC)
    print(f"替换完成: 共 {changed} 个像素，已写入 {SRC}")


if __name__ == "__main__":
    main()
