"""
精灵球捕获经济模拟 —— 读取真实 pokedex.json 的 catchRate 分布，按图鉴实际占比加权模拟。
判定公式与 src/battle.js 完全一致：
  捕获率   = (球基础率 × 宝可梦 catchRate + 高级球加成0.06) × 丢球加成   (高级球加成仅高级球有)
  丢球加成 = 1 + max(0, 已丢球数 - 逃跑率拉满球数) × 0.10   (前 10 球无加成，第 11 球起每球 +10%)
  未抓中 → 逃跑率 = min(0.04 + (已丢球数-1) × 0.04, 0.4)
大师球必中（忽略 catchRate），不参与可视化。
档位划分与游戏内「捕获率」等级完全一致（src/battle.js / src/pokedex.js）：
  极低(≤0.1) / 低(≤0.25) / 中低(≤0.45) / 中(≤0.65) / 中高(≤0.85) / 高(>0.85)

数值不再手抄：全部从 src/config.js 解析读取，改配置后重跑即为最新。
输出：docs/catch_analysis.png
"""
import json
import math
import os
import re
import random
from collections import Counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "src", "config.js")
POKEDEX_PATH = os.path.join(ROOT, "src", "pokemon-data", "pokedex.json")
OUT_DIR = os.path.join(ROOT, "docs")

N_PER_RATE = 50_000          # 每个 catchRate 值的模拟遭遇次数


# ==================== src/config.js 解析（唯一数值来源） ====================
def _strip_comments(src):
    """去掉 JS 注释，跳过字符串内部（URL 里的 // 不会被误删）。"""
    out, i, n = [], 0, len(src)
    while i < n:
        c = src[i]
        if c in "'\"`":
            q = c
            out.append(c)
            i += 1
            while i < n:
                out.append(src[i])
                if src[i] == "\\":
                    i += 1
                    if i < n:
                        out.append(src[i])
                    i += 1
                    continue
                if src[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            i += 2
            while i + 1 < n and not (src[i] == "*" and src[i + 1] == "/"):
                i += 1
            i += 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _split_top(text):
    """按顶层逗号切分（忽略括号/字符串内的逗号）。"""
    parts, cur, depth, i = [], "", 0, 0
    while i < len(text):
        c = text[i]
        if c in "'\"`":
            q = c
            cur += c
            i += 1
            while i < len(text):
                cur += text[i]
                if text[i] == "\\":
                    cur += text[i + 1] if i + 1 < len(text) else ""
                    i += 2
                    continue
                if text[i] == q:
                    i += 1
                    break
                i += 1
            continue
        if c in "{[(":
            depth += 1
        elif c in "}])":
            depth -= 1
        if c == "," and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    if cur.strip():
        parts.append(cur)
    return parts


def _num(expr):
    """只允许数字与四则运算的表达式（1 / 20、20 * 60 * 1000 …）。"""
    e = expr.strip()
    if not re.fullmatch(r"[0-9eE+\-*/().\s]+", e):
        raise ValueError(expr)
    return eval(e, {"__builtins__": {}}, {})


def _parse_literal(text):
    t = text.strip()
    if t.startswith("{"):
        out = {}
        for part in _split_top(t[1:-1]):
            if not part.strip():
                continue
            k, _, v = part.partition(":")
            k = k.strip().strip("'\"")
            v = v.strip()
            try:
                out[k] = _parse_literal(v)
            except Exception:
                out[k] = v
        return out
    if t.startswith("["):
        items = []
        for part in _split_top(t[1:-1]):
            if not part.strip():
                continue
            items.append(_parse_literal(part))
        return items
    return _num(t)


def load_config(names):
    """从 src/config.js 读取指定常量，返回 {名字: 值}；解析失败的置 None。"""
    src = _strip_comments(open(CONFIG_PATH, encoding="utf-8").read())
    out = {}
    for name in names:
        m = re.search(r"export\s+const\s+" + re.escape(name) + r"\s*=", src)
        if not m:
            out[name] = None
            continue
        j, depth = m.end(), 0
        while j < len(src):
            c = src[j]
            if c in "'\"`":
                q = c
                j += 1
                while j < len(src) and src[j] != q:
                    if src[j] == "\\":
                        j += 1
                    j += 1
            elif c in "{[(":
                depth += 1
            elif c in "}])":
                depth -= 1
            elif c == ";" and depth == 0:
                break
            j += 1
        try:
            out[name] = _parse_literal(src[m.end():j])
        except Exception as e:
            print(f"[config] {name} 解析失败：{e}")
            out[name] = None
    return out


CONFIG_NAMES = [
    "CATCH_RATES", "ULTRA_BALL_ADD", "CATCH_BONUS_INC", "FLEE_CHANCE", "FLEE_CHANCE_INC",
    "FLEE_CHANCE_MAX", "ITEM_RATES", "CANDY_DROP_MULT", "CANDY_EXCHANGE", "SHINY_CHANCE",
    "CHARM_SHINY_CHANCE", "MASS_SHINY_CHANCE", "TWIST_SHINY_CHANCE", "TRADE_SHINY_CHANCE",
    "ENCOUNTER_MIN", "ENCOUNTER_MAX", "BUFF_ENCOUNTER_MIN", "BUFF_ENCOUNTER_MAX", "BUFF_DURATION",
    "ROAD_SPEED_WALK", "ROAD_SPEED_RUN", "ROAD_SPEED_BIKE", "PX_PER_METER",
    "HATCH_DIST_MIN", "HATCH_DIST_MAX", "HATCH_DIST_SIGMA",
    "MASS_GEN_MIN", "MASS_GEN_MAX", "MASS_DURATION", "MASS_COUNT_MIN", "MASS_COUNT_MAX",
    "FARM_PLOT_COUNT", "FARM_MATURE_MIN", "FARM_MATURE_MAX", "FARM_PLANT_COST",
    "FARM_HARVEST_MIN", "FARM_HARVEST_MAX", "FARM_CANDY_PER_BERRY",
    "FARM_BOARD_DEMANDS", "FARM_BOARD_QTY_MIN", "FARM_BOARD_QTY_MAX",
    "FARM_BOARD_BIG_QTY_MIN", "FARM_BOARD_BIG_QTY_MAX",
    "FARM_BOARD_MEGA_QTY_MIN", "FARM_BOARD_MEGA_QTY_MAX",
    "BOUNTY_PER_REGION", "BOUNTY_CANDY_MIN", "BOUNTY_CANDY_MAX", "BOUNTY_JITTER",
    "BOUNTY_RARE_WEIGHT", "BOUNTY_COST_REF", "BOUNTY_CANDY_CN", "BOUNTY_BIG_CN",
    "BATTLE_REFRESH_MS", "BATTLE_NPC_COUNTS", "EVO_PRICES", "EVO_EXCLUSIVE_PRICE",
    "DISPATCH_CANDY_PER_HOUR", "DISPATCH_SLOTS", "FISH_POKEMON_CHANCE", "FISH_QTY_MIN", "FISH_QTY_MAX",
]
CFG = load_config(CONFIG_NAMES)

# 派生：逃跑率拉满所需球数（与 src/scoring.js FLEE_MAXED_AT 同公式）
FLEE_MAXED_AT = math.ceil((CFG["FLEE_CHANCE_MAX"] - CFG["FLEE_CHANCE"]) / CFG["FLEE_CHANCE_INC"]) + 1

BALL_LABELS = {"poke-ball": "精灵球", "ultra-ball": "高级球", "master-ball": "大师球"}
BALL_PRICE = {k: CFG["CANDY_EXCHANGE"][k] for k in BALL_LABELS}
BALL_COLORS = {"精灵球": "#d85838", "高级球": "#f8d038"}

# 游戏内「捕获率」六档（与 src/battle.js / src/pokedex.js 完全一致）
TIERS = [
    ("极低", "≤10%",  lambda v: v <= 0.10),
    ("低",   "11~25%", lambda v: 0.10 < v <= 0.25),
    ("中低", "26~45%", lambda v: 0.25 < v <= 0.45),
    ("中",   "46~65%", lambda v: 0.45 < v <= 0.65),
    ("中高", "66~85%", lambda v: 0.65 < v <= 0.85),
    ("高",   ">85%",   lambda v: v > 0.85),
]
TIER_COLORS = ["#d94f4f", "#e8833a", "#e2b93d", "#9ac15c", "#55b573", "#2fa36b"]


def load_power_forms():
    """强化形态编号（evolution.json 的 stones 名单）：它们不进任何抽取池，只能靠进化+专属道具获得。"""
    ev = json.load(open(os.path.join(ROOT, "src", "pokemon-data", "evolution.json"), encoding="utf-8"))
    return set((ev.get("stones") or {}).keys())


def load_pokedex(exclude_power=True):
    """返回 {catchRate: 宝可梦数量} 的真实分布（默认排除强化形态：它们抓不到）。"""
    d = json.load(open(POKEDEX_PATH, encoding="utf-8-sig"))
    powers = load_power_forms() if exclude_power else set()
    return Counter(p.get("catchRate") for p in d
                   if p.get("catchRate") is not None and str(p.get("index")) not in powers)


def simulate_one(ball_rate, catch_rate, rng, master=False, additive=0.0):
    balls = 0
    while True:
        balls += 1
        if master:
            return balls, True
        catch_bonus = 1 + max(0, balls - FLEE_MAXED_AT) * CFG["CATCH_BONUS_INC"]
        if rng.random() < (ball_rate * catch_rate + additive) * catch_bonus:
            return balls, True
        if rng.random() < min(CFG["FLEE_CHANCE"] + (balls - 1) * CFG["FLEE_CHANCE_INC"], CFG["FLEE_CHANCE_MAX"]):
            return balls, False


def simulate_rate(ball_rate, catch_rate, n, rng, master=False, additive=0.0):
    caught = caught_balls = total_balls = 0
    for _ in range(n):
        b, ok = simulate_one(ball_rate, catch_rate, rng, master, additive)
        total_balls += b
        if ok:
            caught += 1
            caught_balls += b
    return {
        "成功率": caught / n,
        "平均球数(成功)": caught_balls / max(caught, 1),
        "平均球数(全部)": total_balls / n,
    }


def tier_stats(tier_crates, ball_key, rng, master=False, additive=0.0):
    """对一档内所有 catchRate 值模拟，按真实宝可梦数量加权聚合。"""
    n_total = sum(tier_crates.values())
    agg = {"成功率": 0.0, "平均球数(成功)": 0.0, "平均球数(全部)": 0.0}
    for cr, cnt in tier_crates.items():
        s = simulate_rate(CFG["CATCH_RATES"][ball_key], cr, N_PER_RATE, rng, master, additive)
        w = cnt / n_total
        for k in agg:
            agg[k] += s[k] * w
    return agg, n_total


def main():
    rng = random.Random(20260804)
    dist = load_pokedex()
    total = sum(dist.values())
    print(f"图鉴总数: {total}（已排除 {len(load_power_forms())} 条强化形态：只能靠进化获得，抓不到）")
    print(f"catchRate 唯一值: {len(dist)}")
    print(f"球价（config.js CANDY_EXCHANGE）: " + " · ".join(f"{BALL_LABELS[k]} {BALL_PRICE[k]} 糖" for k in BALL_LABELS))
    print(f"逃跑率拉满球数 FLEE_MAXED_AT = {FLEE_MAXED_AT}（第 {FLEE_MAXED_AT + 1} 球起每球 +10% 加成）")

    balls_list = ["poke-ball", "ultra-ball"]
    all_stats = {}
    for b in balls_list:
        s = {"成功率": 0.0, "平均球数(成功)": 0.0, "平均球数(全部)": 0.0}
        for cr, cnt in dist.items():
            ss = simulate_rate(CFG["CATCH_RATES"][b], cr, N_PER_RATE, rng,
                               additive=(CFG["ULTRA_BALL_ADD"] if b == "ultra-ball" else 0.0))
            w = cnt / total
            for k in s:
                s[k] += ss[k] * w
        all_stats[b] = s

    tiers = []
    for name, rng_str, pred in TIERS:
        tcr = {cr: c for cr, c in dist.items() if pred(cr)}
        if not tcr:
            continue
        stats = {}
        for b in balls_list:
            stats[b] = tier_stats(tcr, b, rng, additive=(CFG["ULTRA_BALL_ADD"] if b == "ultra-ball" else 0.0))[0]
        tiers.append((name, rng_str, stats, sum(tcr.values())))

    print(f"\n=== 全图鉴加权平均（按真实 catchRate 分布） ===")
    print(f"{'球种':<8}{'捕获成功率':>10}{'平均球数(成功)':>14}{'期望成本(含逃跑损耗)':>20}")
    for b in balls_list:
        s = all_stats[b]
        cost = s["平均球数(全部)"] * BALL_PRICE[b] / max(s["成功率"], 1e-9)
        print(f"{BALL_LABELS[b]:<10}{s['成功率']*100:>8.1f}%{s['平均球数(成功)']:>14.2f}{cost:>20.0f} 糖")

    print(f"\n=== 分档（游戏内捕获率等级 · 真实宝可梦数量） ===")
    for name, rng_str, stats, cnt in tiers:
        s1, s2 = stats["poke-ball"], stats["ultra-ball"]
        print(f"{name:<3}({rng_str}) n={cnt:<5} 精灵球: 成功{s1['成功率']*100:4.1f}% 均{s1['平均球数(成功)']:4.1f}球"
              f" | 高级球: 成功{s2['成功率']*100:4.1f}% 均{s2['平均球数(成功)']:4.1f}球")

    # ---------- 可视化 ----------
    names = [f"{t[0]}\n{t[1]}" for t in tiers]
    cnts = [t[3] for t in tiers]
    xpos = list(range(len(names)))
    width = 0.36

    fig, axes = plt.subplots(2, 2, figsize=(14, 10.5))
    fig.patch.set_facecolor("#ffffff")
    fig.suptitle("捕获一只宝可梦，要花多少精灵球？", fontsize=20, fontweight="bold", y=0.985)
    fig.text(0.5, 0.935, f"基于游戏真实图鉴 {total} 条（排除 {len(load_power_forms())} 条只能靠进化的强化形态）· "
                        f"每个档位模拟 {N_PER_RATE:,} 次遭遇 · 判定公式与游戏战斗完全一致",
             ha="center", fontsize=11, color="#666666")

    def style_ax(ax, title):
        ax.set_title(title, fontsize=13.5, fontweight="bold", pad=12)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color("#cccccc")
        ax.spines["bottom"].set_color("#cccccc")
        ax.tick_params(colors="#444444")
        ax.grid(axis="y", color="#e8e8e8", lw=0.8, zorder=0)
        ax.set_axisbelow(True)

    # 图1：图鉴分布
    ax = axes[0, 0]
    bars = ax.bar(names, cnts, width, color=TIER_COLORS, zorder=3)
    for r, v in zip(bars, cnts):
        ax.text(r.get_x() + r.get_width() / 2, v + 10, str(v), ha="center", fontsize=12, fontweight="bold")
        ax.text(r.get_x() + r.get_width() / 2, v / 2, f"{v / total * 100:.0f}%", ha="center",
                fontsize=10, color="white", fontweight="bold")
    ax.set_ylabel("宝可梦数量", fontsize=11)
    ax.set_ylim(0, max(cnts) * 1.18)
    style_ax(ax, "图鉴分布：各捕获率档位有多少宝可梦？")

    # 图2：平均球数（成功捕获）
    ax = axes[0, 1]
    for j, b in enumerate(balls_list):
        vals = [t[2][b]["平均球数(成功)"] for t in tiers]
        x = [i + (j - 0.5) * width for i in xpos]
        ax.bar(x, vals, width, label=BALL_LABELS[b], color=BALL_COLORS[BALL_LABELS[b]],
               edgecolor="#5a5a5a", lw=0.6, zorder=3)
        for xi, v in zip(x, vals):
            ax.text(xi, v + 0.3, f"{v:.1f}", ha="center", fontsize=10, fontweight="bold")
    for b in balls_list:
        ax.axhline(all_stats[b]["平均球数(成功)"], ls="--", lw=1.5, color=BALL_COLORS[BALL_LABELS[b]], alpha=0.9)
    ax.set_xticks(xpos)
    ax.set_xticklabels(names, fontsize=9.5)
    ax.set_ylabel("丢球数", fontsize=11)
    ax.set_ylim(0, max(max(t[2][b]["平均球数(成功)"] for t in tiers) for b in balls_list) * 1.2)
    style_ax(ax, "平均抓捕球数（成功捕获 · 虚线 = 全图鉴平均）")
    ax.legend(fontsize=10, frameon=False, ncol=2, loc="upper left")

    # 图3：捕获成功率
    ax = axes[1, 0]
    for j, b in enumerate(balls_list):
        vals = [t[2][b]["成功率"] * 100 for t in tiers]
        x = [i + (j - 0.5) * width for i in xpos]
        ax.bar(x, vals, width, label=BALL_LABELS[b], color=BALL_COLORS[BALL_LABELS[b]],
               edgecolor="#5a5a5a", lw=0.6, zorder=3)
        for xi, v in zip(x, vals):
            ax.text(xi, v + 2, f"{v:.0f}%", ha="center", fontsize=10, fontweight="bold")
    for b in balls_list:
        ax.axhline(all_stats[b]["成功率"] * 100, ls="--", lw=1.5, color=BALL_COLORS[BALL_LABELS[b]], alpha=0.9)
    ax.set_xticks(xpos)
    ax.set_xticklabels(names, fontsize=9.5)
    ax.set_ylabel("最终捕获率 %", fontsize=11)
    ax.set_ylim(0, max(max(t[2][b]["成功率"] for t in tiers) for b in balls_list) * 100 * 1.18)
    style_ax(ax, "捕获成功率（每档遭遇中最终抓到一只 · 虚线 = 全图鉴平均）")
    ax.legend(fontsize=10, frameon=False, ncol=2, loc="upper left")

    # 图4：平均糖果成本（含逃跑损耗）
    ax = axes[1, 1]
    for j, b in enumerate(balls_list):
        vals = [t[2][b]["平均球数(全部)"] * BALL_PRICE[b] / max(t[2][b]["成功率"], 1e-9) for t in tiers]
        x = [i + (j - 0.5) * width for i in xpos]
        ax.bar(x, vals, width, label=f"{BALL_LABELS[b]}（{BALL_PRICE[b]} 糖/个）",
               color=BALL_COLORS[BALL_LABELS[b]], edgecolor="#5a5a5a", lw=0.6, zorder=3)
        for xi, v in zip(x, vals):
            ax.text(xi, v + 3, f"{v:.0f}", ha="center", fontsize=10, fontweight="bold")
    ax.set_xticks(xpos)
    ax.set_xticklabels(names, fontsize=9.5)
    ax.set_ylabel("糖果", fontsize=11)
    ax.set_ylim(0, max(max(t[2][b]["平均球数(全部)"] * BALL_PRICE[b] / max(t[2][b]["成功率"], 1e-9)
                          for t in tiers) for b in balls_list) * 1.2)
    style_ax(ax, "平均糖果成本（抓一只的期望花费 · 含逃跑损耗）")
    ax.legend(fontsize=10, frameon=False, ncol=2, loc="upper left")

    fig.text(0.5, 0.012,
             f"注：成本 = 每次遭遇平均球数 × 单价 ÷ 成功率（已计入逃跑浪费的球） · 球价：精灵球 {BALL_PRICE['poke-ball']} 糖、"
             f"高级球 {BALL_PRICE['ultra-ball']} 糖 · 捕获率等级与图鉴展示一致（极低~高） · 数值读自 src/config.js",
             ha="center", fontsize=9.5, color="#888888")

    fig.tight_layout(rect=(0, 0.028, 1, 0.915))
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "catch_analysis.png")
    fig.savefig(out, dpi=150)
    print(f"\n图表已保存: {out}")


if __name__ == "__main__":
    main()
