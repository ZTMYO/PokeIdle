"""
口袋挂机 · 数值平衡性期望分析
================================
数值全部从 src/config.js 解析（不再手抄快照），数据分布读 src/pokemon-data/pokedex.json 与 evolution.json：
  1) 掉落系统（每秒累积器）每小时获得数 + 折糖当量（糖果按 ×1~×100 数量倍率加权）
  2) 移动速度与孵蛋里程耗时
  3) 糖果每小时收入（掉落 / 派遣 / 树果告示牌 / 悬赏 / NPC 对战）
  4) 糖果消耗与球供给缺口
  5) 捕获成本分档（复用 catch_sim 模拟，含逃跑损耗）
  6) 闪光获取效率对比（野生 / 大量出没 / 神秘蛋 / 护符）
  7) 糖果商店兑换性价比
输出：控制台详细报告 + docs/econ_analysis.png（2×2 图）
数值核对来源：src/config.js / src/battle.js / src/scoring.js / src/items.js / src/bounty.js / src/berry.js / src/npcs.js
"""
import bisect
import json
import math
import os
import random

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

import catch_sim
from catch_sim import CFG

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei"]
plt.rcParams["axes.unicode_minus"] = False

ROOT = catch_sim.ROOT
POKEDEX_PATH = catch_sim.POKEDEX_PATH
EVOLUTION_PATH = os.path.join(ROOT, "src", "pokemon-data", "evolution.json")
OUT_DIR = catch_sim.OUT_DIR


# ==================== 数据与工具 ====================
def load_dex():
    return json.load(open(POKEDEX_PATH, encoding="utf-8-sig"))


def load_evolution():
    return json.load(open(EVOLUTION_PATH, encoding="utf-8"))


def wild_excluded_set(ev):
    """与 src/evolution.js loadEvolution 同规则：在 edges 里当目标、自己没出边、又不在 wildKeep 里的排掉。"""
    keep = set(ev.get("wildKeep", []))
    edges = ev.get("edges", {})
    out = set()
    for row in edges.values():
        for to in row:
            if to in keep or to in edges:
                continue
            out.add(to)
    return out


def candy_mult_expect():
    mw = CFG["CANDY_DROP_MULT"]
    return sum(d["mult"] * d["weight"] for d in mw) / sum(d["weight"] for d in mw)


def avg(lo, hi):
    return (lo + hi) / 2


# ==================== 悬赏模型（镜像 src/bounty.js） ====================
def bounty_cost(idx, dex_by_idx, edges, excluded, evo_prices):
    p = dex_by_idx[idx]
    def wild_difficulty(q):
        cr = min(max(q.get("catchRate") or 0.5, 0), 1)
        r = min(max(q.get("rarity") or 0.5, 0), 1)
        return 0.5 * (1 - cr) + 0.5 * r

    if idx not in excluded:
        return wild_difficulty(p)

    def edge_cost(cond):
        c = 0.0
        if cond.get("lv"):
            c += (cond["lv"] - 1) / 100
        if cond.get("item"):
            it = cond["item"]
            price = evo_prices.get(it) if isinstance(it, str) else None
            c += (price or 400) / 2500
        if cond.get("move"):
            c += 0.15
        if cond.get("region"):
            c += 0.15
        if cond.get("gender"):
            c += 0.05
        if cond.get("candy") or cond.get("coin"):
            c += 0.2
        return c

    preds = {}
    for f, row in edges.items():
        for to, cond in row.items():
            preds.setdefault(to, []).append((f, cond))

    best = math.inf
    frontier = {idx: 0.0}
    seen = {idx}
    while frontier:
        nxt = {}
        for cur, acc in frontier.items():
            for f, cond in preds.get(cur, []):
                if f in seen:
                    continue
                seen.add(f)
                cost = acc + edge_cost(cond)
                q = dex_by_idx.get(f)
                if q is not None and f not in excluded:
                    best = min(best, wild_difficulty(q) + cost)
                nxt[f] = cost
        frontier = nxt
    return best if math.isfinite(best) else wild_difficulty(p)


def bounty_daily_candy(dex, ev, rng, days=3000, exclude_finals=True):
    """模拟悬赏抽选与奖励（镜像 src/bounty.js），返回 (糖果档占比, 糖果档均值, 糖果/天, 单件档占比, 高阶档占比)。
    exclude_finals=True 复刻当前代码的池子过滤；False 用于对照"进化终点也进悬赏"的设计口径。"""
    stones = set((ev.get("stones") or {}).keys())
    excluded = wild_excluded_set(ev)
    edges = ev.get("edges", {})
    evo_prices = CFG["EVO_PRICES"] or {}
    pool = [p for p in dex if not p.get("legend") and str(p["index"]) not in stones
            and not (exclude_finals and str(p["index"]) in excluded)]
    by_idx = {str(p["index"]): p for p in dex}

    # 家族 = 编号前缀（与 items.js foldFamilies 一致）；家族权重取成员最大
    fams = {}
    for p in pool:
        fams.setdefault(str(p["index"]).split("-")[0], []).append(p)
    weights, members = [], []
    for g in fams.values():
        w = max((0.3 + min(max(p.get("rarity") or 0.5, 0), 1) * CFG["BOUNTY_RARE_WEIGHT"])
                * (0.7 if str(p["index"]) in excluded else 1) for p in g)
        weights.append(max(w, 1e-9))
        members.append(g)
    total_w = sum(weights)
    cum = []
    acc = 0.0
    for w in weights:
        acc += w
        cum.append(acc)

    cost_cache = {}
    n_per_day = CFG["BOUNTY_PER_REGION"] * 9
    candy_n = candy_sum = mid_n = big_n = 0
    for _ in range(days):
        for _ in range(n_per_day):
            gi = bisect.bisect_left(cum, rng.random() * total_w)
            if gi >= len(members):
                gi = len(members) - 1
            g = members[gi]
            p = g[rng.randrange(len(g))]
            idx = str(p["index"])
            if idx not in cost_cache:
                cost_cache[idx] = bounty_cost(idx, by_idx, edges, excluded, evo_prices)
            cn = min(1.0, cost_cache[idx] / CFG["BOUNTY_COST_REF"])
            if cn < CFG["BOUNTY_CANDY_CN"]:
                base = CFG["BOUNTY_CANDY_MIN"] + (CFG["BOUNTY_CANDY_MAX"] - CFG["BOUNTY_CANDY_MIN"]) * cn
                jitter = 1 + (rng.random() * 2 - 1) * CFG["BOUNTY_JITTER"]
                c = min(CFG["BOUNTY_CANDY_MAX"], max(CFG["BOUNTY_CANDY_MIN"], round(base * jitter)))
                candy_n += 1
                candy_sum += c
            elif cn < CFG["BOUNTY_BIG_CN"]:
                mid_n += 1
            else:
                big_n += 1
    picked = days * n_per_day
    return candy_n / picked, candy_sum / max(candy_n, 1), candy_sum / days, mid_n / picked, big_n / picked


def main():
    rng = random.Random(20260804)
    dex = load_dex()
    ev = load_evolution()
    dist = catch_sim.load_pokedex()
    total = sum(dist.values())
    print("=" * 78)
    print("口袋挂机 · 数值平衡性期望分析（数值读自 src/config.js，数据读自 pokemon-data）")
    print(f"图鉴 {total} 条（已排除 {len(dex)-total} 条只能靠进化的强化形态）· 捕获模拟复用 catch_sim（判定公式与游戏一致）")
    print("=" * 78)

    # ---------- 1) 掉落系统 ----------
    print("\n【1】掉落系统（每秒累积器：每 tick +rate，满 1 掉落；糖果按倍率加权）")
    print(f"{'道具':<6}{'概率':>11}{'平均间隔':>10}{'每小时':>10}{'兑换价':>8}{'折糖当量/h':>12}")
    mult_exp = candy_mult_expect()
    drop_sugar = {}
    item_labels = {"poke-ball": "精灵球", "ultra-ball": "高级球", "master-ball": "大师球", "candy": "糖果",
                   "sweet-honey": "甜甜蜜", "mystery-egg": "神秘蛋", "shiny-charm": "闪耀护符", "bike": "自行车"}
    for k, rate in CFG["ITEM_RATES"].items():
        mult = mult_exp if k == "candy" else 1
        per_h = rate * 3600 * mult
        sugar = per_h * (CFG["CANDY_EXCHANGE"].get(k, 1) if k != "candy" else 1)
        drop_sugar[k] = sugar
        print(f"{item_labels.get(k, k):<8}{rate:>11.6f}{3600/(rate*3600):>9.0f}s{per_h:>10.2f}"
              f"{(CFG['CANDY_EXCHANGE'].get(k, '-'))!s:>8}{sugar:>12.1f}")
    print(f"掉落总折糖当量: {sum(drop_sugar.values()):.0f} 糖/h（若全部按兑换价变现/使用）")
    print(f"  糖果掉落数量 ×1/×2/×5/×50/×100（权重 100/30/15/4/2，期望倍率 ×{mult_exp:.2f}）")

    # ---------- 2) 移动速度与孵蛋 ----------
    print("\n【2】移动速度与孵蛋里程")
    pxs = {"走路": CFG["ROAD_SPEED_WALK"], "跑步": CFG["ROAD_SPEED_RUN"], "骑车": CFG["ROAD_SPEED_BIKE"]}
    speeds = {n: v * 60 * 60 * 60 / CFG["PX_PER_METER"] / 1000 for n, v in pxs.items()}
    for n, v in speeds.items():
        print(f"  {n}: {v:.2f} km/h（{pxs[n]:.2f} px/帧 @60fps · {CFG['PX_PER_METER']} px/米）")
    hatch_mid = CFG["HATCH_DIST_MIN"] * (CFG["HATCH_DIST_MAX"] / CFG["HATCH_DIST_MIN"]) ** 0.5
    print(f"  孵蛋里程 {CFG['HATCH_DIST_MIN']/1000:.0f}~{CFG['HATCH_DIST_MAX']/1000:.0f} km，"
          f"峰值取几何中位 {hatch_mid/1000:.1f} km：走路 {hatch_mid/1000/speeds['走路']:.1f} 小时")

    # ---------- 3) 糖果每小时收入 ----------
    print("\n【3】糖果每小时收入（估算）")
    drop_candy = CFG["ITEM_RATES"]["candy"] * 3600 * mult_exp
    dispatch_per_h = CFG["DISPATCH_CANDY_PER_HOUR"] * CFG["DISPATCH_SLOTS"]

    bd = CFG["FARM_BOARD_DEMANDS"]
    n_norm, n_big, n_mega = bd - 2, 1, 1
    berry_need = (n_norm * avg(CFG["FARM_BOARD_QTY_MIN"], CFG["FARM_BOARD_QTY_MAX"])
                  + n_big * avg(CFG["FARM_BOARD_BIG_QTY_MIN"], CFG["FARM_BOARD_BIG_QTY_MAX"])
                  + n_mega * avg(CFG["FARM_BOARD_MEGA_QTY_MIN"], CFG["FARM_BOARD_MEGA_QTY_MAX"]))
    board_gross = (berry_need * CFG["FARM_CANDY_PER_BERRY"]
                   + n_norm * avg(0, 8) + n_big * avg(0, 30) + n_mega * avg(0, 60))
    plant_cost = berry_need / avg(CFG["FARM_HARVEST_MIN"], CFG["FARM_HARVEST_MAX"]) * CFG["FARM_PLANT_COST"]
    board_net_per_h = (board_gross - plant_cost) / 24
    mat_min = avg(CFG["FARM_MATURE_MIN"], CFG["FARM_MATURE_MAX"]) / 60000
    farm_capacity_h = CFG["FARM_PLOT_COUNT"] * avg(CFG["FARM_HARVEST_MIN"], CFG["FARM_HARVEST_MAX"]) / (mat_min / 60)
    print(f"  掉落糖果(含倍率):     {drop_candy:>6.0f} 糖/h（{CFG['ITEM_RATES']['candy']*3600:.0f} 个/h × {mult_exp:.2f} 倍率）")
    print(f"  派遣({CFG['DISPATCH_SLOTS']} 槽全满):        {dispatch_per_h:>6.0f} 糖/h（{CFG['DISPATCH_CANDY_PER_HOUR']} 糖/小时/槽基础值，属性侧重与变体另加）")
    print(f"  树果→糖果(告示牌):    {board_net_per_h:>6.0f} 糖/h 净（毛 {board_gross/24:.0f}，扣种植费 {plant_cost/24:.0f}；"
          f"日需求 {berry_need:.0f} 果 vs 产能 {farm_capacity_h*24:.0f} 果/天，告示牌是上限）")
    bounty_share, bounty_avg, bounty_day, bounty_mid, bounty_big = bounty_daily_candy(dex, ev, rng)
    bounty_per_h = bounty_day / 24
    print(f"  地区悬赏(9区全做):    {bounty_per_h:>6.0f} 糖/h（{CFG['BOUNTY_PER_REGION']*9} 条/天，糖果档 {bounty_share*100:.1f}%、"
          f"均 {bounty_avg:.0f} 糖；单件档 {bounty_mid*100:.1f}%、高阶档 {bounty_big*100:.1f}%）")
    alt_share, alt_avg, alt_day, alt_mid, alt_big = bounty_daily_candy(dex, ev, rng, exclude_finals=False)
    print(f"    ！口径提醒：当前 bounty.js 的池子带 !isWildExcluded（进化终点不进悬赏），"
          f"但同处的注释与 ×0.7 权重写着「不排除」，设计记录也是「悬赏点名进化形态 → 允许」。")
    print(f"    若按设计口径（终点也进池）：糖果档 {alt_share*100:.1f}%、均 {alt_avg:.0f} 糖、"
          f"单件档 {alt_mid*100:.1f}%、高阶档 {alt_big*100:.1f}% → {alt_day/24:.0f} 糖/h；"
          f"（文档实测基准 35.3% / 均 266 / 单件 43.9% / 高阶 20.8%）")
    counts = CFG["BATTLE_NPC_COUNTS"]
    tier_candy = {"novice": 5, "veteran": 10, "leader": 15, "champion": 20}
    wave = sum(counts.get(k, 0) * v for k, v in tier_candy.items())
    battle_per_h = wave / (CFG["BATTLE_REFRESH_MS"] / 3600000)
    print(f"  NPC 对战(满胜上限):   {battle_per_h:>6.0f} 糖/h（每 {CFG['BATTLE_REFRESH_MS']//60000} 分钟一波 {wave} 糖："
          + " + ".join(f"{counts[k]}×{tier_candy[k]}" for k in tier_candy) + "）")
    enc_per_h = 3600 / avg(CFG["ENCOUNTER_MIN"], CFG["ENCOUNTER_MAX"])
    idle_sugar = drop_candy + dispatch_per_h + board_net_per_h
    print(f"  → 纯挂机（掉落+派遣+树果）≈ {idle_sugar:.0f} 糖/h；再加悬赏/对战满做 ≈ {idle_sugar + bounty_per_h + battle_per_h:.0f} 糖/h")
    print(f"  钓鱼: 单杆期望 ≈ {0.9 * avg(CFG['FISH_QTY_MIN'], CFG['FISH_QTY_MAX']) * sum(r/sum(CFG['ITEM_RATES'].values()) * (CFG['CANDY_EXCHANGE'].get(k, 1) if k != 'candy' else mult_exp) for k, r in CFG['ITEM_RATES'].items()):.0f} 糖"
          f"（{CFG['FISH_POKEMON_CHANCE']*100:.0f}% 概率转为宝可梦遭遇，不计入）")

    # ---------- 4) 糖果消耗与球缺口 ----------
    print("\n【4】糖果消耗与球供给缺口")
    print(f"  普通遇敌 {enc_per_h:.1f} 次/h（{CFG['ENCOUNTER_MIN']}~{CFG['ENCOUNTER_MAX']}s）；"
          f"增益期 {3600/avg(CFG['BUFF_ENCOUNTER_MIN'], CFG['BUFF_ENCOUNTER_MAX']):.0f} 次/h")
    supply = {k: CFG["ITEM_RATES"][k] * 3600 for k in ["poke-ball", "ultra-ball", "master-ball"]}
    print(f"  球掉落供给: 精灵球 {supply['poke-ball']:.0f}/h · 高级球 {supply['ultra-ball']:.1f}/h · 大师球 {supply['master-ball']:.2f}/h")
    sim = {b: {"成功率": 0.0, "平均球数(成功)": 0.0, "平均球数(全部)": 0.0} for b in ["poke-ball", "ultra-ball"]}
    for cr, cnt in dist.items():
        w = cnt / total
        for b in ["poke-ball", "ultra-ball"]:
            s = catch_sim.simulate_rate(CFG["CATCH_RATES"][b], cr, 20000, rng,
                                        additive=(CFG["ULTRA_BALL_ADD"] if b == "ultra-ball" else 0))
            for k in sim[b]:
                sim[b][k] += s[k] * w
    for b, label in [("poke-ball", "精灵球"), ("ultra-ball", "高级球")]:
        s = sim[b]
        cost = s["平均球数(全部)"] * CFG["CANDY_EXCHANGE"][b] / max(s["成功率"], 1e-9)
        print(f"  全图鉴平均: {label} 成功率 {s['成功率']*100:.1f}% · 成功均 {s['平均球数(成功)']:.2f} 球 · 期望成本 {cost:.0f} 糖/只")
    gap = enc_per_h * sim["poke-ball"]["平均球数(全部)"] - supply["poke-ball"]
    if gap > 0:
        print(f"  全精灵球挂机: 消耗 {enc_per_h * sim['poke-ball']['平均球数(全部)']:.0f} 球/h vs 供给 {supply['poke-ball']:.0f}/h "
              f"→ 缺口 {gap:.0f} 球/h ≈ {gap * CFG['CANDY_EXCHANGE']['poke-ball']:.0f} 糖/h")
    else:
        print(f"  全精灵球挂机: 消耗 {enc_per_h * sim['poke-ball']['平均球数(全部)']:.0f} 球/h vs 供给 {supply['poke-ball']:.0f}/h "
              f"→ 富余 {-gap:.0f} 球/h")
    print(f"  纯挂机糖果收入 ≈ {idle_sugar:.0f} 糖/h，覆盖球缺口后仍有盈余")

    # ---------- 5) 捕获成本分档 ----------
    print("\n【5】捕获成本分档（含逃跑损耗，糖果）")
    tier_defs = [("极低", lambda v: v <= 0.10), ("低", lambda v: 0.10 < v <= 0.25),
                 ("中低", lambda v: 0.25 < v <= 0.45), ("中", lambda v: 0.45 < v <= 0.65),
                 ("中高", lambda v: 0.65 < v <= 0.85), ("高", lambda v: v > 0.85)]
    tier_data = []
    for name, pred in tier_defs:
        tcr = {cr: c for cr, c in dist.items() if pred(cr)}
        if not tcr:
            continue
        n = sum(tcr.values())
        row = {}
        for b, label in [("poke-ball", "精灵球"), ("ultra-ball", "高级球")]:
            s = catch_sim.simulate_rate(CFG["CATCH_RATES"][b], sum(cr * c for cr, c in tcr.items()) / n, 40000, rng,
                                        additive=(CFG["ULTRA_BALL_ADD"] if b == "ultra-ball" else 0))
            row[label] = s["平均球数(全部)"] * CFG["CANDY_EXCHANGE"][b] / max(s["成功率"], 1e-9)
        row["大师球"] = CFG["CANDY_EXCHANGE"]["master-ball"]
        tier_data.append((name, n, row))
        print(f"  {name:<3} n={n:<5} 精灵球 {row['精灵球']:>5.0f} 糖 | 高级球 {row['高级球']:>5.0f} 糖 | "
              f"大师球 {row['大师球']} 糖")

    # ---------- 6) 闪光获取效率 ----------
    print("\n【6】闪光获取效率（每 10 小时期望，或单次成本）")
    wild_10h = CFG["SHINY_CHANCE"] * enc_per_h * 10
    mass_per_h = (60 / avg(CFG["MASS_GEN_MIN"], CFG["MASS_GEN_MAX"])) * avg(CFG["MASS_COUNT_MIN"], CFG["MASS_COUNT_MAX"])
    mass_10h = mass_per_h * CFG["MASS_SHINY_CHANCE"] * 10
    egg_10h = CFG["ITEM_RATES"]["mystery-egg"] * 3600 * 10 * CFG["SHINY_CHANCE"]
    enc_in_charm = CFG["BUFF_DURATION"] / avg(CFG["BUFF_ENCOUNTER_MIN"], CFG["BUFF_ENCOUNTER_MAX"])
    charm_once = 1 + (enc_in_charm - 1) * CFG["CHARM_SHINY_CHANCE"]   # 首只保底 + 其余按 5%
    trade_10h = (6 * (3600 / 600)) * CFG["TRADE_SHINY_CHANCE"] * 10
    print(f"  野生遇敌:     {wild_10h:.2f} 只/10h（1/{int(1/CFG['SHINY_CHANCE'])} × {enc_per_h:.0f} 次/h）")
    print(f"  大量出没:     {mass_10h:.2f} 只/10h（1/{int(1/CFG['MASS_SHINY_CHANCE'])} × 平均"
          f"{avg(CFG['MASS_COUNT_MIN'], CFG['MASS_COUNT_MAX']):.0f} 只 × 事件 {60/avg(CFG['MASS_GEN_MIN'], CFG['MASS_GEN_MAX']):.1f} 个/h）")
    print(f"  神秘蛋掉落:   {egg_10h:.3f} 只/10h（{CFG['ITEM_RATES']['mystery-egg']*3600:.1f} 个/h × 1/{int(1/CFG['SHINY_CHANCE'])}）")
    print(f"  交换 offer:   {trade_10h:.2f} 只/10h（6 个/10 分钟 × 1/{int(1/CFG['TRADE_SHINY_CHANCE'])}，受库存匹配限制）")
    print(f"  闪耀护符 60s: {charm_once:.2f} 只/次（首只保底 + 其余 {enc_in_charm-1:.1f} 次遭遇 × {CFG['CHARM_SHINY_CHANCE']*100:.0f}%），"
          f"{CFG['CANDY_EXCHANGE']['shiny-charm']} 糖/个")

    # ---------- 7) 各兑换性价比 ----------
    print("\n【7】糖果商店兑换性价比（按掉落糖果收入折算）")
    candy_sec = CFG["ITEM_RATES"]["candy"] * mult_exp
    for k, price in CFG["CANDY_EXCHANGE"].items():
        print(f"  {item_labels.get(k, k):<6}{price:>7} 糖 = {price / candy_sec / 60:>6.1f} 分钟糖果掉落")

    # ================= 可视化 =================
    fig, axes = plt.subplots(2, 2, figsize=(14.5, 10.5))
    fig.patch.set_facecolor("#ffffff")
    fig.suptitle("口袋挂机 · 数值平衡性期望速览", fontsize=20, fontweight="bold", y=0.985)
    fig.text(0.5, 0.935, f"数值读自 src/config.js（图鉴 {total} 条，排除只能进化的强化形态）· 捕获判定与游戏一致 · 掉落按每秒累积器期望",
             ha="center", fontsize=11, color="#666666")

    def style_ax(ax, title):
        ax.set_title(title, fontsize=13.5, fontweight="bold", pad=12)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
        ax.spines["left"].set_color("#cccccc")
        ax.spines["bottom"].set_color("#cccccc")
        ax.tick_params(colors="#444444")
        ax.grid(axis="y", color="#e8e8e8", lw=0.8, zorder=0)
        ax.set_axisbelow(True)

    # 图1：道具掉落每小时 + 折糖当量（横轴对数：跨越 0.03~760 个/h，用棒棒糖点图避免柱长失真）
    ax = axes[0, 0]
    keys = list(CFG["ITEM_RATES"].keys())
    names = [item_labels.get(k, k) for k in keys]
    per_h = [CFG["ITEM_RATES"][k] * 3600 * (mult_exp if k == "candy" else 1) for k in keys]
    sugar = [drop_sugar[k] for k in keys]
    colors = ["#d85838", "#f8d038", "#7b5fd0", "#e07bd0", "#f0a45a", "#9ac15c", "#55b573"]
    ypos = list(range(len(keys)))[::-1]
    ax.hlines(ypos, 0.02, per_h, color="#bbbbbb", lw=1.2, zorder=2)
    ax.scatter(per_h, ypos, s=90, color=colors[:len(keys)], zorder=3, edgecolor="#5a5a5a", lw=0.6)
    for y, v, s in zip(ypos, per_h, sugar):
        vt = f"{v:.2f}".rstrip("0").rstrip(".") if v < 1 else (f"{v:.1f}" if v < 100 else f"{v:.0f}")
        ax.text(v * 1.25, y, f"{vt} 个/h · ≈{s:.0f} 糖", va="center", fontsize=9.5, fontweight="bold")
    ax.set_xscale("log")
    ax.set_xlim(0.02, max(per_h) * 8)
    ax.set_yticks(ypos)
    ax.set_yticklabels(names, fontsize=10.5)
    ax.set_xlabel("个 / 小时（对数轴）", fontsize=11)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.spines["left"].set_color("#cccccc")
    ax.spines["bottom"].set_color("#cccccc")
    ax.grid(axis="x", color="#e8e8e8", lw=0.8, zorder=0)
    ax.set_axisbelow(True)
    ax.set_title("道路掉落：每小时获得数（折糖当量）", fontsize=13.5, fontweight="bold", pad=12)

    # 图2：糖果收支
    ax = axes[0, 1]
    inc = {"掉落糖果": drop_candy, f"派遣({CFG['DISPATCH_SLOTS']}槽)": dispatch_per_h,
           "树果→糖果": board_net_per_h, f"悬赏({CFG['BOUNTY_PER_REGION']*9}条)": bounty_per_h,
           "对战(满胜)": battle_per_h}
    labels, vals = list(inc.keys()), list(inc.values())
    inc_colors = ["#55b573", "#6fbf8d", "#9ac15c", "#f8d038", "#f09058"]
    bars = ax.barh(labels, vals, 0.55, color=inc_colors, edgecolor="#5a5a5a", lw=0.6, zorder=3)
    for b, v in zip(bars, vals):
        ax.text(v + max(vals) * 0.012, b.get_y() + b.get_height() / 2, f"{v:.0f}", va="center",
                fontsize=11, fontweight="bold")
    ax.axvline(idle_sugar, ls="--", lw=1.8, color="#555", alpha=0.85)
    ax.text(idle_sugar + max(vals) * 0.012, len(vals) - 0.45, f"纯挂机收入 {idle_sugar:.0f} 糖/h",
            fontsize=10, color="#555")
    ax.set_xlim(0, max(vals) * 1.2)
    style_ax(ax, "糖果每小时收入来源")

    # 图3：捕获成本分档
    ax = axes[1, 0]
    tnames = [t[0] for t in tier_data]
    xpos = list(range(len(tnames)))
    width = 0.34
    for j, (label, color) in enumerate([("精灵球", "#d85838"), ("高级球", "#f8d038"), ("大师球", "#b06ad8")]):
        vals = [t[2][label] for t in tier_data]
        x = [i + (j - 1) * width for i in xpos]
        price = CFG["CANDY_EXCHANGE"]["master-ball"] if label == "大师球" else \
            CFG["CANDY_EXCHANGE"]["poke-ball" if label == "精灵球" else "ultra-ball"]
        ax.bar(x, vals, width, label=f"{label}（{price} 糖/个）", color=color, edgecolor="#5a5a5a", lw=0.6, zorder=3)
        for xi, v in zip(x, vals):
            ax.text(xi, v + max(vals) * 0.02, f"{v:.0f}", ha="center", fontsize=9.5, fontweight="bold")
    ax.set_xticks(xpos)
    ax.set_xticklabels([f"{n}档\n(图鉴{t[1]}只)" for n, t in zip(tnames, tier_data)], fontsize=9.5)
    ax.set_ylabel("糖果 / 只", fontsize=11)
    ax.set_ylim(0, max(max(t[2]["精灵球"] for t in tier_data), CFG["CANDY_EXCHANGE"]["master-ball"]) * 1.15)
    style_ax(ax, "捕获一只的期望糖果成本（含逃跑损耗）")
    ax.legend(fontsize=9.5, frameon=False, ncol=3, loc="upper left")

    # 图4：闪光效率
    ax = axes[1, 1]
    labels = ["野生遇敌\n(每10h)", "大量出没\n(每10h)", f"神秘蛋掉落\n(每10h)", "护符60s\n(单次)"]
    vals = [wild_10h, mass_10h, egg_10h, charm_once]
    bars = ax.bar(labels, vals, 0.5, color=["#55b573", "#f8d038", "#9ac15c", "#7b5fd0"],
                  edgecolor="#5a5a5a", lw=0.6, zorder=3)
    for b, v in zip(bars, vals):
        ax.text(b.get_x() + b.get_width() / 2, v + 0.03 * max(vals), f"{v:.2f}" if v >= 0.05 else f"{v:.3f}",
                ha="center", fontsize=10.5, fontweight="bold")
    ax.set_ylabel("期望闪光数", fontsize=11)
    ax.set_ylim(0, max(vals) * 1.25)
    style_ax(ax, "闪光获取效率对比")
    ax.text(0.98, -0.16, f"另：交换 offer 潜在 {trade_10h:.2f} 只/10h（受库存匹配限制）"
                         f" · 护符首只保底、其余 {CFG['CHARM_SHINY_CHANCE']*100:.0f}%",
            transform=ax.transAxes, ha="right", fontsize=9.5, color="#666666")

    fig.tight_layout(rect=(0, 0.02, 1, 0.915))
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, "econ_analysis.png")
    fig.savefig(out, dpi=150)
    print(f"\n图表已保存: {out}")


if __name__ == "__main__":
    main()
