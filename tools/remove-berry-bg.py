# ===== 抠掉树果图片背景色 #73c5a4（转为全透明）=====
# 精准匹配：仅当像素 RGB 完全等于 (115, 197, 164) 时置 alpha=0，不做任何容差。
# 用法：python tools/remove-berry-bg.py <目录>（缺省为 src/items/berry-trees）
import os
import sys
from PIL import Image

TARGET = (115, 197, 164)  # #73c5a4


def remove_bg(path):
    img = Image.open(path)
    original_mode = img.mode
    # 统一转 RGBA 处理：P 模式先展开调色板，保留已有 alpha
    img = img.convert('RGBA')
    px = img.load()
    w, h = img.size
    removed = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if (r, g, b) == TARGET:
                px[x, y] = (r, g, b, 0)
                removed += 1
    # 若原图就是 RGBA，直接保存；否则保存后模式变化也接受（内容不变、背景透明）
    img.save(path, 'PNG')
    print(f'{os.path.basename(path):<22} 原模式 {original_mode:<4} -> 抠除 {removed:>6} 像素')


def main():
    directory = sys.argv[1] if len(sys.argv) > 1 else os.path.join('src', 'items', 'berry-trees')
    files = sorted(f for f in os.listdir(directory) if f.lower().endswith('.png'))
    if not files:
        print('目录下没有 PNG 文件:', directory)
        return
    for f in files:
        remove_bg(os.path.join(directory, f))
    print(f'完成，共处理 {len(files)} 张。')


if __name__ == '__main__':
    main()
