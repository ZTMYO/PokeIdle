// 与 src/battle-view.js 的 syncStatusFx 保持一致；预览页用经典脚本，直接双击 HTML 也能打开
const HEART_SVG = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="m20.17 13.537-7.122 7.034a1.494 1.494 0 0 1-2.096 0l-7.128-7.04a6.125 6.125 0 0 1 .006-8.728A6.25 6.25 0 0 1 8.233 3c1.36 0 2.68.436 3.767 1.253A6.26 6.26 0 0 1 15.767 3a6.25 6.25 0 0 1 4.404 1.803 6.127 6.127 0 0 1 0 8.734"/></svg>';

function buildSleepFx(fx) {
  for (let i = 0; i < 2; i++) {
    const z = document.createElement('i');
    z.textContent = 'Z';
    z.style.animationDelay = (i * 1.2) + 's';
    fx.appendChild(z);
  }
}

function buildInfatuationFx(fx, img) {
  const w = img?.offsetWidth || 0;
  const h = img?.offsetHeight || 0;
  for (let i = 0; i < 4; i++) {
    const p = document.createElement('i');
    p.innerHTML = HEART_SVG;
    p.style.left = (Math.random() * w - w / 2) + 'px';
    p.style.top = (-h / 2 - 2) + 'px';
    p.style.animationDelay = (i * 0.4).toFixed(2) + 's';
    fx.appendChild(p);
  }
}

const SPRITES = {
  player: '../src/pokemon-data/images/0025-皮卡丘.gif',
  enemy: '../src/pokemon-data/images/0133-伊布.gif',
};

const SCENES = [
  { scene: '[data-scene="sleep"]', side: 'player', status: 'sleep', build: buildSleepFx },
  { scene: '[data-scene="love"]', side: 'enemy', status: 'infatuation', build: buildInfatuationFx },
];

for (const img of document.querySelectorAll('.sfx-sprite')) {
  img.src = encodeURI(SPRITES[img.dataset.mon]);
}

function paint({ scene, side, status, build }) {
  const root = document.querySelector(scene);
  const mon = root.querySelector(`.sfx-mon.${side}`);
  const img = mon.querySelector('.sfx-sprite');
  mon.querySelector('.b-status-fx')?.remove();
  const fx = document.createElement('div');
  fx.className = `b-status-fx fx-${status}`;
  fx.style.left = (img.offsetLeft + img.offsetWidth / 2) + 'px';
  const headTop = img.offsetTop - 2;
  const centerY = img.offsetTop + img.offsetHeight / 2;
  fx.style.top = (status === 'sleep' ? (side === 'enemy' ? Math.max(34, headTop) : headTop) : (side === 'enemy' ? Math.max(34, centerY) : centerY)) + 'px';
  build(fx, img);
  mon.appendChild(fx);
}

function replay() {
  for (const c of SCENES) {
    const mon = document.querySelector(c.scene).querySelector(`.sfx-mon.${c.side}`);
    mon.querySelector('.b-status-fx')?.remove();
    void mon.offsetWidth;
  }
  for (const c of SCENES) paint(c);
}

replay();
document.getElementById('sfxReplay').addEventListener('click', replay);
