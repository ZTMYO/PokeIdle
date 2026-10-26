import { $ } from './ui.js';

export function isRulesPanelOpen() {
  return !!document.getElementById('gameRulesOverlay');
}

export function closeRulesPanel() {
  document.getElementById('gameRulesOverlay')?.remove();
}

export function showRulesPanel(hostId, title, bodyHtml) {
  closeRulesPanel();
  const host = $(hostId);
  if (!host) return;
  const overlay = document.createElement('div');
  overlay.className = 'game-rules-overlay';
  overlay.id = 'gameRulesOverlay';
  overlay.innerHTML = `
    <div class="game-rules-head"><span>${title}</span></div>
    <div class="game-rules-body">${bodyHtml}</div>
    <button class="game-rules-ok" id="gameRulesOk">知道了</button>`;
  host.appendChild(overlay);
  $('gameRulesOk').addEventListener('click', closeRulesPanel);
}

window.addEventListener('view-changed', closeRulesPanel);
