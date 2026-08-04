"""
精灵球捕获经济模拟 —— 读取真实 pokedex.json 的 catchRate 分布，按图鉴实际占比加权模拟。
判定公式与 src/battle.js 完全一致：
  捕获率   = (球基础率 × 宝可梦 catchRate + 高级球加成0.06) × 丢球加成   (高级球加成仅高级球有)
  丢球加成 = 1 + max(0, 已丢球数 - 10) × 0.10        (前10球无加成，第11球起每球+10%)
  未抓中 → 逃跑率 = min(0.04 + (已丢球数-1) × 0.04, 0.4)
大师球必中（忽略 catchRate），不参与可视化。
档位划分与游戏内「捕获率」等级完全一致（src/battle.js / src/pokedex.js）：
  极低(≤0.1) / 低(≤0.25) / 中低(≤0.45) / 中(≤0.65) / 中高(≤0.85) / 高(>0.85)
"""
import json
import os
import random
from collections import Counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False

# ---- 与 config.js / battle.js 一致的参数 ----
CATCH_RATES = {"精灵球": 0.35, "高级球": 0.70, "大师球": 1.00}
ULTRA_BALL_ADD = 0.06     # 高级球绝对捕获率加成：捕获率 = (基础率×catchRate + 加成) × 丢球加成
CATCH_BONUS_INC = 0.10
BONUS_START_AT = 10
FLEE_CHANCE = 0.04
FLEE_CHANCE_INC = 0.04
FLEE_CHANCE_MAX = 0.40
BALL_PRICE = {"精灵球": 10, "高级球": 25, "大师球": 500}
BALL_COLORS = {"精灵球": "#d85838", "高级球": "#f8d038"}
N_PER_RATE = 50_000          # 每个 catchRate 值的模拟遭遇次数
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
POKEDEX_PATH = os.path.join(os.path.dirname(BASE_DIR), "src", "pokemon-data", "pokedex.json")

# 游戏内「捕获率」六档（与 src/battle.js / src/pokedex.js 完全一致）
# 每项: (档位名, 范围显示, 判定函数)
TIERS = [
    ("极低", "≤10%",  lambda v: v <= 0.10),
    ("低",   "11~25%", lambda v: 0.10 < v <= 0.25),
    ("中低", "26~45%", lambda v: 0.25 < v <= 0.45),
    ("中",   "46~65%", lambda v: 0.45 < v <= 0.65),
    ("中高", "66~85%", lambda v: 0.65 < v <= 0.85),
    ("高",   ">85%",   lambda v: v > 0.85),
]
# 档位配色：从难到易的红→绿渐变，直观表达捕获难度
TIER_COLORS = ["#d94f4f", "#e8833a", "#e2b93d", "#9ac15c", "#55b573", "#2fa36b"]


def load_pokedex():
    """返回 {catchRate: 宝可梦数量} 的真实分布。"""
    d = json.load(open(POKEDEX_PATH, encoding="utf-8-sig"))
    return Counter(p.get("catchRate") for p in d if p.get("catchRate") is not None)


def simulate_one(ball_rate, catch_rate, rng, master=False, additive=0.0):
    balls = 0
    while True:
        balls += 1
        if master:
            return balls, True
        catch_bonus = 1 + max(0, balls - BONUS_START_AT) * CATCH_BONUS_INC
        if rng.random() < (ball_rate * catch_rate + additive) * catch_bonus:
            return balls, True
        if rng.random() < min(FLEE_CHANCE + (balls - 1) * FLEE_CHANCE_INC, FLEE_CHANCE_MAX):
            return balls, False


def simulate_rate(ball_rate, catch_rate, n, rng, master=False, additive=0.0):
    caught = 0
    caught_balls = 0
    total_balls = 0
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


def tier_stats(tier_crates, ball_rate, rng, master=False, additive=0.0):
    """对一档内所有 catchRate 值模拟，按真实宝可梦数量加权聚合。"""
    n_total = sum(tier_crates.values())
    agg = {"成功率": 0.0, "平均球数(成功)": 0.0, "平均球数(全部)": 0.0}
    for cr, cnt in tier_crates.items():
        s = simulate_rate(ball_rate, cr, N_PER_RATE, rng, master, additive)
        w = cnt / n_total
        for k in agg:
            agg[k] += s[k] * w
    return agg, n_total


def main():
    rng = random.Random(20260804)
    dist = load_pokedex()
    total = sum(dist.values())
    print(f"图鉴总数: {total}，catchRate 唯一值: {len(dist)}")

    # 全图鉴加权统计 + 分档统计
    all_stats = {}
    for b, rate in CATCH_RATES.items():
        s = {"成功率": 0.0, "平均球数(成功)": 0.0, "平均球数(全部)": 0.0}
        for cr, cnt in dist.items():
            ss = simulate_rate(rate, cr, N_PER_RATE, rng, master=(b == "大师球"),
                               additive=(ULTRA_BALL_ADD if b == "高级球" else 0.0))
            w = cnt / total
            for k in s:
                s[k] += ss[k] * w
        all_stats[b] = s

    tiers = []  # (档位名, 范围显示, 该档统计, 该档宝可梦数量)
    for name, rng_str, pred in TIERS:
        tcr = {cr: c for cr, c in dist.items() if pred(cr)}
        if not tcr:
            continue
        stats = {}
        for b, rate in CATCH_RATES.items():
            stats[b] = tier_stats(tcr, rate, rng, master=(b == "大师球"),
                                  additive=(ULTRA_BALL_ADD if b == "高级球" else 0.0))[0]
        tiers.append((name, rng_str, stats, sum(tcr.values())))

    # ---------- 控制台：全图鉴加权平均 ----------
    print(f"\n=== 全图鉴加权平均（按真实 catchRate 分布） ===")
    print(f"{'球种':<8}{'捕获成功率':>10}{'平均球数(成功)':>14}{'期望成本(含逃跑损耗)':>20}")
    for b in CATCH_RATES:
        s = all_stats[b]
        cost = s["平均球数(全部)"] * BALL_PRICE[b] / max(s["成功率"], 1e-9)
        print(f"{b:<10}{s['成功率']*100:>8.1f}%{s['平均球数(成功)']:>14.2f}{cost:>20.0f} 糖")

    print(f"\n=== 分档（游戏内捕获率等级 · 真实宝可梦数量） ===")
    for name, rng_str, stats, cnt in tiers:
        s1, s2 = stats["精灵球"], stats["高级球"]
        print(f"{name:<3}({rng_str}) n={cnt:<5} 精灵球: 成功{s1['成功率']*100:4.1f}% 均{s1['平均球数(成功)']:4.1f}球"
              f" | 高级球: 成功{s2['成功率']*100:4.1f}% 均{s2['平均球数(成功)']:4.1f}球")

    # ---------- 可视化 ----------
    names = [f"{t[0]}\n{t[1]}" for t in tiers]
    cnts = [t[3] for t in tiers]
    xpos = list(range(len(names)))
    balls_list = ["精灵球", "高级球"]
    width = 0.36

    fig, axes = plt.subplots(2, 2, figsize=(14, 10.5))
    fig.patch.set_facecolor("#ffffff")
    fig.suptitle("捕获一只宝可梦，要花多少精灵球？", fontsize=20, fontweight="bold", y=0.985)
    fig.text(0.5, 0.935, f"基于游戏真实图鉴 {total} 只宝可梦 · 每个档位模拟 {N_PER_RATE:,} 次遭遇 · 判定公式与游戏战斗完全一致",
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
        ax.bar(x, vals, width, label=b, color=BALL_COLORS[b], edgecolor="#5a5a5a", lw=0.6, zorder=3)
        for xi, v in zip(x, vals):
            ax.text(xi, v + 0.3, f"{v:.1f}", ha="center", fontsize=10, fontweight="bold")
    for b in balls_list:
        ax.axhline(all_stats[b]["平均球数(成功)"], ls="--", lw=1.5, color=BALL_COLORS[b], alpha=0.9)
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
        ax.bar(x, vals, width, label=b, color=BALL_COLORS[b], edgecolor="#5a5a5a", lw=0.6, zorder=3)
        for xi, v in zip(x, vals):
            ax.text(xi, v + 2, f"{v:.0f}%", ha="center", fontsize=10, fontweight="bold")
    for b in balls_list:
        ax.axhline(all_stats[b]["成功率"] * 100, ls="--", lw=1.5, color=BALL_COLORS[b], alpha=0.9)
    ax.set_xticks(xpos)
    ax.set_xticklabels(names, fontsize=9.5)
    ax.set_ylabel("最终捕获率 %", fontsize=11)
    ax.set_ylim(0, max(max(t[2][b]["成功率"] for t in tiers) for b in balls_list) * 100 * 1.18)
    style_ax(ax, "捕获成功率（每档遭遇中最终抓到一只 · 虚线 = 全图鉴平均）")
    ax.legend(fontsize=10, frameon=False, ncol=2, loc="upper left")

    # 图4：平均糖果成本（含逃跑损耗）
    ax = axes[1, 1]
    for j, b in enumerate(balls_list):
        # 期望成本 = 每次遭遇平均球数 × 单价 ÷ 成功率（已计入逃跑时浪费的球）
        vals = [t[2][b]["平均球数(全部)"] * BALL_PRICE[b] / max(t[2][b]["成功率"], 1e-9) for t in tiers]
        x = [i + (j - 0.5) * width for i in xpos]
        ax.bar(x, vals, width, label=f"{b}（{BALL_PRICE[b]} 糖/个）", color=BALL_COLORS[b],
               edgecolor="#5a5a5a", lw=0.6, zorder=3)
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
             "注：成本 = 每次遭遇平均球数 × 单价 ÷ 成功率（已计入逃跑浪费的球） · 球价：精灵球 10 糖、高级球 25 糖 · 捕获率等级与图鉴展示一致（极低~高）",
             ha="center", fontsize=9.5, color="#888888")

    fig.tight_layout(rect=(0, 0.028, 1, 0.915))
    out = os.path.join(BASE_DIR, "catch_analysis.png")
    fig.savefig(out, dpi=150)
    print(f"\n图表已保存: {out}")


if __name__ == "__main__":
    main()
