#!/usr/bin/env python3
# 在 AstrBot 服务器上运行：把打包好的 bot/knowledge 镜像进「口袋挂机」知识库。
# 走 AstrBot 自己的上传/删除 API，由它完成分块、embedding、FAISS 与 kb.db 元数据更新；
# 不要手改 knowledge_base/kb.db、doc.db 或 index.faiss，否则索引会和元数据对不上。
import argparse
import json
import os
import sys
import tarfile
import tempfile
import time
from collections import defaultdict

import requests

BASE = "http://127.0.0.1:6185"
CONFIG = "/www/wwwroot/data/cmd_config.json"
DEFAULT_KB = "口袋挂机"
BATCH = 4  # 每次上传的文件数（接口上限 10，大文件拆小批更稳）


def api(method, path, token=None, **kwargs):
    headers = kwargs.pop("headers", {})
    if token:
        headers["Authorization"] = "Bearer " + token
    r = requests.request(method, BASE + path, headers=headers, timeout=120, **kwargs)
    return r.json()


def login(session):
    cfg = json.load(open(CONFIG, encoding="utf-8-sig"))
    data = api(
        "POST",
        "/api/auth/login",
        json={
            "username": cfg["dashboard"]["username"],
            "password": cfg["dashboard"]["password"],
        },
    )
    if data.get("status") != "ok":
        raise RuntimeError("登录失败: " + str(data))
    return data["data"]["token"]


def find_kb(session, token, name):
    data = api("GET", "/api/kb/list", token)
    items = data.get("data", {}).get("items") or []
    for kb in items:
        if kb.get("kb_name") == name:
            return kb
    raise RuntimeError(f"找不到知识库「{name}」，现有: " + ", ".join(k.get("kb_name", "") for k in items))


def list_docs(session, token, kb_id):
    items = []
    page = 1
    while True:
        data = api(
            "GET",
            "/api/kb/document/list",
            token,
            params={"kb_id": kb_id, "page": page, "page_size": 100},
        )
        batch = data.get("data", {}).get("items") or []
        items.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return items


def delete_doc(session, token, kb_id, doc_id):
    data = api("POST", "/api/kb/document/delete", token, json={"kb_id": kb_id, "doc_id": doc_id})
    if data.get("status") != "ok":
        raise RuntimeError(str(data))


def upload_batch(session, token, kb_id, files, chunk_size, chunk_overlap):
    handles = []
    form = {}
    try:
        for i, (name, path) in enumerate(files):
            f = open(path, "rb")
            handles.append(f)
            form[f"file{i}"] = (name, f, "application/octet-stream")
        data = api(
            "POST",
            "/api/kb/document/upload",
            token,
            data={
                "kb_id": kb_id,
                "chunk_size": str(chunk_size),
                "chunk_overlap": str(chunk_overlap),
                "batch_size": "32",
                "tasks_limit": "3",
                "max_retries": "3",
            },
            files=form,
        )
    finally:
        for f in handles:
            f.close()
    if data.get("status") != "ok":
        raise RuntimeError(str(data))
    task_id = data["data"]["task_id"]
    for _ in range(600):
        time.sleep(2)
        p = api("GET", "/api/kb/document/upload/progress", token, params={"task_id": task_id})
        task = p.get("data") or {}
        if task.get("status") in ("completed", "failed"):
            return task
    return {"status": "timeout", "task_id": task_id}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tar", required=True, help="本地 bot/knowledge 打包的 tar.gz")
    ap.add_argument("--apply", action="store_true", help="真正执行上传/删除；默认只对比")
    ap.add_argument("--prune", action="store_true", help="删除本地已不存在的远端文档")
    ap.add_argument("--kb", default=DEFAULT_KB)
    args = ap.parse_args()

    work = tempfile.mkdtemp(prefix="pokeidle-kb-")
    with tarfile.open(args.tar, "r:gz") as tf:
        tf.extractall(work)
    root = os.path.join(work, "knowledge")

    local = {}
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if fn.lower().endswith(".md"):
                p = os.path.join(dp, fn)
                local[fn] = (p, os.path.getsize(p))

    session = requests.Session()
    token = login(session)
    kb = find_kb(session, token, args.kb)
    kb_id = kb["kb_id"]
    chunk_size = int(kb.get("chunk_size") or 1024)
    chunk_overlap = int(kb.get("chunk_overlap") or 180)
    if chunk_overlap >= chunk_size:
        chunk_overlap = max(0, min(chunk_size // 4, 180))

    remote = list_docs(session, token, kb_id)
    groups = defaultdict(list)
    for d in remote:
        groups[d["doc_name"]].append(d)

    missing = sorted(n for n in local if n not in groups)
    changed = []
    dup_keep = []  # (name, keep_id, delete_ids)
    to_upload = set(missing)
    for name, docs in sorted(groups.items()):
        if name not in local:
            continue
        size = local[name][1]
        if len(docs) > 1:
            keep = [d for d in docs if d.get("file_size") == size]
            if len(keep) == 1:
                dup_keep.append((name, keep[0]["doc_id"], [d["doc_id"] for d in docs if d["doc_id"] != keep[0]["doc_id"]]))
            else:
                changed.append(name)
                to_upload.add(name)
        elif docs[0].get("file_size") != size:
            changed.append(name)
            to_upload.add(name)
    extras = sorted(n for n in groups if n not in local)

    print(f"知识库: {kb.get('kb_name')} ({kb_id})  分块 {chunk_size}/{chunk_overlap}")
    print(f"本地 {len(local)} 篇，远端 {len(remote)} 个文档 / {len(groups)} 个文件名")
    print()
    print("缺失:", ", ".join(missing) or "无")
    print("内容变化:", ", ".join(changed) or "无")
    print("重复名称:", ", ".join(f"{n}(留1删{len(ids)})" for n, _, ids in dup_keep) or "无")
    print("远端多余:", ", ".join(extras) or "无")

    if not args.apply:
        print("\n[对比模式] 未做任何修改；加 --apply 执行上传/去重，--prune 同时删除远端多余文档。")
        return

    # 删除：重复项的多余副本 / 变化文档的全部旧副本 / 远端多余
    delete_ids = []
    for _, _, ids in dup_keep:
        delete_ids.extend(ids)
    for name in changed:
        delete_ids.extend(d["doc_id"] for d in groups.get(name, []))
    if args.prune:
        for name in extras:
            delete_ids.extend(d["doc_id"] for d in groups[name])
    for i, doc_id in enumerate(delete_ids, 1):
        delete_doc(session, token, kb_id, doc_id)
    print(f"\n已删除 {len(delete_ids)} 个旧文档")

    uploads = [(n, local[n][0]) for n in sorted(to_upload)]
    ok = fail = 0
    for start in range(0, len(uploads), BATCH):
        batch = uploads[start:start + BATCH]
        print(f"上传 {start + 1}-{start + len(batch)}/{len(uploads)}: " + ", ".join(n for n, _ in batch))
        try:
            task = upload_batch(session, token, kb_id, batch, chunk_size, chunk_overlap)
        except Exception as e:
            print("  失败:", e)
            fail += len(batch)
            continue
        result = task.get("result") or {}
        uploaded = result.get("uploaded") or []
        failed = result.get("failed") or []
        ok += len(uploaded)
        fail += len(failed)
        for f in failed:
            print("  失败:", f.get("file_name"), f.get("error"))
    print(f"\n完成: 成功 {ok} 篇，失败 {fail} 篇")
    final = list_docs(session, token, kb_id)
    print(f"现在远端 {len(final)} 个文档")


if __name__ == "__main__":
    sys.exit(main())
