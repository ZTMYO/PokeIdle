// ===== 道具详情卡片（商店 / 道具盒共用）=====
import { $ } from './ui.js';

let _mask = null;
let _host = null;

export function showDetailCard(detail, hostId, action = null) {
  if (!detail) { hideDetailCard(); return; }
  const host = hostId ? $(hostId) : _host;
  if (!host) return;
  if (!_mask) {
    _mask = document.createElement('div');
    _mask.id = 'shopDetailMask';
    _mask.className = 'shop-detail-mask';
    _mask.innerHTML = `<div class="shop-detail-card">
      <div class="shop-detail-head">
        <span class="shop-detail-badge"></span>
        <span class="shop-detail-name"></span>
      </div>
      <div class="move-edit-detail-stats"></div>
      <div class="shop-detail-desc"></div>
      <button class="shop-detail-use" type="button" style="display:none"></button>
    </div>`;
    _mask.addEventListener('click', () => hideDetailCard());
    _mask.querySelector('.shop-detail-card').addEventListener('click', (e) => e.stopPropagation());
  }
  if (host !== _host) { host.appendChild(_mask); _host = host; }
  _mask.querySelector('.shop-detail-badge').innerHTML = detail.badgeHtml || '';
  _mask.querySelector('.shop-detail-name').textContent = detail.title || '';
  _mask.querySelector('.move-edit-detail-stats').innerHTML = detail.statsHtml || '';
  _mask.querySelector('.shop-detail-desc').textContent = detail.desc || '';
  // 底部「使用」按钮：道具盒里给可使用道具做反向入口（效果等同点背包里的同名槽位），商店不带按钮
  const useBtn = _mask.querySelector('.shop-detail-use');
  if (action) {
    useBtn.textContent = action.label || '使用';
    useBtn.onclick = (e) => { e.stopPropagation(); hideDetailCard(); action.run?.(); };
    useBtn.style.display = '';
  } else {
    useBtn.onclick = null;
    useBtn.style.display = 'none';
  }
  _mask.style.display = 'flex';
}

export function hideDetailCard() {
  if (_mask) _mask.style.display = 'none';
}
