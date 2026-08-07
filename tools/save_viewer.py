#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""口袋挂机 · 存档查看器（只读，不写存档）

读取 Tauri 桌面版存档 %APPDATA%/com.pokemon.idle/save.json，按数据分区以多个
列表页展示（物品/宝可梦/队伍/图鉴/孵蛋器/孵蛋记录/饲育屋/农场/训练/活动/统计/
成就/日志/设置/原始数据），字段全部中文化，并自动扫描常见数据异常（越界数值、
无效引用、时间戳异常等），在列表行标红、「数据问题」页集中列出。用于快速排查存档问题。

「原始数据」页把整个存档按 JSON 树逐层展开（任意嵌套深度），避免嵌套结构只露出最外层。
用法：python tools/save_viewer.py
"""
import os
import json
import datetime
import tkinter as tk
from tkinter import ttk, filedialog

APP_DIR = os.path.dirname(os.path.abspath(__file__))
POKEDEX_PATH = os.path.join(APP_DIR, "..", "src", "pokemon-data", "pokedex.json")
DEFAULT_SAVE = os.path.join(os.environ.get("APPDATA", ""), "com.pokemon.idle", "save.json")
MAX_LEVEL = 100

ITEM_CN = {
    "candy": "糖果", "poke-ball": "精灵球", "ultra-ball": "超级球", "master-ball": "大师球",
    "sweet-honey": "甜甜蜜", "mystery-egg": "神秘蛋", "shiny-charm": "闪耀护符",
}
NATURE_CN = dict([
    ("hardy", "勤奋"), ("lonely", "怕寂寞"), ("adamant", "固执"), ("naughty", "顽皮"), ("brave", "勇敢"),
    ("bold", "大胆"), ("docile", "坦率"), ("impish", "淘气"), ("lax", "乐天"), ("relaxed", "悠闲"),
    ("modest", "内敛"), ("mild", "慢吞吞"), ("bashful", "害羞"), ("rash", "马虎"), ("quiet", "冷静"),
    ("calm", "温和"), ("gentle", "温顺"), ("careful", "慎重"), ("quirky", "浮躁"), ("sassy", "自大"),
    ("timid", "胆小"), ("hasty", "急躁"), ("jolly", "爽朗"), ("naive", "天真"), ("serious", "认真"),
])
SRC_CN = {"normal": "野生", "fishing": "钓鱼", "egg": "孵蛋", "honey": "甜甜蜜", "trade": "交换"}
GENDER_SYMBOL = {"male": "♂", "female": "♀", "genderless": "无"}
BERRY_NAMES = ["利木果", "樱子果", "零余果", "苹野果", "木子果", "茄番果",
               "橙橙果", "桃桃果", "莓莓果", "文柚果", "勿花果", "异奇果"]
STAT_CN = {
    "totalCatches": ("总捕获数", "累计捕捉宝可梦数"),
    "totalFlees": ("总逃跑数", "累计逃跑/挣脱数"),
    "totalShinySeen": ("闪光遇见数", "遇到的闪光宝可梦数"),
    "totalShinyCaught": ("闪光捕获数", "捕获的闪光宝可梦数"),
    "totalEggsHatched": ("孵蛋总数", "累计孵化宝可梦数"),
    "totalShinyEggsHatched": ("闪光孵蛋", "累计孵化出闪光宝可梦数"),
    "totalEggsProduced": ("繁育产蛋", "饲育屋累计产蛋数"),
    "totalPlaySeconds": ("在线时长(秒)", "累计挂机时长"),
    "playSecondsToday": ("今日时长(秒)", "今日挂机时长"),
    "lastPlayDate": ("最近游玩日期", "最近一次游玩日期（YYYY-MM-DD）"),
    "lastSaveTime": ("最后保存时间", "存档最近写入时间戳"),
    "walkDistance": ("行走距离", "累计行走像素"),
    "totalBallsUsed": ("丢球数", "累计使用精灵球数"),
    "totalNpcWins": ("NPC胜场", "挑战NPC胜利次数"),
    "totalNpcNoviceWins": ("普通NPC胜场", "战胜普通训练家次数"),
    "totalNpcEliteWins": ("精英NPC胜场", "战胜精英训练家次数"),
    "totalNpcChampionWins": ("冠军NPC胜场", "战胜冠军训练家次数"),
    "totalNpcCandy": ("NPC糖果", "NPC对战累计获得糖果"),
    "totalBountyClaims": ("完成悬赏", "累计完成地区悬赏数"),
    "bountyClaimsToday": ("今日悬赏", "今日完成悬赏数"),
    "totalBountyCandy": ("悬赏糖果", "悬赏累计获得糖果"),
    "lastBountyDate": ("上次悬赏日期", "最近完成悬赏日期"),
    "totalTrades": ("总交换数", "累计完成交换次数"),
    "tradesToday": ("今日交换", "今日完成交换数"),
    "lastTradeDate": ("上次交换日期", "最近完成交换日期"),
    "totalBlockMade": ("合成方块", "累计合成树果方块数"),
    "totalPlantings": ("种植次数", "累计种植树果次数"),
    "totalHarvests": ("收获次数", "累计收获树果次数"),
    "totalBerriesHarvested": ("收获树果", "累计收获树果数"),
    "totalBoardTrades": ("完成委托", "累计完成告示牌树果委托数"),
    "totalItemsEarned": ("道具获得", "各道具累计获得数"),
    # 旧字段保留兼容
    "totalSteps": ("总步数", "累计步数"),
    "totalEncounters": ("总遭遇数", "累计遭遇宝可梦数"),
    "totalBerries": ("收获树果", "累计收获树果数"),
    "totalBlocks": ("合成方块", "累计合成树果方块数"),
    "totalTraining": ("训练次数", "累计训练次数"),
}
TOP_KEY_CN = {
    "items": "物品", "stats": "统计", "roster": "宝可梦仓库", "team": "出战队伍",
    "pokedex": "图鉴", "encounterLogs": "遭遇记录", "incubators": "孵蛋器",
    "incubatorLogs": "孵蛋记录", "incubatorUnlockedSlots": "孵蛋器解锁槽位",
    "nursery": "饲育屋", "berryFarm": "树果农场", "gps": "导航", "massOutbreak": "大量出没",
    "massNextGenAt": "大量出没刷新时间", "bounty": "悬赏", "trades": "交换广场",
    "battleNpcs": "NPC对战", "training": "训练", "achievements": "成就",
    "systemLogs": "系统日志", "settings": "设置", "lastSavedAt": "最后保存时间",
    "version": "版本", "introDone": "开场剧情完成", "currentRegion": "当前地区",
}
STAT_KEYS = ("hp", "atk", "def", "spa", "spd", "spe")
STAT_KEY_CN = {"hp": "HP", "atk": "攻击", "def": "防御", "spa": "特攻", "spd": "特防", "spe": "速度"}

# 成就 ID → （中文名, 说明）
ACHIEVEMENT_CN = {
    "candy": ("糖果富翁", "累计获得糖果数"), "play": ("时间旅人", "累计挂机时长"),
    "catch": ("收服之旅", "累计捕捉宝可梦"), "walk": ("漫步者", "累计行走距离"),
    "harvest": ("农场主", "累计收获树果"), "hatch": ("孵化师", "累计孵化宝可梦"),
    "breed": ("育种大师", "累计繁殖产蛋"), "block": ("树果大师", "累计合成树果方块"),
    "trade": ("交换达人", "累计完成交换"), "npcCandy": ("对战丰收", "累计 NPC 对战获得糖果"),
    "npcWin": ("百战百胜", "累计战胜 NPC"), "bounty": ("赏金猎人", "累计完成地区悬赏"),
    "npcElite": ("精英猎人", "累计战胜精英 NPC"), "npcChampion": ("冠军挑战者", "累计战胜冠军 NPC"),
    "dex": ("图鉴收藏家", "累计捕获不同种类"), "shinyCaught": ("闪光收藏家", "累计捕获闪光宝可梦"),
}

# 系统日志类型 → 中文名
LOG_TYPE_CN = {
    "item_gain": "获得道具", "item_use": "使用道具", "fishing": "钓鱼",
    "shop_purchase": "商店兑换", "encounter": "遭遇", "pokemon_caught": "捕获",
    "player_fled": "逃跑", "pokemon_escaped": "宝可梦逃跑", "egg_hatch": "孵蛋",
    "region_change": "地区变更", "bounty_claim": "悬赏完成", "berry_helper": "招募帮手",
    "berry_helper_end": "帮手结束", "berry_plant": "种植树果", "berry_harvest": "收获树果",
    "berry_trade": "树果委托", "trade": "交换", "mixer": "混合器",
    "incubator_place": "孵蛋器放入", "incubator_unlock": "孵蛋器解锁",
    "mass_outbreak_start": "大量出没开始", "mass_outbreak_end": "大量出没结束",
    "train_start": "开始训练", "train_end": "结束训练", "train_levelup": "训练升级",
    "train_lazy": "开始偷懒", "train_wake": "叫醒偷懒", "train_feed": "进食树果",
    "nursery_breed_start": "开始繁殖", "nursery_egg": "产蛋",
    "pokemon_release": "放生", "buff_expired": "增益结束", "战斗": "NPC对战",
}

# 设置项 → （中文名, 说明）
SETTING_DEFS = {
    "autoCatch": ("自动捕捉", "遇敌自动丢球捕捉"),
    "autoFlee": ("佛系模式", "遇敌自动逃跑"),
    "shinyStop": ("闪光暂停", "遇闪光暂停自动操作"),
    "legendStop": ("神兽暂停", "遇神兽暂停自动操作"),
    "autoCatchBalls": ("自动捕捉用球", "各球种是否用于自动捕捉"),
    "autoBuffHoney": ("自动甜甜蜜", "自动使用甜甜蜜"),
    "autoBuffCharm": ("自动闪耀护符", "自动使用闪耀护符"),
    "windowPinned": ("窗口置顶", "游戏窗口始终置顶"),
    "windowScale": ("窗口倍率", "界面缩放倍率"),
    "gender": ("主角性别", "游戏主角"),
    "musicVolume": ("音乐音量", "0~1"),
    "musicEnabled": ("音乐开关", "是否播放 BGM"),
    "battleMusic": ("战斗音乐", "战斗中切换战斗 BGM"),
}
BALL_CN = {"poke-ball": "精灵球", "ultra-ball": "高级球", "master-ball": "大师球"}
GENDER_CN = {"brendan": "小悠（男）", "may": "小遥（女）"}
TIER_CN = {"novice": "普通", "elite": "精英", "champion": "冠军"}

# 问题 → 所属标签页
TAB_OF_PATH = (
    ("roster.", 1), ("team.", 2), ("items.", 0), ("pokedex.", 3), ("incubators.", 4),
    ("incubatorLogs.", 5), ("nursery.", 6), ("berryFarm.", 7), ("training.", 8),
    ("stats.", 10), ("achievements.", 11), ("systemLogs.", 12), ("settings.", 13),
    ("gps.", 9), ("massOutbreak.", 9), ("massNextGenAt", 9), ("bounty", 9),
    ("trades", 9), ("battleNpcs", 9), ("lastSavedAt", 9), ("incubatorUnlockedSlots", 9),
)
ISSUE_TAB = 15  # 「数据问题」页索引
RAW_TAB = 14    # 「原始数据」页索引


def load_pokedex():
    try:
        with open(POKEDEX_PATH, "r", encoding="utf-8-sig") as f:
            arr = json.load(f)
        return {str(p["index"]): p.get("name", str(p["index"])) for p in arr}
    except Exception:
        return {}


def fmt_time(ms):
    try:
        ms = float(ms)
        if ms <= 0:
            return str(ms)
        return datetime.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return str(ms)


def fmt_bool(v):
    return "是" if v else "否"


def fmt_ms_remain(ms):
    """毫秒 → 「X 分 Y 秒」"""
    try:
        s = max(0, int(ms // 1000))
        m, s = divmod(s, 60)
        return f"{m} 分 {s} 秒"
    except Exception:
        return str(ms)


# ============ 数据健康检查（纯函数，便于无头测试） ============
def run_checks(data, pokedex):
    """返回 [(原始路径, 问题描述)]；路径形如 roster.3.level"""
    issues = []
    now = datetime.datetime.now().timestamp() * 1000

    def add(path, msg):
        issues.append((path, msg))

    if not isinstance(data, dict):
        issues.append(("", f"存档根节点不是对象（实际类型 {type(data).__name__}）"))
        return issues

    valid_idx = set(pokedex.keys())
    natures = set(NATURE_CN.keys())
    sources = set(SRC_CN.keys())

    items = data.get("items")
    if items is not None and isinstance(items, dict):
        for k, v in items.items():
            if not isinstance(v, (int, float)):
                add(f"items.{k}", f"物品「{ITEM_CN.get(k, k)}」数量不是数值（{v!r}）")
            elif v < 0:
                add(f"items.{k}", f"物品「{ITEM_CN.get(k, k)}」数量为负（{v}）")

    roster = data.get("roster")
    seen_ids = set()
    egg_ids = set()
    for i, m in enumerate(roster or []):
        p = f"roster.{i}"
        if not isinstance(m, dict):
            add(p, f"第 {i} 条不是对象（{m!r}）")
            continue
        sid = m.get("species")
        if sid is None:
            add(f"{p}.species", "缺少 species 字段")
        elif str(sid) not in valid_idx:
            add(f"{p}.species", f"未知宝可梦编号「{sid}」")
        lv = m.get("level")
        if not isinstance(lv, (int, float)):
            add(f"{p}.level", f"等级不是数值（{lv!r}）")
        elif not (1 <= lv <= MAX_LEVEL):
            add(f"{p}.level", f"等级越界（{lv}，应在 1~{MAX_LEVEL}）")
        ivs = m.get("ivs")
        if isinstance(ivs, dict):
            for k, v in ivs.items():
                if not (0 <= v <= 31):
                    add(f"{p}.ivs.{k}", f"个体值越界（{STAT_KEY_CN.get(k, k)}={v}，应在 0~31）")
        evs = m.get("evs")
        if isinstance(evs, dict):
            for k, v in evs.items():
                if not (0 <= v <= 255):
                    add(f"{p}.evs.{k}", f"努力值越界（{STAT_KEY_CN.get(k, k)}={v}，应在 0~255）")
        nat = m.get("nature")
        if nat is not None and nat not in natures:
            add(f"{p}.nature", f"未知性格「{nat}」")
        src = m.get("source")
        if src is not None and src not in sources:
            add(f"{p}.source", f"未知来源「{src}」")
        g = m.get("gender")
        if g is not None and g not in GENDER_SYMBOL:
            add(f"{p}.gender", f"未知性别「{g}」")
        mid = m.get("id")
        if not mid:
            add(f"{p}.id", "缺少 ID")
        elif mid in seen_ids:
            add(f"{p}.id", f"ID 重复（{mid}）")
        else:
            seen_ids.add(mid)
        if m.get("kind") == "egg":
            egg_ids.add(mid)
        ot = m.get("obtainedAt")
        if isinstance(ot, (int, float)) and ot > now + 60 * 60 * 1000:
            add(f"{p}.obtainedAt", f"获得时间在未来（{fmt_time(ot)}）")
        if "inRoster" in m and not isinstance(m.get("inRoster"), bool):
            add(f"{p}.inRoster", f"inRoster 不是布尔（{m.get('inRoster')!r}）")

    team = data.get("team")
    if team is not None:
        if not isinstance(team, list):
            add("team", "team 不是数组")
        elif len(team) > 6:
            add("team", f"队伍超过 6 只（{len(team)}）")
        else:
            for i, tid in enumerate(team):
                if tid not in seen_ids:
                    add(f"team.{i}", f"队伍引用了仓库中不存在的宝可梦 ID「{tid}」")

    training = data.get("training")
    if training is not None:
        slots = training.get("slots") if isinstance(training, dict) else None
        if slots is None:
            add("training", "training 缺少 slots 数组")
        elif not isinstance(slots, list):
            add("training.slots", "training.slots 不是数组")
        else:
            for i, s in enumerate(slots):
                p = f"training.slots.{i}"
                if s is None:
                    continue
                if not isinstance(s, dict):
                    add(p, f"训练槽 {i + 1} 不是对象（{s!r}）")
                    continue
                tid = s.get("id")
                if tid not in seen_ids:
                    add(f"{p}.id", f"训练槽引用了仓库中不存在的宝可梦 ID「{tid}」")
                sat = s.get("satiety")
                if isinstance(sat, (int, float)) and not (0 <= sat <= 100):
                    add(f"{p}.satiety", f"饱食度越界（{sat}，应在 0~100）")
                st = s.get("startAt")
                if isinstance(st, (int, float)) and st > now + 60 * 60 * 1000:
                    add(f"{p}.startAt", f"训练开始时间在未来（{fmt_time(st)}）")

    # --- 饲育屋（M2） ---
    nursery = data.get("nursery")
    if nursery is not None:
        if not isinstance(nursery, dict):
            add("nursery", f"nursery 不是对象（{type(nursery).__name__}）")
        else:
            parents = nursery.get("parents")
            if not isinstance(parents, list) or len(parents) != 2:
                add("nursery.parents", f"饲育屋 parents 应为长度 2 的数组（实际 {len(parents) if isinstance(parents, list) else parents!r}）")
            else:
                for i, pp in enumerate(parents):
                    if pp is None:
                        continue
                    if not isinstance(pp, dict):
                        add(f"nursery.parents.{i}", f"亲本 {i + 1} 不是对象（{pp!r}）")
                        continue
                    pid = pp.get("id")
                    if pid not in seen_ids:
                        add(f"nursery.parents.{i}.id", f"饲育屋引用了仓库中不存在的宝可梦 ID「{pid}」")
                    elif pp.get("id") in egg_ids:
                        add(f"nursery.parents.{i}.id", "蛋条目不应放入饲育屋配对")
                    pt = pp.get("placedAt")
                    if isinstance(pt, (int, float)) and pt > now + 60 * 60 * 1000:
                        add(f"nursery.parents.{i}.placedAt", f"放入时间在未来（{fmt_time(pt)}）")
            li = nursery.get("lockedIv")
            if li is not None:
                if not isinstance(li, dict):
                    add("nursery.lockedIv", f"lockedIv 不是对象（{li!r}）")
                elif li.get("key") not in STAT_KEYS:
                    add("nursery.lockedIv.key", f"锁定维度非法（{li.get('key')}）")
                elif li.get("source") not in ("a", "b"):
                    add("nursery.lockedIv.source", f"锁定来源非法（{li.get('source')}）")
            b = nursery.get("breeding")
            if b is not None:
                if not isinstance(b, dict):
                    add("nursery.breeding", f"breeding 不是对象（{b!r}）")
                else:
                    st = b.get("startedAt")
                    if isinstance(st, (int, float)) and st > now + 60 * 60 * 1000:
                        add("nursery.breeding.startedAt", f"繁殖开始时间在未来（{fmt_time(st)}）")
                    if not isinstance(b.get("durMs"), (int, float)) or b.get("durMs", 0) <= 0:
                        add("nursery.breeding.durMs", f"繁殖时长非法（{b.get('durMs')}）")

    # --- 孵蛋记录（M3） ---
    for i, log in enumerate(data.get("incubatorLogs") or []):
        if not isinstance(log, dict):
            add(f"incubatorLogs.{i}", f"第 {i} 条不是对象（{log!r}）")
            continue
        sid = log.get("species")
        if sid is not None and str(sid) not in valid_idx:
            add(f"incubatorLogs.{i}.species", f"未知宝可梦编号「{sid}」")
        if log.get("gender") not in GENDER_SYMBOL:
            add(f"incubatorLogs.{i}.gender", f"未知性别「{log.get('gender')}」")

    achs = data.get("achievements")
    if achs is not None:
        if not isinstance(achs, dict):
            add("achievements", f"achievements 不是对象（{type(achs).__name__}）")
        else:
            for k, v in achs.items():
                if not isinstance(v, (int, float)) or v < 0:
                    add(f"achievements.{k}", f"成就「{ACHIEVEMENT_CN.get(k, (k, ''))[0]}」档位数非法（{v!r}）")

    logs = data.get("systemLogs")
    if logs is not None and not isinstance(logs, list):
        add("systemLogs", f"systemLogs 不是数组（{type(logs).__name__}）")

    stg = data.get("settings")
    if stg is not None:
        if not isinstance(stg, dict):
            add("settings", f"settings 不是对象（{type(stg).__name__}）")
        else:
            for k, v in stg.items():
                if k in ("autoCatch", "autoFlee", "shinyStop", "legendStop", "autoBuffHoney",
                         "autoBuffCharm", "windowPinned", "musicEnabled", "battleMusic"):
                    if not isinstance(v, bool):
                        add(f"settings.{k}", f"设置「{SETTING_DEFS.get(k, (k, ''))[0]}」不是布尔（{v!r}）")
                elif k == "musicVolume" and isinstance(v, (int, float)) and not (0 <= v <= 1):
                    add(f"settings.{k}", f"音乐音量越界（{v}，应在 0~1）")
                elif k == "windowScale" and v not in (1, 1.5, 2):
                    add(f"settings.{k}", f"窗口倍率非法（{v}）")
                elif k == "gender" and v not in GENDER_CN:
                    add(f"settings.{k}", f"未知主角性别「{v}」")
                elif k == "autoCatchBalls" and isinstance(v, dict):
                    for bk, bv in v.items():
                        if not isinstance(bv, bool):
                            add(f"settings.{k}.{bk}", f"自动捕捉「{BALL_CN.get(bk, bk)}」不是布尔（{bv!r}）")

    for i, s in enumerate(data.get("incubators") or []):
        if not isinstance(s, dict):
            add(f"incubators.{i}", f"第 {i} 个孵蛋器不是对象")
            continue
        ei = s.get("eggIndex")
        if ei is not None and str(ei) not in valid_idx:
            add(f"incubators.{i}.eggIndex", f"蛋指向未知宝可梦编号「{ei}」")
        if "hatched" in s and not isinstance(s.get("hatched"), bool):
            add(f"incubators.{i}.hatched", f"hatched 不是布尔")
        er = s.get("eggRef")
        if er is not None and er not in egg_ids:
            add(f"incubators.{i}.eggRef", f"蛋引用的仓库条目「{er}」不是蛋或已不存在")

    uls = data.get("incubatorUnlockedSlots")
    if uls is not None and (not isinstance(uls, (int, float)) or not (0 <= uls <= 8)):
        add("incubatorUnlockedSlots", f"孵蛋器解锁槽位非法（{uls}，应在 0~8）")

    plots = (data.get("berryFarm") or {}).get("plots") if isinstance(data.get("berryFarm"), dict) else None
    for i, pl in enumerate(plots or []):
        if not isinstance(pl, dict) or not pl:
            continue  # 空地（null / {}）不算问题
        gm, tm = pl.get("grownMs"), pl.get("totalMs")
        if isinstance(gm, (int, float)) and isinstance(tm, (int, float)) and gm > tm:
            add(f"berryFarm.plots.{i}.grownMs", f"成熟进度超过总时长（{gm} > {tm}）")

    for key in ("lastSavedAt", "massNextGenAt"):
        v = data.get(key)
        if isinstance(v, (int, float)) and v > now + 60 * 60 * 1000:
            add(key, f"{TOP_KEY_CN.get(key, key)} 在未来（{fmt_time(v)}）")

    for key, label in (("massOutbreak", "大量出没"), ("gps", "导航")):
        v = data.get(key)
        if isinstance(v, dict) and isinstance(v.get("edge"), (list, tuple)) and len(v["edge"]) != 2:
            add(f"{key}.edge", f"{label} edge 应为 [x, y] 长度 2（实际 {len(v['edge'])}）")

    stats = data.get("stats")
    if isinstance(stats, dict):
        for k, v in stats.items():
            if isinstance(v, (int, float)) and v < 0:
                add(f"stats.{k}", f"统计「{STAT_CN.get(k, (k, ''))[0]}」为负（{v}）")

    if data.get("introDone") is not None and not isinstance(data.get("introDone"), bool):
        add("introDone", f"introDone 不是布尔（{data.get('introDone')!r}）")

    dex = data.get("pokedex")
    if isinstance(dex, dict):
        for k, v in dex.items():
            if str(k) not in valid_idx and not k.isdigit():
                add(f"pokedex.{k}", f"图鉴键「{k}」不是合法编号")
            if isinstance(v, dict):
                for fld in ("seen", "caught"):
                    if isinstance(v.get(fld), (int, float)) and v[fld] < 0:
                        add(f"pokedex.{k}.{fld}", f"图鉴计数为负（{fld}={v[fld]}）")

    return issues


def tab_of_path(path):
    for prefix, tab in TAB_OF_PATH:
        if path.startswith(prefix):
            return tab
    return RAW_TAB  # 兜底：其他/原始数据


# ============ 查看器界面 ============
class SaveViewer:
    def __init__(self, root):
        self.root = root
        root.title("口袋挂机 · 存档查看器（只读）")
        root.geometry("1160x640")
        self.save_path = tk.StringVar(value=DEFAULT_SAVE)
        self.status = tk.StringVar(value="未加载存档")
        self.data = None
        self.issues = []
        self.issue_paths = set()
        self.pokedex = load_pokedex()
        self._build_topbar()
        self._build_tabs()
        self._build_statusbar()

    def _build_topbar(self):
        bar = ttk.Frame(self.root, padding=6)
        bar.pack(fill="x")
        ttk.Label(bar, text="存档文件：").pack(side="left")
        ttk.Entry(bar, textvariable=self.save_path, width=58).pack(side="left", padx=4)
        ttk.Button(bar, text="浏览", command=self.browse).pack(side="left")
        ttk.Button(bar, text="加载", command=self.load_save).pack(side="left", padx=(8, 0))

    def _build_statusbar(self):
        ttk.Label(self.root, textvariable=self.status, relief="sunken", anchor="w", padding=4).pack(fill="x", side="bottom")

    def _make_tree(self, parent, cols):
        t = ttk.Treeview(parent, show="headings", columns=[c[0] for c in cols], height=18)
        for cid, ctext, cw in cols:
            t.heading(cid, text=ctext)
            t.column(cid, width=cw, anchor="w", stretch=False)
        vsb = ttk.Scrollbar(parent, orient="vertical", command=t.yview)
        hsb = ttk.Scrollbar(parent, orient="horizontal", command=t.xview)
        t.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        t.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        parent.rowconfigure(0, weight=1)
        parent.columnconfigure(0, weight=1)
        t.tag_configure("issue", foreground="#c0392b")
        return t

    def _make_raw_tree(self, parent):
        """原始数据页：层级树（任意嵌套深度，列=键/值）"""
        t = ttk.Treeview(parent, show="tree headings", columns=["val"], height=18)
        t.heading("#0", text="键")
        t.column("#0", width=280, anchor="w", stretch=False)
        t.heading("val", text="值")
        t.column("val", width=560, anchor="w", stretch=True)
        vsb = ttk.Scrollbar(parent, orient="vertical", command=t.yview)
        hsb = ttk.Scrollbar(parent, orient="horizontal", command=t.xview)
        t.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        t.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        parent.rowconfigure(0, weight=1)
        parent.columnconfigure(0, weight=1)
        return t

    def _build_tabs(self):
        nb = ttk.Notebook(self.root)
        nb.pack(fill="both", expand=True, padx=6, pady=(2, 6))
        self.nb = nb
        self._tabs = {}
        specs = [
            ("物品", [("name", "物品", 110), ("val", "数量", 80)]),
            ("宝可梦", [("name", "名称", 100), ("num", "编号", 55), ("lv", "等级", 50), ("gender", "性别", 45),
                        ("shiny", "闪光", 45), ("nature", "性格", 60), ("src", "来源", 55),
                        ("inroster", "在仓库", 55), ("ivs", "个体值(HP/攻/防/特攻/特防/速)", 260),
                        ("evs", "努力值", 190), ("id", "ID", 120)]),
            ("队伍", [("idx", "序号", 45), ("name", "名称", 110), ("lv", "等级", 55), ("shiny", "闪光", 45), ("note", "状态", 300)]),
            ("图鉴", [("num", "编号", 60), ("name", "名称", 110), ("seen", "遇见", 70), ("caught", "捕获", 70),
                      ("sseen", "闪光遇见", 80), ("scaught", "闪光捕获", 80)]),
            ("孵蛋器", [("slot", "槽位", 55), ("num", "蛋编号", 70), ("name", "蛋名称", 110),
                        ("type", "类型", 75), ("done", "已孵化", 60), ("shiny", "闪光", 45)]),
            ("孵蛋记录", [("time", "孵化时间", 150), ("name", "宝可梦", 120), ("gender", "性别", 55), ("shiny", "闪光", 45)]),
            ("饲育屋", [("item", "项目", 100), ("val", "值", 300), ("desc", "说明", 260)]),
            ("农场", [("plot", "地块", 55), ("berry", "种植树果", 110), ("progress", "进度", 180)]),
            ("训练", [("slot", "槽位", 55), ("name", "宝可梦", 110), ("lv", "等级", 50), ("exp", "经验", 90),
                      ("satiety", "饱食度", 60), ("lazy", "偷懒中", 200), ("start", "训练开始", 150)]),
            ("活动", [("item", "项目", 170), ("val", "值", 400), ("desc", "说明", 260)]),
            ("统计", [("key", "指标", 160), ("val", "数值", 110), ("desc", "说明", 320)]),
            ("成就", [("id", "ID", 100), ("name", "成就", 120), ("claimed", "已领取档位", 90), ("desc", "说明", 240)]),
            ("日志", [("time", "时间", 150), ("type", "类型", 100), ("detail", "详情", 480)]),
            ("设置", [("key", "设置项", 150), ("val", "当前值", 140), ("desc", "说明", 260)]),
            ("原始数据", None),
            ("数据问题", [("where", "位置", 260), ("msg", "问题描述", 620)]),
        ]
        for i, (title, cols) in enumerate(specs):
            frm = ttk.Frame(nb)
            nb.add(frm, text=title)
            if i == RAW_TAB:
                btnbar = ttk.Frame(frm)
                btnbar.grid(row=0, column=0, sticky="w")
                ttk.Button(btnbar, text="全部展开", command=self._expand_raw_all).pack(side="left")
                ttk.Button(btnbar, text="全部收起", command=self._collapse_raw_all).pack(side="left", padx=4)
                body = ttk.Frame(frm)
                body.grid(row=1, column=0, sticky="nsew")
                frm.rowconfigure(1, weight=1)
                frm.columnconfigure(0, weight=1)
                self._tabs[i] = self._make_raw_tree(body)
            else:
                self._tabs[i] = self._make_tree(frm, cols)

    # ---------- 加载 ----------
    def browse(self):
        p = filedialog.askopenfilename(title="选择存档 save.json", filetypes=[("存档", "*.json")])
        if p:
            self.save_path.set(p)

    def load_save(self):
        path = self.save_path.get().strip()
        if not os.path.isfile(path):
            self.status.set(f"存档文件不存在：{path}")
            return
        try:
            with open(path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
        except Exception as e:
            self.status.set(f"解析存档失败：{e}")
            return
        self.issues = run_checks(self.data, self.pokedex)
        self.issue_paths = {p for p, _ in self.issues}
        self._render_all()
        n = len(self.data.get("roster") or [])
        self.status.set(f"已加载：{path} · 宝可梦 {n} 只 · 问题 {len(self.issues)} 条（红色行/「数据问题」页）")

    def _has_issue(self, path):
        return path in self.issue_paths

    def _render_all(self):
        self._render_items()
        self._render_roster()
        self._render_team()
        self._render_dex()
        self._render_incubators()
        self._render_incubator_logs()
        self._render_nursery()
        self._render_farm()
        self._render_training()
        self._render_activity()
        self._render_stats()
        self._render_achievements()
        self._render_logs()
        self._render_settings()
        self._render_raw()
        self._render_issues()

    # ---------- 各页渲染 ----------
    def _render_items(self):
        t = self._tabs[0]
        t.delete(*t.get_children())
        items = self.data.get("items") or {}
        for key, cn in ITEM_CN.items():
            v = items.get(key, 0)
            path = f"items.{key}"
            tags = ("issue",) if self._has_issue(path) else ()
            t.insert("", "end", values=(cn, v), tags=tags)

    def _render_roster(self):
        t = self._tabs[1]
        t.delete(*t.get_children())
        for i, m in enumerate(self.data.get("roster") or []):
            if not isinstance(m, dict):
                t.insert("", "end", values=("?", "", "", "", "", "", "", "", "", "", ""),
                         tags=("issue",))
                continue
            sid = str(m.get("species", ""))
            name = self.pokedex.get(sid, f"?{sid}")
            if m.get("kind") == "egg":
                name = f"{name}（蛋）"
            tags = ("issue",) if self._has_issue(f"roster.{i}") or self._has_issue(f"roster.{i}.species") else ()
            ivs = m.get("ivs") or {}
            evs = m.get("evs") or {}
            iv_str = " ".join(str(ivs.get(k, 0)) for k in STAT_KEYS)
            ev_str = " ".join(str(evs.get(k, 0)) for k in STAT_KEYS)
            gender = GENDER_SYMBOL.get(m.get("gender"), m.get("gender", "?"))
            t.insert("", "end", values=(
                name, sid, m.get("level", "?"), gender, fmt_bool(m.get("shiny", False)),
                NATURE_CN.get(m.get("nature"), m.get("nature", "?")),
                SRC_CN.get(m.get("source"), m.get("source", "?")),
                fmt_bool(m.get("inRoster", True)), iv_str, ev_str, m.get("id", "")), tags=tags)

    def _render_team(self):
        t = self._tabs[2]
        t.delete(*t.get_children())
        roster = {r.get("id"): r for r in (self.data.get("roster") or []) if isinstance(r, dict)}
        for i, tid in enumerate(self.data.get("team") or []):
            r = roster.get(tid)
            tags = ("issue",) if self._has_issue(f"team.{i}") else ()
            if r is None:
                t.insert("", "end", values=(i + 1, "?", "-", "-", f"无效引用：ID「{tid}」不在仓库中"), tags=("issue",))
            else:
                sid = str(r.get("species", ""))
                name = self.pokedex.get(sid, f"?{sid}")
                note = "已放生" if r.get("inRoster") is False else "正常"
                if r.get("inRoster") is False:
                    tags = ("issue",)
                t.insert("", "end", values=(i + 1, name, r.get("level", "?"),
                                            fmt_bool(r.get("shiny", False)), note), tags=tags)

    def _render_dex(self):
        t = self._tabs[3]
        t.delete(*t.get_children())
        dex = self.data.get("pokedex") or {}
        for num, info in dex.items():
            if not isinstance(info, dict):
                tags = ("issue",) if self._has_issue(f"pokedex.{num}") else ()
                t.insert("", "end", values=(num, "?", "-", "-", "-", "-"), tags=tags)
                continue
            tags = ("issue",) if self._has_issue(f"pokedex.{num}") or self._has_issue(f"pokedex.{num}.seen") or self._has_issue(f"pokedex.{num}.caught") else ()
            t.insert("", "end", values=(num, self.pokedex.get(str(num), "?"),
                                        info.get("seen", 0), info.get("caught", 0),
                                        info.get("shinySeen", 0), info.get("shinyCaught", 0)), tags=tags)

    def _render_incubators(self):
        t = self._tabs[4]
        t.delete(*t.get_children())
        for i, s in enumerate(self.data.get("incubators") or []):
            path = f"incubators.{i}"
            tags = ("issue",) if self._has_issue(path) or self._has_issue(f"{path}.eggIndex") \
                or self._has_issue(f"{path}.hatched") or self._has_issue(f"{path}.eggRef") else ()
            if not isinstance(s, dict):
                t.insert("", "end", values=(i + 1, "?", "?", "?", "?", "?"), tags=("issue",))
                continue
            ei = s.get("eggIndex")
            if ei is None:
                t.insert("", "end", values=(i + 1, "-", "（空槽位）", "-", "-", "-"))
                continue
            name = self.pokedex.get(str(ei), f"?{ei}")
            etype = "宝可梦蛋" if s.get("eggRef") else "神秘蛋"
            t.insert("", "end", values=(i + 1, ei, name, etype,
                                        fmt_bool(s.get("hatched", False)),
                                        fmt_bool(s.get("isShiny", False))), tags=tags)

    def _render_incubator_logs(self):
        t = self._tabs[5]
        t.delete(*t.get_children())
        logs = self.data.get("incubatorLogs") or []
        if not isinstance(logs, list):
            t.insert("", "end", values=("?", "?", "?", "?"), tags=("issue",))
            return
        for log in reversed(logs):
            tags = ("issue",) if not isinstance(log, dict) else ()
            if not isinstance(log, dict):
                t.insert("", "end", values=("?", "?", "?", "?"), tags=("issue",))
                continue
            sid = log.get("species")
            name = self.pokedex.get(str(sid), f"?{sid}") if sid is not None else "?"
            t.insert("", "end", values=(fmt_time(log.get("time")), name,
                                        GENDER_SYMBOL.get(log.get("gender"), log.get("gender", "?")),
                                        fmt_bool(log.get("shiny", False))), tags=tags)

    def _render_nursery(self):
        t = self._tabs[6]
        t.delete(*t.get_children())
        n = self.data.get("nursery")
        if not isinstance(n, dict):
            t.insert("", "end", values=("饲育屋", "数据缺失/非对象", ""), tags=("issue",))
            return
        roster = {r.get("id"): r for r in (self.data.get("roster") or []) if isinstance(r, dict)}
        now = datetime.datetime.now().timestamp() * 1000
        parents = n.get("parents") if isinstance(n.get("parents"), list) else []
        for i in range(2):
            path = f"nursery.parents.{i}"
            tags = ("issue",) if self._has_issue(path) or self._has_issue(f"{path}.id") else ()
            pp = parents[i] if i < len(parents) else None
            if not isinstance(pp, dict) or not pp.get("id"):
                t.insert("", "end", values=(f"亲本{i + 1}", "（空槽位）", ""), tags=tags)
                continue
            entry = roster.get(pp.get("id"))
            if entry is None:
                t.insert("", "end", values=(f"亲本{i + 1}", f"无效引用 ID「{pp.get('id')}」",
                                            "仓库中不存在该宝可梦"), tags=("issue",))
                continue
            sid = str(entry.get("species", ""))
            name = self.pokedex.get(sid, f"?{sid}")
            gender = GENDER_SYMBOL.get(entry.get("gender"), "?")
            desc = f"放入时间：{fmt_time(pp.get('placedAt'))}"
            t.insert("", "end", values=(f"亲本{i + 1}", f"{name} · {gender} · Lv{entry.get('level', '?')}",
                                        desc), tags=tags)
        # 锁定遗传
        li = n.get("lockedIv")
        if not isinstance(li, dict) or not li.get("key"):
            t.insert("", "end", values=("锁定遗传", "未锁定", "随机遗传（除锁定维外五维 50% 二选一）"))
        else:
            stat = STAT_KEY_CN.get(li.get("key"), li.get("key"))
            src = "亲本1" if li.get("source") == "a" else "亲本2" if li.get("source") == "b" else "?"
            t.insert("", "end", values=("锁定遗传", f"{stat} ← {src}",
                                        "该维个体值固定继承指定亲本"))
        # 繁殖状态
        b = n.get("breeding")
        if not isinstance(b, dict):
            t.insert("", "end", values=("繁殖状态", "未繁殖", "放入两只可配对宝可梦开始繁殖"))
        else:
            st, dur = b.get("startedAt"), b.get("durMs")
            remain = (st + dur - now) if isinstance(st, (int, float)) and isinstance(dur, (int, float)) else None
            if remain is not None and remain <= 0:
                t.insert("", "end", values=("繁殖状态", "已产蛋，待收取", f"开始于 {fmt_time(st)}"))
            else:
                t.insert("", "end", values=("繁殖状态", f"繁殖中 · 剩余 {fmt_ms_remain(remain)}",
                                            f"开始于 {fmt_time(st)}，共 {fmt_ms_remain(dur)}"))

    def _render_farm(self):
        t = self._tabs[7]
        t.delete(*t.get_children())
        farm = self.data.get("berryFarm") or {}
        for i, pl in enumerate(farm.get("plots") or []):
            path = f"berryFarm.plots.{i}"
            tags = ("issue",) if self._has_issue(f"{path}.grownMs") else ()
            if not isinstance(pl, dict) or not pl:
                t.insert("", "end", values=(i + 1, "（空地）", "-"))
            else:
                typ = pl.get("type")
                berry = BERRY_NAMES[typ] if isinstance(typ, int) and 0 <= typ < len(BERRY_NAMES) else f"未知({typ})"
                gm, tm = pl.get("grownMs"), pl.get("totalMs")
                progress = f"{gm}/{tm}" if isinstance(gm, (int, float)) and isinstance(tm, (int, float)) else "?"
                t.insert("", "end", values=(i + 1, berry, progress), tags=tags)

    def _render_training(self):
        t = self._tabs[8]
        t.delete(*t.get_children())
        roster = {r.get("id"): r for r in (self.data.get("roster") or []) if isinstance(r, dict)}
        training = self.data.get("training") or {}
        slots = training.get("slots") if isinstance(training, dict) else []
        now = datetime.datetime.now().timestamp() * 1000
        if not slots:
            t.insert("", "end", values=(1, "（无训练中的宝可梦）", "-", "-", "-", "-", "-"))
        for i, s in enumerate(slots):
            path = f"training.slots.{i}"
            tags = ("issue",) if any(self._has_issue(f"{path}.{f}") for f in ("id", "satiety", "startAt")) or self._has_issue(path) else ()
            if not isinstance(s, dict):
                t.insert("", "end", values=(i + 1, "（空槽位）", "-", "-", "-", "-", "-"), tags=tags)
                continue
            entry = roster.get(s.get("id"))
            if entry is None:
                t.insert("", "end", values=(i + 1, f"无效引用 ID「{s.get('id')}」", "-", "-", "-", "-", "-"), tags=("issue",))
                continue
            sid = str(entry.get("species", ""))
            name = self.pokedex.get(sid, f"?{sid}")
            lv = entry.get("level", "?")
            exp = entry.get("exp", 0)
            if isinstance(exp, (int, float)):
                exp = round(exp)
            sat = s.get("satiety")
            sat_str = str(round(sat)) if isinstance(sat, (int, float)) else "?"
            lazy = bool(s.get("lazyUntil")) and now < s["lazyUntil"]
            lazy_str = "是" if lazy else "否"
            if lazy:
                lazy_str += f"（至 {fmt_time(s['lazyUntil'])}）"
            t.insert("", "end", values=(i + 1, name, lv, exp, sat_str, lazy_str, fmt_time(s.get("startAt"))), tags=tags)

    def _render_activity(self):
        t = self._tabs[9]
        t.delete(*t.get_children())
        d = self.data
        rows = []
        bn = d.get("battleNpcs")
        if isinstance(bn, dict):
            rows.append(("NPC对战", f"{len(bn.get('list') or [])} 个 · 刷新时间 {fmt_time(bn.get('refreshedAt'))}",
                         "刷新时间到点后重新生成一波"))
        rows.append(("大量出没", self._brief(d.get("massOutbreak")), "当前大量出没的宝可梦"))
        rows.append(("导航位置", self._brief(d.get("gps")), "当前坐标/目标点"))
        rows.append(("悬赏", self._brief(d.get("bounty")), "今日树果/宝可梦悬赏"))
        rows.append(("交换广场", self._brief(d.get("trades")), "待处理的交换请求"))
        rows.append(("孵蛋器槽位", f"{d.get('incubatorUnlockedSlots', 0)}/8", "已解锁的孵蛋器数量"))
        rows.append(("下次大量出没", fmt_time(d.get("massNextGenAt")), "下一次生成大量出没的时间"))
        rows.append(("最后保存时间", fmt_time(d.get("lastSavedAt")), "存档最近写入时间"))
        for key, val, desc in rows:
            path = key
            tags = ("issue",) if self._has_issue(path) or self._has_issue(path + ".edge") else ()
            t.insert("", "end", values=(key, val, desc), tags=tags)

    def _render_stats(self):
        t = self._tabs[10]
        t.delete(*t.get_children())
        stats = self.data.get("stats") or {}
        if not isinstance(stats, dict):
            t.insert("", "end", values=("?", str(stats), ""), tags=("issue",))
            return
        for k, v in stats.items():
            cn, desc = STAT_CN.get(k, (k, ""))
            if k == "totalItemsEarned" and isinstance(v, dict):
                # 道具获得：字典按道具展开为多行
                for ik, iv in v.items():
                    tags = ("issue",) if self._has_issue(f"stats.{k}") else ()
                    t.insert("", "end", values=(f"{cn} · {ITEM_CN.get(ik, ik)}", iv, "累计获得该道具数量"), tags=tags)
                continue
            if k == "lastSaveTime" and isinstance(v, (int, float)):
                val = fmt_time(v)
            elif k in ("totalPlaySeconds", "playSecondsToday") and isinstance(v, (int, float)):
                val = v
                desc = f"约 {int(v // 3600)} 小时 {int((v % 3600) // 60)} 分"
            else:
                val = v
            tags = ("issue",) if self._has_issue(f"stats.{k}") else ()
            t.insert("", "end", values=(cn, val, desc), tags=tags)

    def _render_achievements(self):
        t = self._tabs[11]
        t.delete(*t.get_children())
        achs = self.data.get("achievements") or {}
        if not isinstance(achs, dict):
            t.insert("", "end", values=("?", str(achs), "-", ""), tags=("issue",))
            return
        for aid, claimed in achs.items():
            name, desc = ACHIEVEMENT_CN.get(aid, (aid, ""))
            tags = ("issue",) if self._has_issue(f"achievements.{aid}") else ()
            t.insert("", "end", values=(aid, name, claimed, desc), tags=tags)

    def _render_logs(self):
        t = self._tabs[12]
        t.delete(*t.get_children())
        logs = self.data.get("systemLogs") or []
        if not isinstance(logs, list):
            t.insert("", "end", values=("?", str(logs), ""), tags=("issue",))
            return
        for i, log in enumerate(reversed(logs)):
            tags = ("issue",) if self._has_issue(f"systemLogs.{i}") else ()
            if not isinstance(log, dict):
                t.insert("", "end", values=("?", "?", repr(log)), tags=("issue",))
                continue
            details = log.get("details")
            if isinstance(details, dict):
                d = dict(details)
                # 日志只存宝可梦编号：转成中文名更直观
                if "pokemon" in d and d["pokemon"] is not None:
                    d["pokemon"] = self.pokedex.get(str(d["pokemon"]), d["pokemon"])
                detail_str = json.dumps(d, ensure_ascii=False)
            else:
                detail_str = str(details)
            t.insert("", "end", values=(fmt_time(log.get("time")),
                                        LOG_TYPE_CN.get(log.get("type"), str(log.get("type", "未知"))),
                                        detail_str), tags=tags)

    def _fmt_setting(self, key, v):
        if key == "gender":
            return GENDER_CN.get(v, v)
        if key == "windowScale":
            return f"×{v}" if v in (1, 1.5, 2) else v
        if isinstance(v, bool):
            return fmt_bool(v)
        if isinstance(v, (int, float)):
            return str(v)
        return str(v)

    def _render_settings(self):
        t = self._tabs[13]
        t.delete(*t.get_children())
        stg = self.data.get("settings") or {}
        if not isinstance(stg, dict):
            t.insert("", "end", values=("?", str(stg), ""), tags=("issue",))
            return
        for key, (label, note) in SETTING_DEFS.items():
            if key not in stg:
                continue
            v = stg[key]
            if key == "autoCatchBalls" and isinstance(v, dict):
                for bk, bv in v.items():
                    tags = ("issue",) if self._has_issue(f"settings.{key}.{bk}") else ()
                    t.insert("", "end", values=(f"{label} · {BALL_CN.get(bk, bk)}",
                                                self._fmt_setting(key, bv), note), tags=tags)
            else:
                tags = ("issue",) if self._has_issue(f"settings.{key}") else ()
                t.insert("", "end", values=(label, self._fmt_setting(key, v), note), tags=tags)

    # ---------- 原始数据页（递归展开任意嵌套深度） ----------
    def _key_cn(self, key):
        """键名中文化：对象键 → 中文名，找不到原样返回"""
        return (TOP_KEY_CN.get(key) or STAT_KEY_CN.get(key) or ITEM_CN.get(key)
                or NATURE_CN.get(key) or BALL_CN.get(key) or str(key))

    def _raw_val(self, key, v):
        """叶子值格式化：布尔→是/否；毫秒时间戳→附带可读时间"""
        if isinstance(v, bool):
            return fmt_bool(v)
        if v is None:
            return "null"
        if isinstance(v, (int, float)):
            if isinstance(v, float):
                v = round(v, 4)
            if abs(v) > 1e12:  # 毫秒时间戳
                return f"{v}（{fmt_time(v)}）"
            return str(v)
        return str(v)

    def _raw_insert(self, t, parent, key, val):
        """递归插入一层：dict/list 建父节点，标量作为叶子"""
        label = self._key_cn(key)
        if isinstance(val, dict):
            node = t.insert(parent, "end", text=label, values=(f"对象（{len(val)} 键）",), open=False)
            for k2, v2 in val.items():
                self._raw_insert(t, node, k2, v2)
        elif isinstance(val, list):
            node = t.insert(parent, "end", text=label, values=(f"数组（{len(val)} 项）",), open=False)
            for i, v2 in enumerate(val):
                self._raw_insert(t, node, f"[{i}]", v2)
        else:
            t.insert(parent, "end", text=label, values=(self._raw_val(key, val),))

    def _render_raw(self):
        t = self._tabs[RAW_TAB]
        t.delete(*t.get_children())
        if not isinstance(self.data, dict):
            t.insert("", "end", text="存档", values=("不是对象",))
            return
        for k, v in self.data.items():
            self._raw_insert(t, "", k, v)

    def _set_raw_open_all(self, open_flag):
        t = self._tabs[RAW_TAB]

        def walk(parent):
            for iid in t.get_children(parent):
                t.item(iid, open=open_flag)
                walk(iid)
        walk("")

    def _expand_raw_all(self):
        self._set_raw_open_all(True)

    def _collapse_raw_all(self):
        self._set_raw_open_all(False)

    def _render_issues(self):
        t = self._tabs[ISSUE_TAB]
        t.delete(*t.get_children())
        for p, msg in self.issues:
            t.insert("", "end", values=(p, msg), tags=("issue",))
        # 双击数据问题 → 跳到对应标签页
        self.nb.bind("<Double-Button-1>", self._on_issue_dbl, add="+")

    def _on_issue_dbl(self, e):
        if self.nb.index(self.nb.select()) != ISSUE_TAB:
            return  # 只在「数据问题」页内双击才跳转
        t = self._tabs[ISSUE_TAB]
        rid = t.identify_row(e.y)
        if not rid:
            return
        iid = t.index(rid)
        if iid < len(self.issues):
            self.nb.select(tab_of_path(self.issues[iid][0]))

    # ---------- 通用格式化 ----------
    def _brief(self, v):
        if isinstance(v, dict):
            return f"对象 {{ {len(v)} 个键 }}"
        if isinstance(v, list):
            return f"数组 [{len(v)} 项]"
        if isinstance(v, bool):
            return fmt_bool(v)
        if isinstance(v, (int, float)):
            return str(v)
        return str(v)


def main():
    root = tk.Tk()
    SaveViewer(root)
    root.mainloop()


if __name__ == "__main__":
    main()