"""
口袋挂机 · 数值平衡性期望分析
================================
按 src/config.js 的当前数值，计算各系统的单位时间期望：
  1) 掉落系统（每秒累积器）每小时获得数 + 折糖当量（糖果按 ×1~×100 数量倍率加权）
  2) 移动速度与孵蛋里程耗时（截断正态，峰值按体重/稀有度对数均匀）
  3) 糖果每小时收入（掉落 / 农场 / 告示牌 / 悬赏 / 钓鱼单杆）
  4) 糖果每小时消耗（捕获球缺口 / buff / 蛋）
  5) 捕获成本分档（复用 catch_sim 模拟，含逃跑损耗）
  6) 闪光获取效率对比（野生 / 大量出没 / 交换 offer / 护符）
  7) 糖果商店兑换性价比
输出：控制台详细报告 + econ_analysis.png（2×2 图）
数值核对来源：src/config.js / src/battle.js / src/scoring.js / src/items.js / src/fishing.js / src/berry.js
"""
import json
import os
import random
from collections import Counter

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import catch_sim  # 复用真实 pokedex 捕获模拟

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
POKEDEX_PATH = os.path.join(os.path.dirname(BASE_DIR), "src", "pokemon-data", "pokedex.json")

# ================= 与 src/config.js 一致的参数 =================
ITEM_RATES = {  # 每秒累积概率
    'poke-ball': 1 / 90, 'ultra-ball': 1 / 220, 'master-ball': 1 / 900,
    'candy': 1 / 20, 'sweet-honey': 1 / 400, 'mystery-egg': 1 / 800,
    'shiny-charm': 1 / 1000,
}
ITEM_NAMES = {'poke-ball': '精灵球', 'ultra-ball': '高级球', 'master-ball': '大师球',
              'candy': '糖果', 'sweet-honey': '甜甜蜜', 'mystery-egg': '神秘蛋', 'shiny-charm': '闪耀护符'}
CANDY_EXCHANGE = {'poke-ball': 10, 'ultra-ball': 25, 'master-ball': 500,
                  'sweet-honey': 40, 'mystery-egg': 100, 'shiny-charm': 1000}
CATCH_RATES = {'poke-ball': 0.35, 'ultra-ball': 0.70, 'master-ball': 1.00}
BALL_PRICE = {'poke-ball': 10, 'ultra-ball': 25, 'master-ball': 500}
# 糖果掉落数量倍率（权重）：掉落糖果时按此抽一次倍率（src/config.js CANDY_DROP_MULT）
CANDY_DROP_MULT = [(1, 100), (2, 30), (5, 15), (50, 4), (100, 2)]
CANDY_MULT_EXPECT = sum(m * w for m, w in CANDY_DROP_MULT) / sum(w for _, w in CANDY_DROP_MULT)

ENCOUNTER_MIN, ENCOUNTER_MAX = 120, 240        # 普通遇敌间隔（秒）
BUFF_ENCOUNTER_MIN, BUFF_ENCOUNTER_MAX = 15, 30  # buff 遇敌间隔（秒）
BUFF_DURATION = 60
SHINY_CHANCE = 1 / 1000
CHARM_SHINY_CHANCE = 0.8
MASS_SHINY_CHANCE = 1 / 200
MASS_GEN_MIN, MASS_GEN_MAX = 20, 60            # 事件生成间隔（分钟）
MASS_DURATION = 60
MASS_COUNT_MIN, MASS_COUNT_MAX = 10, 20
TRADE_SHINY_CHANCE = 20 / 40
TRADE_COUNT, TRADE_REFRESH_S = 6, 10 * 60
BOUNTY_PER_REGION, BOUNTY_CANDY_MIN, BOUNTY_CANDY_MAX = 5, 30, 500
BOUNTY_JITTER = 0.25             # 悬赏糖果奖励随机浮动 ±25%
BOUNTY_RARE_WEIGHT = 0.7         # 悬赏选角稀有度权重（选角权重 = 0.3 + rarity×0.7）
BATTLE_REFRESH_S = 20 * 60       # NPC 对战刷新间隔（秒）
BATTLE_WAVE_CANDY = 3 * 5 + 2 * 10 + 1 * 20  # 每波满胜糖果：普通×3(5糖)+精英×2(10糖)+冠军×1(20糖)
REGIONS = 9
FARM_PLOT = 6
FARM_MATURE_MIN, FARM_MATURE_MAX = 30, 60      # 分钟
FARM_PLANT_COST, FARM_HARVEST_MIN, FARM_HARVEST_MAX = 10, 2, 5
FARM_CANDY_PER_BERRY = 8
BOARD_DEMANDS, BOARD_QTY_MIN, BOARD_QTY_MAX, BIG_QTY_MIN, BIG_QTY_MAX = 5, 3, 10, 25, 45
HATCH_MIN, HATCH_MAX = 2000, 30000             # 米
PX_PER_METER = 26
ROAD_SPEED = {'走路': 0.5, '跑步': 1.0, '骑车': 2.0}  # px/帧 @60fps
FISH_POKEMON_CHANCE = 0.1                      # 每次钓鱼钓到宝可梦的几率
FISH_QTY_MIN, FISH_QTY_MAX = 1, 15             # 钓到道具最少/最多数量


def km_per_h(px_per_frame):
    return px_per_frame * 60 * 60 * 60 / PX_PER_METER / 1000  # 60 帧/秒 → px/秒 → km/h


def main():
    rng = random.Random(20260804)
    dist = Counter(p.get("catchRate") for p in json.load(open(POKEDEX_PATH, encoding="utf-8-sig")) if p.get("catchRate"))
    total = sum(dist.values())
    print("=" * 74)
    print("口袋挂机 · 数值平衡性期望分析（基于 src/config.js 当前数值）")
    print(f"图鉴 {total} 只 · 捕获模拟复用 catch_sim（判定公式与游戏一致）")
    print("=" * 74)

    # ---------- 1) 掉落系统 ----------
    print("\n【1】掉落系统（每秒累积器：每 tick +rate，满 1 掉落；糖果按倍率加权）")
    print(f"{'道具':<6}{'概率':>10}{'平均间隔':>10}{'每小时':>9}{'兑换价':>8}{'折糖当量/h':>12}")
    drop_sugar = {}
    for k, rate in ITEM_RATES.items():
        mult = CANDY_MULT_EXPECT if k == 'candy' else 1  # 掉落糖果时按 ×1~×100 权重抽取数量
        per_h = rate * 3600 * mult
        sugar = per_h * (CANDY_EXCHANGE.get(k, 1))  # 糖果本身 = 1 糖/个
        drop_sugar[k] = sugar
        print(f"{ITEM_NAMES[k]:<8}{rate:>10.5f}{3600/(rate*3600):>9.0f}s{per_h:>9.1f}{CANDY_EXCHANGE.get(k, '-'):>8}{sugar:>12.0f}")
    total_drop_sugar = sum(drop_sugar.values())
    print(f"掉落总折糖当量: {total_drop_sugar:.0f} 糖/h（若全部按兑换价变现/使用）")
    print(f"  注：糖果掉落数量 ×1/×2/×5/×50/×100（权重 100/30/15/4/2，期望倍率 ×{CANDY_MULT_EXPECT:.1f}）；闪耀护符 1/1000 = 16.7 分钟/个 ≈ 3.6 个/h")

    # ---------- 2) 移动速度与孵蛋 ----------
    print("\n【2】移动速度与孵蛋里程")
    speeds = {name: km_per_h(px) for name, px in ROAD_SPEED.items()}
    for name, v in speeds.items():
        print(f"  {name}: {v:.2f} km/h")
    # 孵蛋里程：峰值按体重/稀有度在对数区间均匀分布（轻/常见→2km，重/稀有→30km），
    # 截断正态采样（标准差 = 峰值 × 0.2）；平均因子 0.5 时峰值约 7.7km
    hatch_avg_m = 2000 * (30000 / 2000) ** 0.5
    for name, v in speeds.items():
        h = hatch_avg_m / 1000 / v
        print(f"  孵蛋期望里程 ≈ {hatch_avg_m/1000:.0f} km（2~30km，按体重/稀有度分布，平均因子取 0.5）：{name} {h:.1f} 小时")

    # ---------- 3) 糖果每小时收入 ----------
    print("\n【3】糖果每小时收入（估算）")
    drop_candy = ITEM_RATES['candy'] * 3600 * CANDY_MULT_EXPECT  # 糖果掉落按数量倍率加权
    farm_net_per_cycle = (FARM_HARVEST_MIN + FARM_HARVEST_MAX) / 2 * FARM_CANDY_PER_BERRY - FARM_PLANT_COST
    farm_cycle_min = (FARM_MATURE_MIN + FARM_MATURE_MAX) / 2
    farm_per_h = FARM_PLOT * farm_net_per_cycle / (farm_cycle_min / 60)
    # 告示牌：5 条/天，末条为大量需求(25~45颗)；奖励 = qty×8 + randInt(0, big?30:8)
    board_norm = BOARD_DEMANDS - 1
    board_day = board_norm * ((BOARD_QTY_MIN + BOARD_QTY_MAX) / 2 * FARM_CANDY_PER_BERRY + 4) \
        + 1 * ((BIG_QTY_MIN + BIG_QTY_MAX) / 2 * FARM_CANDY_PER_BERRY + 15)
    board_per_h = board_day / 24
    # 悬赏：按真实图鉴 rarity/catchRate 分布 + 选角权重(0.3+0.7×rarity) 计算期望奖励；
    # 奖励公式与 src/bounty.js calcBountyCandy 一致：diff=0.5×(1-catchRate)+0.5×rarity
    def bounty_candy(p):
        cr = min(max(p.get("catchRate") or 0.5, 0), 1)
        r = min(max(p.get("rarity") or 0.5, 0), 1)
        diff = 0.5 * (1 - cr) + 0.5 * r
        base = BOUNTY_CANDY_MIN + (BOUNTY_CANDY_MAX - BOUNTY_CANDY_MIN) * diff
        return min(BOUNTY_CANDY_MAX, max(BOUNTY_CANDY_MIN, round(base)))  # jitter ±25% 均值≈1
    _dex = json.load(open(POKEDEX_PATH, encoding="utf-8-sig"))
    _bw = sum((0.3 + min(max(p.get("rarity", 0.5), 0), 1) * BOUNTY_RARE_WEIGHT) for p in _dex if p.get("rarity") is not None)
    bounty_avg = sum((0.3 + min(max(p.get("rarity", 0.5), 0), 1) * BOUNTY_RARE_WEIGHT) / _bw * bounty_candy(p) for p in _dex if p.get("rarity") is not None)
    bounty_day = REGIONS * BOUNTY_PER_REGION
    bounty_per_h_full = bounty_day * bounty_avg / 24
    # NPC 对战：每 20min 一波满胜 55 糖（胜后该 NPC 移出列表），胜率不足时按比例打折
    battle_per_h = BATTLE_WAVE_CANDY / (BATTLE_REFRESH_S / 3600)
    # 钓鱼：单杆 90% 道具(1~15个，按 ITEM_RATES 权重) + 10% 宝可梦战斗；收益受水域路段频率限制
    fish_total_rate = sum(ITEM_RATES.values())
    fish_item_sugar_exp = sum(r / fish_total_rate * CANDY_EXCHANGE.get(k, 1) for k, r in ITEM_RATES.items())
    print(f"  掉落糖果(含倍率):    {drop_candy:>6.0f} 糖/h（20s/个 × {CANDY_MULT_EXPECT:.1f} 倍率）")
    print(f"  树果农场(6地手动):   {farm_per_h:>6.0f} 糖/h（净 {farm_net_per_cycle:.0f} 糖/轮/地 × {FARM_PLOT} 地 ÷ {farm_cycle_min:.0f}min）")
    print(f"  告示牌委托(全做):    {board_per_h:>6.0f} 糖/h（约 {board_day:.0f} 糖/天）")
    print(f"  地区悬赏(9区全做):   {bounty_per_h_full:>6.0f} 糖/h（{bounty_day} 条/天 × 平均 {bounty_avg:.0f} 糖，按真实图鉴稀有度加权）")
    print(f"  NPC 对战(满胜上限): {battle_per_h:>6.0f} 糖/h（每 20min 一波 55 糖；胜率<100% 按比例打折）")
    print(f"  钓鱼: 单杆期望 ≈ {0.9 * ((FISH_QTY_MIN + FISH_QTY_MAX) / 2) * fish_item_sugar_exp:.0f} 糖（道具，"
          f"每杆 {(FISH_QTY_MIN + FISH_QTY_MAX) / 2:.0f} 个 × 加权 {fish_item_sugar_exp:.0f} 糖），另 10% 概率进宝可梦战斗")
    idle_sugar = drop_candy + farm_per_h + board_per_h
    print(f"  → 纯挂机(不悬赏) ≈ {idle_sugar:.0f} 糖/h；全力(悬赏+对战满胜) ≈ {idle_sugar + bounty_per_h_full + battle_per_h:.0f} 糖/h")

    # ---------- 4) 糖果消耗与球缺口 ----------
    print("\n【4】糖果消耗与球供给缺口")
    enc_per_h = 3600 / ((ENCOUNTER_MIN + ENCOUNTER_MAX) / 2)
    print(f"  普通遇敌: {enc_per_h:.1f} 次/h（间隔 {ENCOUNTER_MIN}~{ENCOUNTER_MAX}s，平均 {(ENCOUNTER_MIN+ENCOUNTER_MAX)/2:.0f}s）")
    print(f"  buff 遇敌: {3600 / ((BUFF_ENCOUNTER_MIN + BUFF_ENCOUNTER_MAX) / 2):.0f} 次/h（间隔 {BUFF_ENCOUNTER_MIN}~{BUFF_ENCOUNTER_MAX}s）")
    supply = {k: ITEM_RATES[k] * 3600 for k in ['poke-ball', 'ultra-ball', 'master-ball']}
    print(f"  球掉落供给: 精灵球 {supply['poke-ball']:.0f}/h · 高级球 {supply['ultra-ball']:.1f}/h · 大师球 {supply['master-ball']:.1f}/h")
    # 全图鉴平均精灵球消耗（模拟）
    sim = {b: {"成功率": 0.0, "平均球数(成功)": 0.0, "平均球数(全部)": 0.0} for b in ["poke-ball", "ultra-ball"]}
    for cr, cnt in dist.items():
        w = cnt / total
        for b in ["poke-ball", "ultra-ball"]:
            s = catch_sim.simulate_rate(CATCH_RATES[b], cr, 20000, rng, additive=(0.06 if b == "ultra-ball" else 0))
            for k in sim[b]:
                sim[b][k] += s[k] * w
    for b, label in [("poke-ball", "精灵球"), ("ultra-ball", "高级球")]:
        s = sim[b]
        cost = s["平均球数(全部)"] * BALL_PRICE[b] / max(s["成功率"], 1e-9)
        print(f"  全图鉴平均: {label} 成功率 {s['成功率']*100:.1f}% · 成功均 {s['平均球数(成功)']:.2f} 球 · 期望成本 {cost:.0f} 糖/只")
    # 球缺口：假设全用精灵球抓（20 次/h 遭遇，含逃跑平均球数）
    gap = enc_per_h * sim['poke-ball']["平均球数(全部)"] - supply['poke-ball']
    print(f"  全精灵球挂机: 消耗 {enc_per_h * sim['poke-ball']['平均球数(全部)']:.0f} 球/h vs 供给 {supply['poke-ball']:.0f}/h → "
          f"{'缺口 ' + format(gap, '.0f') + ' 球/h ≈ ' + format(gap * BALL_PRICE['poke-ball'], '.0f') + ' 糖/h' if gap > 0 else '供给富余 ' + format(-gap, '.0f') + ' 球/h'}")
    print(f"  纯挂机糖果收入 ≈ {idle_sugar:.0f} 糖/h，足以覆盖球缺口 + 甜甜蜜/神秘蛋等小额消费")

    # ---------- 5) 捕获成本分档（糖） ----------
    print("\n【5】捕获成本分档（含逃跑损耗，糖果）")
    tiers = [("极低", lambda v: v <= 0.10), ("低", lambda v: 0.10 < v <= 0.25),
             ("中低", lambda v: 0.25 < v <= 0.45), ("中", lambda v: 0.45 < v <= 0.65),
             ("中高", lambda v: 0.65 < v <= 0.85), ("高", lambda v: v > 0.85)]
    tier_data = []
    for name, pred in tiers:
        tcr = {cr: c for cr, c in dist.items() if pred(cr)}
        if not tcr:
            continue
        n = sum(tcr.values())
        row = {}
        for b, label in [("poke-ball", "精灵球"), ("ultra-ball", "高级球")]:
            s = catch_sim.simulate_rate(CATCH_RATES[b], sum(cr * c for cr, c in tcr.items()) / n, 40000, rng,
                                        additive=(0.06 if b == "ultra-ball" else 0))
            row[label] = s["平均球数(全部)"] * BALL_PRICE[b] / max(s["成功率"], 1e-9)
        row["大师球"] = 500
        tier_data.append((name, n, row))
        print(f"  {name:<3} n={n:<5} 精灵球 {row['精灵球']:>5.0f} 糖 | 高级球 {row['高级球']:>5.0f} 糖 | 大师球 500 糖")

    # ---------- 6) 闪光获取效率 ----------
    print("\n【6】闪光获取效率（每 10 小时期望，或单次成本）")
    wild_10h = SHINY_CHANCE * enc_per_h * 10
    mass_10h = (60 / ((MASS_GEN_MIN + MASS_GEN_MAX) / 2)) * (MASS_COUNT_MIN + MASS_COUNT_MAX) / 2 * MASS_SHINY_CHANCE * 10
    egg_10h = ITEM_RATES['mystery-egg'] * 3600 * 10 * SHINY_CHANCE
    trade_10h = TRADE_COUNT * (3600 / TRADE_REFRESH_S) * TRADE_SHINY_CHANCE * 10
    charm_once = CHARM_SHINY_CHANCE * (BUFF_DURATION / ((BUFF_ENCOUNTER_MIN + BUFF_ENCOUNTER_MAX) / 2))
    print(f"  野生遇敌:   {wild_10h:.2f} 只/10h（1/1000 × {enc_per_h:.0f} 次/h）")
    print(f"  大量出没:   {mass_10h:.2f} 只/10h（1/200 × 平均 15 只 × 事件 {60/40:.1f} 个/h）")
    print(f"  孵蛋:       {egg_10h:.2f} 只/10h（神秘蛋 {ITEM_RATES['mystery-egg']*3600:.1f} 个/h × 1/1000）")
    print(f"  交换 offer: {trade_10h:.0f} 只/10h（NPC 可给出的闪光 offer，受库存匹配限制）")
    print(f"  闪耀护符 60s: {charm_once:.1f} 只/次（0.8 × {BUFF_DURATION/22.5:.1f} 次遭遇）→ 1000 糖/次")

    # ---------- 7) 各兑换性价比 ----------
    print("\n【7】糖果商店兑换性价比")
    candy_sec = ITEM_RATES['candy'] * CANDY_MULT_EXPECT  # 每秒期望糖果（含掉落倍率）
    for k, price in CANDY_EXCHANGE.items():
        if k == 'shiny-charm':
            continue
        print(f"  {ITEM_NAMES[k]} {price} 糖 = {price / candy_sec / 60:.1f} 分钟糖果掉落")

    # ================= 可视化 =================
    fig, axes = plt.subplots(2, 2, figsize=(14.5, 10.5))
    fig.patch.set_facecolor("#ffffff")
    fig.suptitle("口袋挂机 · 数值平衡性期望速览", fontsize=20, fontweight="bold", y=0.985)
    fig.text(0.5, 0.935, "基于 src/config.js 当前数值 · 捕获判定与游戏一致 · 掉落按每秒累积器期望", ha="center",
             fontsize=11, color="#666666")

    def style_ax(ax, title):
        ax.set_title(title, fontsize=13, fontweight="bold", pad=12)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
        ax.spines["left"].set_color("#cccccc")
        ax.spines["bottom"].set_color("#cccccc")
        ax.tick_params(colors="#444444")
        ax.grid(axis="y", color="#e8e8e8", lw=0.8, zorder=0)
        ax.set_axisbelow(True)

    # 图1：道具掉落每小时 + 折糖当量
    ax = axes[0, 0]
    names = [ITEM_NAMES[k] for k in ITEM_RATES]
    per_h = [ITEM_RATES[k] * 3600 for k in ITEM_RATES]
    sugar = [drop_sugar[k] for k in ITEM_RATES]
    colors = ["#d85838", "#f8d038", "#7b5fd0", "#e07bd0", "#f0a45a", "#9ac15c", "#55b573"]
    bars = ax.bar(names, per_h, 0.62, color=colors, edgecolor="#5a5a5a", lw=0.6, zorder=3)
    for b, v, s in zip(bars, per_h, sugar):
        ax.text(b.get_x() + b.get_width() / 2, v + 3, f"{v:.0f}/h", ha="center", fontsize=10.5, fontweight="bold")
        ax.text(b.get_x() + b.get_width() / 2, v / 2, f"≈{s:.0f}糖", ha="center", fontsize=9.5,
                color="#333", fontweight="bold")
    ax.set_ylabel("个 / 小时", fontsize=11)
    ax.set_ylim(0, max(per_h) * 1.22)
    style_ax(ax, "道路掉落：每小时获得数（柱内=折糖当量）")

    # 图2：糖果收支
    ax = axes[0, 1]
    inc = {"掉落糖果": drop_candy, "农场(6地)": farm_per_h, "告示牌": board_per_h,
           "悬赏(9区)": bounty_per_h_full, "对战(满胜)": battle_per_h}
    labels = list(inc.keys())
    vals = list(inc.values())
    inc_colors = ["#55b573", "#9ac15c", "#e2b93d", "#f8d038", "#f09058"]
    bars = ax.barh(labels, vals, 0.55, color=inc_colors, edgecolor="#5a5a5a", lw=0.6, zorder=3)
    for b, v in zip(bars, vals):
        ax.text(v + 12, b.get_y() + b.get_height() / 2, f"{v:.0f}", va="center", fontsize=11, fontweight="bold")
    ax.axvline(idle_sugar, ls="--", lw=1.8, color="#555", alpha=0.85)
    ax.text(idle_sugar + 12, len(vals) - 0.42, f"纯挂机收入 {idle_sugar:.0f} 糖/h", fontsize=10, color="#555")
    ax.set_xlim(0, max(vals) * 1.18)
    style_ax(ax, "糖果每小时收入来源")
    ax.set_ylabel("")

    # 图3：捕获成本分档
    ax = axes[1, 0]
    tnames = [t[0] for t in tier_data]
    xpos = list(range(len(tnames)))
    width = 0.34
    for j, (label, color) in enumerate([("精灵球", "#d85838"), ("高级球", "#f8d038"), ("大师球", "#b06ad8")]):
        vals = [t[2][label] for t in tier_data]
        x = [i + (j - 1) * width for i in xpos]
        ax.bar(x, vals, width, label=f"{label}（{BALL_PRICE.get({'精灵球': 'poke-ball', '高级球': 'ultra-ball', '大师球': 'master-ball'}[label], 500)} 糖/个）",
               color=color, edgecolor="#5a5a5a", lw=0.6, zorder=3)
        for xi, v in zip(x, vals):
            ax.text(xi, v + 12, f"{v:.0f}", ha="center", fontsize=9.5, fontweight="bold")
    ax.set_xticks(xpos)
    ax.set_xticklabels([f"{n}档\n(图鉴{t[1]}只)" for n, t in zip(tnames, tier_data)], fontsize=9.5)
    ax.set_ylabel("糖果 / 只", fontsize=11)
    ax.set_ylim(0, max(max(t[2]["精灵球"] for t in tier_data), 500) * 1.18)
    style_ax(ax, "捕获一只的期望糖果成本（含逃跑损耗）")
    ax.legend(fontsize=9.5, frameon=False, ncol=3, loc="upper left")

    # 图4：闪光效率（交换 offer 数值过大且受库存限制，仅以文本标注）
    ax = axes[1, 1]
    labels = ["野生遇敌\n(每10h)", "大量出没\n(每10h)", "孵蛋\n(每10h)", "护符60s\n(单次)"]
    vals = [wild_10h, mass_10h, egg_10h, charm_once]
    bars = ax.bar(labels, vals, 0.5, color=["#55b573", "#f8d038", "#9ac15c", "#7b5fd0"],
                  edgecolor="#5a5a5a", lw=0.6, zorder=3)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.03 * max(vals), f"{v:.2f}", ha="center", fontsize=10.5,
                fontweight="bold")
    ax.set_ylabel("期望闪光数", fontsize=11)
    ax.set_ylim(0, max(vals) * 1.25)
    style_ax(ax, "闪光获取效率对比")
    ax.text(0.98, -0.16, f"另：交换 offer 潜在 {trade_10h:.0f} 只/10h（受库存匹配限制，非稳定来源）",
            transform=ax.transAxes, ha="right", fontsize=9.5, color="#666666")

    fig.tight_layout(rect=(0, 0.02, 1, 0.915))
    out = os.path.join(BASE_DIR, "econ_analysis.png")
    fig.savefig(out, dpi=150)
    print(f"\n图表已保存: {out}")


if __name__ == "__main__":
    main()
