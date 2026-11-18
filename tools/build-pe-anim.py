#!/usr/bin/env python3
"""Build move-fx-pe-data.js + sprite PNGs from a pokeemerald source tree.

Reads battle_anim_scripts.s, battle anim C sources, graphics.c and the
graphics/battle_anims/sprites folder, then emits original Emerald move
animation data for tools/move-fx-preview.html.

Usage: python tools/build-pe-anim.py [path-to-pokeemerald] [--no-assets]
"""
import json
import os
import re
import shutil
import struct
import sys
import glob
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = None
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
if ARGS:
    SRC = ARGS[0]
else:
    for cand in [
        os.path.join(os.path.dirname(ROOT), '游戏开发素材包', 'pokeemerald_512k-master'),
        r'D:\zc\游戏开发素材包\pokeemerald_512k-master',
    ]:
        if os.path.isdir(cand):
            SRC = cand
            break
if not SRC or not os.path.isdir(SRC):
    sys.exit('pokeemerald source not found; pass it as the first argument')

SPRITE_DIR = os.path.join(SRC, 'graphics', 'battle_anims', 'sprites')
OUT_DIR = os.path.join(ROOT, 'tools', 'move-fx-assets', 'pe')
DATA_FILE = os.path.join(ROOT, 'tools', 'move-fx-pe-data.js')
REPORT_FILE = os.path.join(ROOT, 'tools', 'move-fx-pe-report.txt')
NO_ASSETS = '--no-assets' in sys.argv

report = []


def note(msg):
    report.append(msg)


def read(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        return f.read()


def strip_comments(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    text = re.sub(r'//[^\n]*', '', text)
    return text


def find_matching(text, start, open_ch='{', close_ch='}'):
    depth = 0
    i = start
    while i < len(text):
        c = text[i]
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1


def split_args(s):
    """Split a macro argument string on top-level commas."""
    out = []
    depth = 0
    cur = ''
    for c in s:
        if c in '([':
            depth += 1
        elif c in ')]':
            depth -= 1
        if c == ',' and depth == 0:
            out.append(cur.strip())
            cur = ''
        else:
            cur += c
    if cur.strip() or out:
        out.append(cur.strip())
    return out


# ---------------------------------------------------------------- constants
C_CONST = {
    'TRUE': 1, 'FALSE': 0,
    'MAX_BATTLERS_COUNT': 4,
    'ANIM_ATTACKER': 0, 'ANIM_TARGET': 1, 'ANIM_ATK_PARTNER': 2, 'ANIM_DEF_PARTNER': 3,
    'ANIM_SPRITES_START': 10000,
    'F_PAL_BG': 1, 'F_PAL_ATTACKER': 2, 'F_PAL_TARGET': 4, 'F_PAL_ATK_PARTNER': 8,
    'F_PAL_DEF_PARTNER': 16, 'F_PAL_ANIM_1': 32, 'F_PAL_ANIM_2': 64,
    'F_PAL_ATK_SIDE': 2 | 8, 'F_PAL_DEF_SIDE': 4 | 16, 'F_PAL_BATTLERS': 2 | 8 | 4 | 16,
    'F_PAL_BATTLERS_2': (1 << 7) | (1 << 8) | (1 << 9) | (1 << 10),
    'ARG_RET_ID': 7,
    'RGB_BLACK': 0, 'RGB_WHITE': 32767, 'RGB_RED': 31, 'RGB_GREEN': 31 << 5,
    'RGB_BLUE': 31 << 10, 'RGB_YELLOW': 31 | (31 << 5), 'RGB_MAGENTA': 31 | (31 << 10),
    'RGB_CYAN': (31 << 5) | (31 << 10),
    'B_SIDE_PLAYER': 0, 'B_SIDE_OPPONENT': 1,
}


def load_tag_constants():
    text = read(os.path.join(SRC, 'include', 'constants', 'battle_anim.h'))
    for m in re.finditer(r'#define\s+(ANIM_TAG_\w+)\s+\(ANIM_SPRITES_START\s*\+\s*(\d+)\)', text):
        C_CONST[m.group(1)] = 10000 + int(m.group(2))
    for m in re.finditer(r'#define\s+(BG_\w+)\s+(\d+)', text):
        C_CONST[m.group(1)] = int(m.group(2))
    for m in re.finditer(r'#define\s+(F_PAL_\w+)\s+(.+)$', text, re.M):
        expr = m.group(2).strip()
        if re.fullmatch(r'[0-9xXa-fA-F\s()<>|+\-*]+', expr):
            try:
                C_CONST[m.group(1)] = int(eval(expr))
            except Exception:
                pass


load_tag_constants()


def eval_c(expr):
    """Evaluate the small C subset used in battle anim scripts."""
    expr = expr.strip()
    if not expr:
        return 0
    expr = re.sub(r'RGB\s*\(([^)]*)\)', lambda m: str(
        (int(eval_c(split_args(m.group(1))[0])) & 31)
        | ((int(eval_c(split_args(m.group(1))[1])) & 31) << 5)
        | ((int(eval_c(split_args(m.group(1))[2])) & 31) << 10)), expr)
    # identifiers -> constants; unknown identifiers become 0
    def ident(m):
        name = m.group(0)
        if name in C_CONST:
            return str(C_CONST[name])
        return '0'
    expr = re.sub(r'\b[A-Za-z_]\w*\b', ident, expr)
    expr = expr.replace('&&', ' and ').replace('||', ' or ').replace('!', ' not ')
    if not re.fullmatch(r'[\d\s()+\-*/%<>&|^~,a-z]+', expr):
        return 0
    try:
        return int(eval(expr, {'__builtins__': {}}, {}))
    except Exception:
        return 0


# ---------------------------------------------------------- graphics tables
def parse_graphics():
    """gfx/pal symbol -> png file (from src/graphics.c)."""
    text = read(os.path.join(SRC, 'src', 'graphics.c'))
    gfx = {}
    pal = {}
    for m in re.finditer(r'gBattleAnimSprite(Gfx|Pal)_(\w+)\[\]\s*=\s*INCBIN_U32\("([^"]+)"\)', text):
        kind, name, path = m.groups()
        file = os.path.basename(path)
        if path.startswith('graphics/battle_anims/unused/'):
            continue
        base = re.sub(r'\.(4bpp\.lz|gbapal\.lz)$', '', file)
        if kind == 'Gfx':
            gfx['gBattleAnimSpriteGfx_' + name] = base + '.png'
        else:
            if base.endswith('.pal') or base.endswith('.bin'):
                pal['gBattleAnimSpritePal_' + name] = base
            else:
                pal['gBattleAnimSpritePal_' + name] = base + '.png'
    return gfx, pal


# -------------------------------------------------------------- pic tables
def parse_tables():
    text = read(os.path.join(SRC, 'src', 'data', 'battle_anim.h'))
    start = text.find('gBattleAnimPicTable[]')
    end = text.find('};', start)
    pics = {}
    for m in re.finditer(r'\{\s*(gBattleAnimSpriteGfx_\w+)\s*,\s*(0x[0-9a-fA-F]+|\d+)\s*,\s*(ANIM_TAG_\w+)\s*\}', text[start:end]):
        tag = C_CONST.get(m.group(3))
        if tag is not None:
            pics[tag] = {'gfx': m.group(1), 'size': int(m.group(2), 0)}
    start = text.find('gBattleAnimPaletteTable[]')
    end = text.find('};', start)
    pals = {}
    for m in re.finditer(r'\{\s*(gBattleAnimSpritePal_\w+)\s*,\s*(ANIM_TAG_\w+)\s*\}', text[start:end]):
        tag = C_CONST.get(m.group(2))
        if tag is not None:
            pals[tag] = m.group(1)
    return pics, pals


# ------------------------------------------------------------------- palettes
def parse_jasc_pal(path):
    colors = []
    try:
        lines = read(path).splitlines()
    except Exception:
        return None
    if not lines or 'JASC-PAL' not in lines[0]:
        return None
    start = 3
    for line in lines[start:]:
        parts = line.split()
        if len(parts) < 3:
            continue
        try:
            colors.append((int(parts[0]), int(parts[1]), int(parts[2])))
        except ValueError:
            pass
    return colors or None


# ----------------------------------------------------------- script parsing
CMD_SPECS = {
    'loadspritegfx': ('l', 1),
    'unloadspritegfx': ('u', 1),
    'createsprite': ('s', -1),
    'createvisualtask': ('t', -1),
    'createsoundtask': ('S', -1),
    'delay': ('d', 1),
    'waitforvisualfinish': ('w', 0),
    'nop': (None, 0),
    'nop2': (None, 0),
    'end': ('e', 0),
    'playse': ('S', 1),
    'monbg': ('m', 1),
    'clearmonbg': ('M', 1),
    'setalpha': ('a', 2),
    'blendoff': ('b', 0),
    'call': ('c', 1),
    'return': ('r', 0),
    'setarg': ('A', 2),
    'choosetwoturnanim': ('q', 2),
    'jumpifmoveturn': ('J', 2),
    'goto': ('g', 1),
    'fadetobg': ('f', 1),
    'restorebg': ('R', 0),
    'waitbgfadeout': ('o', 0),
    'waitbgfadein': ('F', 0),
    'changebg': ('f', 1),
    'playsewithpan': ('S', 2),
    'setpan': (None, 1),
    'panse': ('S', 5),
    'panse_adjustnone': ('S', 5),
    'panse_adjustall': ('S', 5),
    'loopsewithpan': ('S', 4),
    'waitplaysewithpan': ('S', 3),
    'setbldcnt': (None, 1),
    'waitsound': (None, 0),
    'jumpargeq': ('j', 3),
    'jumpreteq': ('j', 2),
    'jumprettrue': ('j', 1),
    'jumpretfalse': ('j', 1),
    'monbg_static': ('m', 1),
    'clearmonbg_static': ('M', 1),
    'jumpifcontest': ('K', 1),
    'fadetobgfromset': ('f', 1),
    'splitbgprio': ('p', 1),
    'splitbgprio_all': ('p', 0),
    'splitbgprio_foes': ('p', 1),
    'invisible': ('i', 1),
    'visible': ('v', 1),
    'teamattack_moveback': (None, 1),
    'teamattack_movefoward': (None, 1),
    'stopsound': (None, 0),
}

JUMP_CMDS = {'call', 'goto', 'choosetwoturnanim', 'jumpargeq', 'jumpreteq',
             'jumpifmoveturn', 'jumpifcontest', 'jumprettrue', 'jumpretfalse'}


def parse_script_arg(cmd, idx, raw):
    raw = raw.strip()
    if cmd in ('createsprite',):
        if idx == 0:
            return raw
        if idx == 1:
            return 'TARGET' if raw == 'ANIM_TARGET' else 'ATTACKER'
        return eval_c(raw)
    if cmd == 'createvisualtask':
        if idx == 0:
            return raw
        if idx == 1:
            return eval_c(raw)
        return eval_c(raw)
    if cmd in ('call', 'goto'):
        return raw
    if cmd == 'choosetwoturnanim':
        return raw
    if cmd == 'jumpreteq':
        if idx == 0:
            return eval_c(raw)
        return raw
    if cmd == 'jumpargeq':
        if idx == 2:
            return raw
        return eval_c(raw)
    if cmd in ('jumprettrue', 'jumpretfalse', 'jumpifcontest', 'jumpifmoveturn'):
        if (cmd in ('jumprettrue', 'jumpretfalse') and idx == 0) or (cmd == 'jumpifcontest' and idx == 0) or (cmd == 'jumpifmoveturn' and idx == 1):
            return raw
        return eval_c(raw)
    return eval_c(raw)


def parse_scripts():
    path = os.path.join(SRC, 'data', 'battle_anim_scripts.s')
    text = read(path)
    labels = {}
    script = []
    unknown = set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('@') or line.startswith('.') or line.startswith('#'):
            continue
        lm = re.match(r'^([A-Za-z_]\w*)\s*:\s*(?:@.*)?$', line)
        if lm:
            labels.setdefault(lm.group(1), len(script))
            continue
        m = re.match(r'([a-z_][\w]*)\b(.*)$', line)
        if not m:
            continue
        cmd, rest = m.group(1), m.group(2).strip()
        if cmd not in CMD_SPECS:
            unknown.add(cmd)
            continue
        op, _ = CMD_SPECS[cmd]
        if op is None:
            continue
        args = split_args(rest) if rest else []
        out = []
        for idx, a in enumerate(args):
            a = a.split('@')[0].strip()
            out.append(parse_script_arg(cmd, idx, a))
        if op == 'j' and cmd in ('jumprettrue', 'jumpretfalse'):
            out = ['RET', 1 if cmd == 'jumprettrue' else 0] + out
        elif op == 'j' and cmd == 'jumpreteq':
            out = ['RET'] + out
        script.append([op] + out)
    if unknown:
        note('Unknown script commands: ' + ' '.join(sorted(unknown)))
    return script, labels


# ------------------------------------------------------------ anim tables
def parse_anim_tables(all_text):
    arrays = {}
    for m in re.finditer(r'(?:static\s+)?(?:const\s+)?union\s+(AnimCmd|AffineAnimCmd)\s+(\w+)\[\]\s*=\s*\{', all_text):
        kind, name = m.groups()
        start = m.end() - 1
        end = find_matching(all_text, start)
        if end < 0:
            continue
        arrays[name] = (kind, all_text[start + 1:end])
    return arrays


def resolve_anim_ref(arrays, name, depth=0):
    if depth > 6:
        return None
    if name in arrays:
        return arrays[name]
    return None


def parse_anims(arrays, template_body, frame_tiles):
    anims = []
    ref = re.search(r'\.anims\s*=\s*(\w+)', template_body)
    if not ref or ref.group(1) in ('gDummySpriteAnimTable', 'NULL'):
        return [[]]
    table = arrays.get(ref.group(1))
    if table is None:
        # table may be declared with const union AnimCmd *const
        m = re.search(r'(?:static\s+)?const\s+union\s+AnimCmd\s+\*\s*const\s+' + re.escape(ref.group(1)) + r'\[\]\s*=\s*\{([^}]*)\}', all_text_global)
        refs = []
        if m:
            refs = [x.strip() for x in split_args(m.group(1)) if x.strip()]
        if not refs:
            note('Missing anim table ' + ref.group(1))
            return [[]]
    else:
        refs = [x.strip() for x in split_args(table[1]) if x.strip()]
    for rname in refs:
        arr = arrays.get(rname)
        if arr is None:
            anims.append([])
            continue
        cmds = []
        body = arr[1]
        for m in re.finditer(r'(ANIMCMD_\w+)\s*(?:\(([^)]*)\))?', body):
            kind = m.group(1)
            args = split_args(m.group(2) or '')
            if kind == 'ANIMCMD_FRAME':
                frame = eval_c(args[0]) // max(1, frame_tiles)
                dur = eval_c(args[1]) if len(args) > 1 else 1
                cmds.append(['f', frame, max(1, dur)])
            elif kind == 'ANIMCMD_END':
                cmds.append(['e'])
            elif kind == 'ANIMCMD_JUMP':
                cmds.append(['j', eval_c(args[0]) if args else 0])
            elif kind == 'ANIMCMD_LOOP':
                cmds.append(['p', eval_c(args[0]) if args else 0])
        anims.append(cmds)
    return anims


def parse_affines(arrays, template_body):
    ref = re.search(r'\.affineAnims\s*=\s*(\w+)', template_body)
    if not ref or ref.group(1) in ('gDummySpriteAffineAnimTable', 'NULL'):
        return [[]]
    table = arrays.get(ref.group(1))
    if table is None:
        m = re.search(r'(?:static\s+)?const\s+union\s+AffineAnimCmd\s+\*\s*const\s+' + re.escape(ref.group(1)) + r'\[\]\s*=\s*\{([^}]*)\}', all_text_global)
        refs = [x.strip() for x in split_args(m.group(1))] if m else []
    else:
        refs = [x.strip() for x in split_args(table[1]) if x.strip()]
    out = []
    for rname in refs:
        arr = arrays.get(rname)
        if arr is None:
            out.append([])
            continue
        cmds = []
        for m in re.finditer(r'(AFFINEANIMCMD_\w+)\s*(?:\(([^)]*)\))?', arr[1]):
            kind = m.group(1)
            args = split_args(m.group(2) or '')
            if kind == 'AFFINEANIMCMD_FRAME':
                vals = [eval_c(x) for x in args]
                while len(vals) < 4:
                    vals.append(0)
                cmds.append(['f', vals[0], vals[1], vals[2], vals[3]])
            elif kind == 'AFFINEANIMCMD_END':
                cmds.append(['e'])
            elif kind == 'AFFINEANIMCMD_JUMP':
                cmds.append(['j', eval_c(args[0]) if args else 0])
            elif kind == 'AFFINEANIMCMD_LOOP':
                cmds.append(['p', eval_c(args[0]) if args else 0])
        out.append(cmds)
    return out


# ------------------------------------------------------------------- assets
def build_assets(pics, gfx_map, pal_map, templates):
    os.makedirs(OUT_DIR, exist_ok=True)
    pal_cache = {}
    made = {}

    def pal_colors(pal_symbol):
        if pal_symbol in pal_cache:
            return pal_cache[pal_symbol]
        fname = pal_map.get(pal_symbol)
        colors = None
        if fname and fname.lower().endswith('.pal'):
            colors = parse_jasc_pal(os.path.join(SPRITE_DIR, fname))
        pal_cache[pal_symbol] = colors
        return colors

    def source_images(gfx_symbol):
        """Return split source PNG paths for a gfx symbol."""
        fname = gfx_map.get(gfx_symbol)
        if not fname:
            return []
        stem = fname[:-4] if fname.lower().endswith('.png') else fname
        single = os.path.join(SPRITE_DIR, stem + '.png')
        if os.path.exists(single):
            return [single]
        parts = []
        n = 0
        while True:
            p = os.path.join(SPRITE_DIR, f'{stem}_{n}.png')
            if not os.path.exists(p):
                break
            parts.append(p)
            n += 1
        return parts

    def extract_tiles(path, colors):
        im = Image.open(path)
        if im.mode != 'P':
            im = im.convert('P', palette=Image.ADAPTIVE)
        src_pal = im.getpalette() or []
        px = im.load()
        tiles = []
        for ty in range(0, im.height - 7, 8):
            for tx in range(0, im.width - 7, 8):
                tile = Image.new('RGBA', (8, 8), (0, 0, 0, 0))
                dst = tile.load()
                for y in range(8):
                    for x in range(8):
                        i = px[tx + x, ty + y]
                        if i == 0:
                            continue
                        if colors and i < len(colors):
                            r, g, b = colors[i]
                        elif i * 3 + 2 < len(src_pal):
                            r, g, b = src_pal[i * 3], src_pal[i * 3 + 1], src_pal[i * 3 + 2]
                        else:
                            r, g, b = (255, 0, 255)
                        dst[x, y] = (r, g, b, 255)
                tiles.append(tile)
        return tiles

    def ensure_sheet(gfx_symbol, pal_symbol, fw, fh):
        """Return {img,w,h,frames} for a vertical frame strip."""
        if not fw or not fh:
            return None
        key = f'{gfx_symbol}__{pal_symbol or "own"}__{fw}x{fh}'
        if key in made:
            return made[key]
        paths = source_images(gfx_symbol)
        if not paths:
            return None
        colors = pal_colors(pal_symbol) if pal_symbol else None
        tiles = []
        for p in paths:
            tiles.extend(extract_tiles(p, colors))
        tpf = (fw // 8) * (fh // 8)
        if tpf <= 0:
            return None
        frames = len(tiles) // tpf
        if frames <= 0:
            note(f'{gfx_symbol}: {len(tiles)} tiles < one {fw}x{fh} frame')
            return None
        sheet = Image.new('RGBA', (fw, fh * frames), (0, 0, 0, 0))
        cols = fw // 8
        for f in range(frames):
            base = f * tpf
            for t in range(tpf):
                tile = tiles[base + t]
                sx = (t % cols) * 8
                sy = (t // cols) * 8
                sheet.paste(tile, (sx, f * fh + sy))
        short = re.sub(r'^gBattleAnimSprite', '', gfx_symbol)
        if pal_symbol:
            short += '__' + re.sub(r'^gBattleAnimSprite', '', pal_symbol)
        short += f'__{fw}x{fh}'
        out_name = re.sub(r'[^A-Za-z0-9_.-]', '_', short) + '.png'
        sheet.save(os.path.join(OUT_DIR, out_name))
        made[key] = {'img': 'pe/' + out_name, 'w': fw, 'h': fh * frames, 'frames': frames}
        return made[key]

    out_templates = {}
    for name, body in templates.items():
        tm = re.search(r'\.tileTag\s*=\s*(\w+)', body)
        pm = re.search(r'\.paletteTag\s*=\s*(\w+)', body)
        om = re.search(r'\.oam\s*=\s*&\s*gOamData_(AffineOff|AffineNormal|AffineDouble)_(ObjNormal|ObjBlend)_(\d+)x(\d+)', body)
        cm = re.search(r'\.callback\s*=\s*(\w+)', body)
        tileTag = tm.group(1) if tm else '0'
        palTag = pm.group(1) if pm else '0'
        fw, fh = (int(om.group(3)), int(om.group(4))) if om else (0, 0)
        am = {'AffineOff': 0, 'AffineNormal': 1, 'AffineDouble': 2}.get(om.group(1), 0) if om else 0
        ob = 1 if (om and om.group(2) == 'ObjBlend') else 0
        cb = cm.group(1) if cm else 'SpriteCallbackDummy'
        tile_expr = eval_c(tileTag) if tileTag != '0' else 0
        pic = pics.get(tile_expr) if isinstance(tile_expr, int) else None
        gfx_symbol = pic['gfx'] if pic else (tileTag if tileTag.startswith('gBattleAnimSpriteGfx_') else None)
        pal_expr = eval_c(palTag) if palTag != '0' else 0
        pal_symbol = pal_map.get(pal_expr) if isinstance(pal_expr, int) else (palTag if palTag.startswith('gBattleAnimSpritePal_') else None)
        if pal_symbol is None:
            pal_symbol = pal_map.get(tile_expr)
        img = ensure_sheet(gfx_symbol, pal_symbol, fw, fh) if gfx_symbol else None
        frame_tiles = (fw // 8) * (fh // 8) if fw and fh else 1
        anims = parse_anims(anim_tables, body, frame_tiles)
        affines = parse_affines(anim_tables, body)
        out_templates[name] = {
            'cb': cb,
            'img': img['img'] if img else None,
            'fw': fw, 'fh': fh, 'cols': 1, 'frames': img['frames'] if img else 1,
            'am': am, 'ob': ob,
            'an': anims,
            'af': affines,
        }
        if not img:
            note(f'{name}: no image (cb {cb})')
    return out_templates



# ------------------------------------------------------------ backgrounds
def build_backgrounds():
    """Reconstruct 1:1 battle animation backgrounds from tiles + tilemaps."""
    bg_dir = os.path.join(SRC, 'graphics', 'battle_anims', 'backgrounds')
    out_dir = os.path.join(ROOT, 'tools', 'move-fx-assets', 'bg')
    os.makedirs(out_dir, exist_ok=True)
    gtext = read(os.path.join(SRC, 'src', 'graphics.c'))
    images = {}
    pals = {}
    maps = {}
    for m in re.finditer(r'gBattleAnimBg(Image|Palette|Tilemap)_(\w+)\[\]\s*=\s*INCBIN_U32\("([^"]+)"\)', gtext):
        kind, name, path = m.groups()
        base = os.path.basename(path)
        base = re.sub(r'\.(4bpp|gbapal|bin)\.lz$', '', base)
        if kind == 'Image':
            images[name] = base + '.png'
        elif kind == 'Palette':
            pals[name] = base
        else:
            maps[name] = base + '.bin'
    data_text = read(os.path.join(SRC, 'src', 'data', 'battle_anim.h'))
    m = re.search(r'gBattleAnimBackgroundTable\[\]\s*=\s*\{(.*?)\n\};', data_text, re.S)
    if not m:
        note('background table not found')
        return {}
    table = {}
    for e in re.finditer(r'\[(BG_\w+)\]\s*=\s*\{\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\}', m.group(1)):
        code = C_CONST.get(e.group(1))
        if code is not None:
            table[code] = (e.group(2), e.group(3), e.group(4))

    def load_palette(pal_symbol, image_path):
        fname = pals.get(pal_symbol.replace('gBattleAnimBgPalette_', ''), '')
        if fname:
            p = os.path.join(bg_dir, fname + '.pal')
            if os.path.exists(p):
                c = parse_jasc_pal(p)
                if c:
                    return c
        im = Image.open(image_path)
        pal = im.getpalette() or []
        return [(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]) for i in range(len(pal) // 3)]

    def tile_rgba(im, colors, tile_index, hflip, vflip, bank):
        cols = im.width // 8
        tx = (tile_index % cols) * 8
        ty = (tile_index // cols) * 8
        if ty >= im.height:
            return Image.new('RGBA', (8, 8), (0, 0, 0, 255))
        px = im.load()
        tile = Image.new('RGBA', (8, 8), (0, 0, 0, 255))
        dst = tile.load()
        for y in range(8):
            for x in range(8):
                i = px[tx + x, ty + y]
                pos = bank * 16 + i
                if pos < len(colors):
                    r, g, b = colors[pos]
                elif i < len(colors):
                    r, g, b = colors[i]
                else:
                    r, g, b = (0, 0, 0)
                dst[x, y] = (r, g, b, 255)
        if hflip:
            tile = tile.transpose(Image.FLIP_LEFT_RIGHT)
        if vflip:
            tile = tile.transpose(Image.FLIP_TOP_BOTTOM)
        return tile

    name_by_code = {v: k[3:].lower() for k, v in C_CONST.items() if k.startswith('BG_')}
    out = {}
    for code, (img_sym, pal_sym, map_sym) in sorted(table.items()):
        if code == 15:  # 冰系背景（冰冻之风/绝对零度/冰球）与战斗界面不搭，不再生成
            continue
        img_name = images.get(img_sym.replace('gBattleAnimBgImage_', ''))
        map_name = maps.get(map_sym.replace('gBattleAnimBgTilemap_', ''))
        if not img_name or not map_name:
            note(f'bg {code}: missing image/tilemap')
            continue
        img_path = os.path.join(bg_dir, img_name)
        map_path = os.path.join(bg_dir, map_name)
        if not os.path.exists(img_path) or not os.path.exists(map_path):
            note(f'bg {code}: missing file {img_name}/{map_name}')
            continue
        im = Image.open(img_path)
        if im.mode != 'P':
            im = im.convert('P', palette=Image.ADAPTIVE)
        colors = load_palette(pal_sym, img_path)
        raw = open(map_path, 'rb').read()
        entries = list(struct.unpack('<' + 'H' * (len(raw) // 2), raw))
        n = len(entries)
        if n >= 2048 and n % 64 == 0:
            w, h = 64, n // 64
        else:
            w, h = 32, max(1, n // 32)
        canvas = Image.new('RGBA', (w * 8, h * 8), (0, 0, 0, 255))
        for i in range(min(n, w * h)):
            e = entries[i]
            tile = tile_rgba(im, colors, e & 0x3FF, bool(e & 0x400), bool(e & 0x800), (e >> 12) & 0xF)
            canvas.paste(tile, ((i % w) * 8, (i // w) * 8))
        if code == 1:
            # Dark 背景：裁掉底部整片绿地，只保留品红云层
            px = canvas.load()
            cut = canvas.height
            for y in range(canvas.height):
                if all(px[x, y][:3] == (0, 139, 0) for x in range(canvas.width)):
                    cut = y
                    break
            if cut < canvas.height:
                canvas = canvas.crop((0, 0, canvas.width, cut))
        name = f'bg_{name_by_code.get(code, str(code))}.png'
        canvas.save(os.path.join(out_dir, name))
        out[code] = 'bg/' + name
    note(f'backgrounds: {len(out)} reconstructed')
    return out


# ---------------------------------------------------------------- main flow
gfx_map, pal_map = parse_graphics()
pics, tag_pals = parse_tables()
texts = []
for f in sorted(glob.glob(os.path.join(SRC, 'src', 'battle_anim*.c'))):
    texts.append(read(f))
all_text_global = '\n'.join(texts)
anim_tables = parse_anim_tables(all_text_global)

templates = {}
for m in re.finditer(r'struct\s+SpriteTemplate\s+(\w+)\s*=\s*\{', all_text_global):
    name = m.group(1)
    start = m.end() - 1
    end = find_matching(all_text_global, start)
    if end > 0:
        templates[name] = all_text_global[start:end + 1]

def build_special_assets(out_templates):
    """Composite sprites that the game builds from subsprite tables."""
    # Frozen ice cube: 64x64 + 64x32 + 32x64 + 32x32 pieces, 96x96 total.
    pieces = [
        ('ice_cube_0.png', 0, 0),
        ('ice_cube_1.png', 0, 64),
        ('ice_cube_2.png', 64, 0),
        ('ice_cube_3.png', 64, 64),
    ]
    colors = parse_jasc_pal(os.path.join(SPRITE_DIR, 'ice_cube.pal'))
    sheet = Image.new('RGBA', (96, 96), (0, 0, 0, 0))
    ok = True
    for fname, ox, oy in pieces:
        path = os.path.join(SPRITE_DIR, fname)
        if not os.path.exists(path):
            ok = False
            break
        im = Image.open(path)
        if im.mode != 'P':
            im = im.convert('P', palette=Image.ADAPTIVE)
        src_pal = im.getpalette() or []
        px = im.load()
        part = Image.new('RGBA', im.size, (0, 0, 0, 0))
        dst = part.load()
        for y in range(im.height):
            for x in range(im.width):
                i = px[x, y]
                if i == 0:
                    continue
                if colors and i < len(colors):
                    r, g, b = colors[i]
                elif i * 3 + 2 < len(src_pal):
                    r, g, b = src_pal[i * 3], src_pal[i * 3 + 1], src_pal[i * 3 + 2]
                else:
                    continue
                dst[x, y] = (r, g, b, 255)
        sheet.paste(part, (ox, oy), part)
    if ok:
        name = 'FrozenIceCube__96x96.png'
        sheet.save(os.path.join(OUT_DIR, name))
        out_templates['gFrozenIceCubeComposite'] = {
            'cb': 'SpriteCallbackDummy',
            'img': 'pe/' + name,
            'fw': 96, 'fh': 96, 'cols': 1, 'frames': 1, 'am': 0, 'ob': 1,
            'an': [[]], 'af': [[]],
        }
    else:
        note('ice cube composite: missing split pieces')


out_templates = build_assets(pics, gfx_map, pal_map, templates) if not NO_ASSETS else {}
if not NO_ASSETS:
    build_special_assets(out_templates)
    backgrounds = build_backgrounds()
else:
    backgrounds = {}
    note('assets skipped')

scripts, labels = parse_scripts()

# move table
script_text = read(os.path.join(SRC, 'data', 'battle_anim_scripts.s'))
m = re.search(r'gBattleAnims_Moves::(.*?)\n\s*\.align', script_text, re.S)
moves = []
if m:
    moves = [x.strip().split()[1] for x in m.group(1).strip().splitlines() if x.strip().startswith('.4byte')]

sm = re.search(r'gBattleAnims_StatusConditions::(.*?)\n\s*\.align', script_text, re.S)
status_labels = []
if sm:
    status_labels = [x.strip().split()[1] for x in sm.group(1).strip().splitlines() if x.strip().startswith('.4byte')]
status_names = ['poison', 'confusion', 'burn', 'infatuation', 'sleep', 'paralysis', 'freeze', 'curse', 'nightmare']
status = {}
for i, nm in enumerate(status_names):
    if i < len(status_labels):
        status[nm] = status_labels[i]

gm = re.search(r'gBattleAnims_General::(.*?)\n\s*\.align', script_text, re.S)
general = {}
if gm:
    glabels = [x.strip().split()[1] for x in gm.group(1).strip().splitlines() if x.strip().startswith('.4byte')]
    gnames = ['castform', 'stats', 'substituteFade', 'substituteAppear', 'pokeblock', 'itemKnockoff',
              'turnTrap', 'heldItem', 'smokeball', 'focusBand', 'rain', 'sun', 'sandstorm', 'hail',
              'leechSeedDrain', 'monHit', 'itemSteal', 'snatchMove', 'futureSight', 'doomDesire',
              'focusPunch', 'ingrainHeal', 'wishHeal']
    for i, nm in enumerate(gnames):
        if i < len(glabels):
            general[nm] = glabels[i]

# report
used_cb = {}
for t in out_templates.values():
    used_cb[t['cb']] = used_cb.get(t['cb'], 0) + 1
report.insert(0, f'templates: {len(out_templates)}, with image: {sum(1 for t in out_templates.values() if t["img"])}, callbacks: {len(used_cb)}')
report.insert(1, f'images used: {len(set(t["img"] for t in out_templates.values() if t["img"]))}')
report.insert(2, f'move scripts: {len(moves)}')

data = {
    'templates': out_templates,
    'script': scripts,
    'labels': labels,
    'moves': moves,
    'status': status,
    'general': general,
    'backgrounds': backgrounds,
}

with open(DATA_FILE, 'w', encoding='utf-8') as f:
    f.write('// generated by tools/build-pe-anim.py from pokeemerald\n')
    f.write('export default ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

with open(REPORT_FILE, 'w', encoding='utf-8') as f:
    f.write('\n'.join(report))

print(f'wrote {DATA_FILE}')
print(f'wrote {len(os.listdir(OUT_DIR))} sprite pngs to {OUT_DIR}')
print('\n'.join(report[:4]))
