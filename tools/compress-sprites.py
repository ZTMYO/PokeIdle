# ===== 贴图压缩：把过大的 gif 缩到游戏尺寸 =====
# 游戏的正常贴图最长边约 45~110 px、每张 100 KB 左右；新素材有时是几百 px 画布 → 一张好几 MB。
# 本工具按"最长边"等比缩放（保留全部帧与时长、透明度），体积通常能降到 1/50 上下。
#
# 用法：
#   python tools/compress-sprites.py                 扫一遍，只报告不写（默认阈值 300KB）
#   python tools/compress-sprites.py --apply         压缩并就地替换（原文件先备份）
#   python tools/compress-sprites.py --max 500       阈值改成 500KB 以上才算大
#   python tools/compress-sprites.py --longest 160   最长边缩到 160px（默认 160）
#   python tools/compress-sprites.py --only 0991-铁包袱.gif,1023-铁头壳.gif
#
# 压缩直接就地替换（不留备份；要回退请用 git）。
import argparse
import io
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAGES = os.path.join(ROOT, 'src', 'pokemon-data', 'images')


def frames_of(path):
    im = Image.open(path)
    n = getattr(im, 'n_frames', 1)
    out, durs = [], []
    for i in range(n):
        im.seek(i)
        out.append(im.convert('RGBA').copy())
        durs.append(im.info.get('duration', 100) or 100)
    return out, durs


# 预乘 alpha 缩放：直接把 RGBA 丢给 LANCZOS，透明像素（RGB 是黑的）会把边缘拉暗，
# 存成 GIF 的 1 位透明后就是一圈深色描边。这里先把 RGB 乘上 alpha 再缩放、最后除回来。
def resize_rgba(frames, size):
    import numpy as np
    out = []
    for f in frames:
        a = np.asarray(f, dtype=np.float32)
        alpha = a[..., 3] / 255.0
        chans = [Image.fromarray((a[..., i] * alpha).astype(np.float32), mode='F').resize(size, Image.LANCZOS)
                 for i in range(3)]
        aA = Image.fromarray((alpha * 255.0).astype(np.float32), mode='F').resize(size, Image.LANCZOS)
        A = np.asarray(aA, dtype=np.float32) / 255.0
        rgb = np.stack([np.clip(np.asarray(c, dtype=np.float32) / np.maximum(A, 1e-3), 0, 255) for c in chans], axis=-1)
        al = np.clip(A * 255.0, 0, 255)
        al = np.where(al < 48, 0, 255)      # GIF 只有 1 位透明：半透明的边直接砍掉，免得出现毛边
        out.append(Image.fromarray(np.concatenate([rgb, al[..., None]], axis=-1).astype(np.uint8)))
    return out

def compress(path, longest, colors):
    frames, durs = frames_of(path)
    w, h = frames[0].size
    scale = min(1.0, longest / max(w, h))
    if scale < 1:
        size = (max(1, round(w * scale)), max(1, round(h * scale)))
        frames = resize_rgba(frames, size)
    if colors and colors < 256:
        # 手动量化：先转成 P 模式（FASTOCTREE 支持 RGBA，会把透明单独留一个索引）
        frames = [f.quantize(colors=colors, method=Image.FASTOCTREE) for f in frames]
    buf = io.BytesIO()
    frames[0].save(buf, format='GIF', save_all=True, append_images=frames[1:],
                   duration=durs, loop=0, disposal=2, optimize=True)
    return buf.getvalue(), frames[0].size, len(frames)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--max', type=int, default=300, help='超过这个 KB 才处理')
    ap.add_argument('--longest', type=int, default=160, help='最长边缩到多少像素')
    ap.add_argument('--colors', type=int, default=256, help='调色板颜色数（越小越省）')
    ap.add_argument('--only', default='', help='只处理这些文件名，逗号分隔')
    args = ap.parse_args()

    only = {s.strip() for s in args.only.split(',') if s.strip()}
    files = []
    for f in sorted(os.listdir(IMAGES)):
        if not f.lower().endswith('.gif'):
            continue
        if only and f not in only:
            continue
        p = os.path.join(IMAGES, f)
        if os.path.getsize(p) > args.max * 1024:
            files.append(p)
    if not files:
        print(f'没有超过 {args.max}KB 的 gif（{IMAGES}）')
        return
    print(f'待处理 {len(files)} 个（阈值 {args.max}KB，最长边 → {args.longest}px）{"，预览模式" if not args.apply else ""}')
    total_before = total_after = 0
    for p in files:
        before = os.path.getsize(p)
        try:
            data, size, n = compress(p, args.longest, args.colors)
        except Exception as e:
            print(f'  ✘ {os.path.basename(p)}：{e}')
            continue
        total_before += before
        total_after += len(data)
        flag = '✔' if len(data) < before else '·'
        print(f'  {flag} {os.path.basename(p)}  {before/1048576:.1f}MB → {len(data)/1024:.0f}KB  '
              f'({size[0]}x{size[1]}, {n} 帧)')
        if args.apply and len(data) < before:
            with open(p, 'wb') as out:
                out.write(data)
    print(f'合计 {total_before/1048576:.1f}MB → {total_after/1048576:.1f}MB'
          f'（省 {(total_before-total_after)/1048576:.1f}MB）')
    if not args.apply:
        print('以上只是预览。确认后加 --apply 真正压缩。')


if __name__ == '__main__':
    main()
