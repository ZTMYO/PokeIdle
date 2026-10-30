// ===== 搅拌（霜奶仙进化前的一步）=====
// 方向 + 净圈数决定口味，净转 3 圈解锁「完成」。
// 顺时针 <5/5~7/≥7 圈：奶香香草 / 奶香抹茶 / 奶香薄荷；逆时针同档位：奶香红钻 / 奶香雪盐 / 奶香柠檬。
// 来回搅（两边都过 0.6 圈）：焦糖综合 / 红钻综合 / 三色综合。
// 碗里的奶白奶油按口味叠螺纹；糖饰不在这块屏出现，进化演出里才投掷。
import { $, showView, viewportToLogic } from './ui.js';

const NEED_TURNS = 3;     // 解锁「完成」的净圈数
const SHORT_TURNS = 5;    // 口味档位：< 5 圈
const LONG_TURNS = 7;     // 口味档位：≥ 7 圈
const MIX_TURNS = 0.6;    // 反方向要搅过这么多圈，才算「来回搅」
const TURN_MIN = 0.1;     // 离碗心太近（<10% 半径）时不算角度，避免指针穿过圆心时角度乱跳
// 糖饰色：按 items/evo/sweets 那套图标的主色取，别凭感觉写
const COLORS = {
  草莓糖饰: '#f84040', 爱心糖饰: '#f88888', 野莓糖饰: '#0068b0',
  幸运草糖饰: '#98c058', 花朵糖饰: '#e87028', 星星糖饰: '#f8e800', 蝴蝶结糖饰: '#a880b0',
};
// 螺纹配色：综合口味两到三色渐变
const SWIRL = {
  奶香香草: ['#e8d9b0'],
  奶香红钻: ['#f26d9b'],
  奶香抹茶: ['#8fbf6a'],
  奶香雪盐: ['#9fc7e8'],
  奶香薄荷: ['#7fd6bd'],
  奶香柠檬: ['#f2d75c'],
  焦糖综合: ['#c98a4b', '#e0a86a'],
  红钻综合: ['#f26d9b', '#ffb3cf'],
  三色综合: ['#f4707f', '#f2d75c', '#74c46a'],
};

// 方向 + 圈数 → 口味
function flavorOf(cw, ccw) {
  const cwT = cw / 360;
  const ccwT = ccw / 360;
  const tier = Math.max(cwT, ccwT);
  if (Math.min(cwT, ccwT) >= MIX_TURNS) {
    if (tier < SHORT_TURNS) return '焦糖综合';
    if (tier < LONG_TURNS) return '红钻综合';
    return '三色综合';
  }
  const cwDir = cwT >= ccwT;
  if (tier < SHORT_TURNS) return cwDir ? '奶香香草' : '奶香红钻';
  if (tier < LONG_TURNS) return cwDir ? '奶香抹茶' : '奶香雪盐';
  return cwDir ? '奶香薄荷' : '奶香柠檬';
}

// 阿基米德螺线（viewBox -50..50）
const SPIRAL = (() => {
  const turns = 3.1, r0 = 3.5, r1 = 43, step = 0.14;
  const tmax = turns * Math.PI * 2;
  let d = '';
  for (let t = 0; t <= tmax + 1e-6; t += step) {
    const r = r0 + (r1 - r0) * (t / tmax);
    d += `${d ? 'L' : 'M'}${(r * Math.cos(t)).toFixed(2)} ${(r * Math.sin(t)).toFixed(2)}`;
  }
  return d;
})();

// 螺纹上色：粗色带 + 中间奶白高光，多色口味铺渐变
function setSwirl(flavor) {
  const svg = $('stirSwirl');
  if (!svg) return;
  const cs = SWIRL[flavor] || SWIRL.奶香香草;
  const stops = cs
    .map((c, i) => `<stop offset="${((i / Math.max(1, cs.length - 1)) * 100).toFixed(0)}%" stop-color="${c}"/>`)
    .join('');
  svg.innerHTML =
    `<defs><linearGradient id="stirGrad" gradientUnits="userSpaceOnUse" x1="-43" y1="-43" x2="43" y2="43">${stops}</linearGradient></defs>` +
    `<path d="${SPIRAL}" fill="none" stroke="url(#stirGrad)" stroke-width="8.5" stroke-linecap="round" opacity="0.92"/>` +
    `<path d="${SPIRAL}" fill="none" stroke="#fffdf6" stroke-width="2.2" stroke-linecap="round" opacity="0.75"/>`;
}

let st = null;            // { cw, ccw, last, dragging, locked, ended, onDone }
let _onResize = null;
let _endDrag = null;      // 当前拖拽的收尾函数（重进界面时先解绑）

const norm = (d) => { while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

function isStirShowActive() {
  return $('stirView')?.style.display === 'flex';
}

// 碗按 board 的可用空间取正方形
function fitBowl() {
  const board = $('stirBoard');
  const bowl = $('stirBowl');
  if (!board || !bowl) return 0;
  const size = Math.max(120, Math.floor(Math.min(board.clientWidth, board.clientHeight) * 0.94));
  bowl.style.width = `${size}px`;
  bowl.style.height = `${size}px`;
  return size;
}

// 打蛋器跟手：蛋头贴指针，拖出碗外就夹在碗沿
function setWhisk(dx, dy, deg) {
  const w = $('stirWhisk');
  if (!w) return;
  w.style.left = `calc(50% + ${dx}px)`;
  w.style.top = `calc(50% + ${dy}px)`;
  w.style.transform = `translate(-50%, -50%) rotate(${deg + 90}deg)`;
}

function paint() {
  const view = $('stirView');
  if (!st || !view) return;
  const net = st.cw - st.ccw;
  const turns = Math.abs(net) / 360;
  const p = st.locked ? 1 : Math.min(1, turns / NEED_TURNS);
  view.style.setProperty('--p', String(p));
  view.style.setProperty('--spin', String(net));   // 螺纹跟着净转角转，顺/逆时针方向一致
  view.style.setProperty('--dir', net >= 0 ? '1' : '-1');   // 逆向搅时螺纹反向
  const turnsEl = $('stirTurns');
  if (turnsEl) turnsEl.textContent = turns >= NEED_TURNS ? `${turns.toFixed(1)} 圈` : `${turns.toFixed(1)} / ${NEED_TURNS} 圈`;
  const btn = $('stirDone');
  if (btn) btn.classList.toggle('on', st.locked && !st.ended);
  // 螺纹跟着当前口味换色（换了才重设，别每帧写 style）
  const flavor = flavorOf(st.cw, st.ccw);
  if (st.flavor !== flavor) {
    st.flavor = flavor;
    setSwirl(flavor);
  }
  const sub = $('stirSub');
  if (!sub || st.ended) return;
  if (turns <= 0.02 && !st.locked) { sub.textContent = '按住碗沿，顺时针或逆时针绕圈拖动'; return; }
  const mixed = Math.min(st.cw, st.ccw) / 360 >= MIX_TURNS;
  const dir = mixed ? '来回搅' : (st.cw >= st.ccw ? '顺时针' : '逆时针');
  sub.textContent = st.locked ? `${dir} · ${flavor}　可以点「完成」了` : `${dir} · ${flavor}`;
}

export function playStir({ deco = '草莓糖饰', onDone = null } = {}) {
  if (_endDrag) _endDrag();   // 上一次没松手就重进：先解绑旧监听
  const view = $('stirView');
  const bowl = $('stirBowl');
  if (!view || !bowl) { onDone && onDone(); return; }
  const btn = $('stirDone');
  st = { cw: 0, ccw: 0, last: null, dragging: false, locked: false, ended: false, flavor: '', onDone };
  view.classList.remove('done');
  btn.classList.remove('on');
  view.style.setProperty('--accent', COLORS[deco] || COLORS.草莓糖饰);
  paint();
  showView('stirView');
  const size = fitBowl();
  setWhisk(0, -size * 0.30, -90);   // 初始位置：碗的上沿
  if (_onResize) window.removeEventListener('resize', _onResize);
  _onResize = () => { if (isStirShowActive()) fitBowl(); };
  window.addEventListener('resize', _onResize);

  const info = (e) => {
    // 指针是视口坐标；console 内的 rect 已被 main.js 还原成机身逻辑坐标，先拉回同一套再相减
    const pt = viewportToLogic(e.clientX, e.clientY);
    const r = bowl.getBoundingClientRect();
    const dx = pt.x - (r.left + r.width / 2);
    const dy = pt.y - (r.top + r.height / 2);
    return { dx, dy, deg: (Math.atan2(dy, dx) * 180) / Math.PI, rad: r.width / 2 };
  };
  const follow = (e) => {
    const a = info(e);
    const len = Math.hypot(a.dx, a.dy) || 1;
    const max = a.rad * 0.94;
    const k = len > max ? max / len : 1;   // 拖出碗外就贴住碗沿，不会飞出去
    setWhisk(a.dx * k, a.dy * k, a.deg);
    return a;
  };

  btn.onclick = () => {
    if (!st || st.ended) return;
    if (!st.locked) {
      const sub = $('stirSub');
      if (sub) sub.textContent = `再转满 ${NEED_TURNS} 圈就能完成了`;
      return;
    }
    st.ended = true;
    view.classList.add('done');   // 奶油弹一下，随后进进化演出
    btn.classList.remove('on');
    const cb = st.onDone;
    const flavor = flavorOf(st.cw, st.ccw);
    setTimeout(() => { if (cb) cb(flavor); }, 260);
  };

  // 拖拽期间把 move/up 挂到 document：手指滑出碗外也不会断
  const onMove = (e) => {
    if (!st || st.ended || !st.dragging) return;
    if (e.cancelable) e.preventDefault();
    // 转得快时浏览器会合并事件：把中间点都取出来逐点算角度，不然会"跟不上"
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const points = list && list.length ? list : [e];
    let last = null;
    for (const ev of points) {
      const a = info(ev);
      const far = Math.hypot(a.dx, a.dy) > a.rad * TURN_MIN;
      if (st.last != null && far) {
        const d = norm(a.deg - st.last);
        if (d >= 0) st.cw += d; else st.ccw -= d;   // 顺逆分开记：乱晃互相抵消，换方向能出综合口味
      }
      st.last = far ? a.deg : null;
      last = ev;
    }
    if (!st.locked && Math.abs(st.cw - st.ccw) / 360 >= NEED_TURNS) st.locked = true;
    if (last) follow(last);
    paint();
  };
  const endDrag = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    _endDrag = null;
    if (st) { st.dragging = false; st.last = null; }
  };
  _endDrag = endDrag;
  bowl.onpointerdown = (e) => {
    if (!st || st.ended) return;
    if (e.cancelable) e.preventDefault();
    st.dragging = true;
    follow(e);
    const a = info(e);
    st.last = Math.hypot(a.dx, a.dy) > a.rad * TURN_MIN ? a.deg : null;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  };
}
