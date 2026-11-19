// Emerald 原作战斗动画接入：只接管有原作脚本的招式，其余继续走旧特效。
let runtimePromise = null;
let engine = null;
// 招式调试面板用的临时倍速/原作动画开关：正常战斗恒为 1/开启，调试播放结束后必须复位
let speedFactor = 1;
let enabled = true;

export function setPeSpeedFactor(f = 1) {
  speedFactor = f > 0 ? f : 1;
}

// 调试时关掉原作动画，可以单独验收 battle-view/battle-fx.css 的兼容特效
export function setPeEnabled(v = true) {
  enabled = !!v;
}

async function getEngine() {
  const stage = document.querySelector('.battle-stage-top');
  const atkImg = document.getElementById('bp-img');
  const tgtImg = document.getElementById('be-img');
  if (!stage || !atkImg || !tgtImg) return null;
  if (!runtimePromise) runtimePromise = import('./pe-battle/runtime.js');
  const { EmeraldFx } = await runtimePromise;
  if (!engine || engine.stage !== stage || !engine.stage.isConnected) {
    engine = new EmeraldFx({ stage, atkImg, tgtImg });
  }
  return engine;
}

function clearOldAnim(img) {
  if (!img) return;
  img.classList.remove('b-enter', 'lunge', 'lunge-attack', 'lunge-stay', 'b-strike',
    'hit', 'faint', 'flinch', 'thunder-hit', 'cg-sink', 'cg-rise', 'cg-vanish', 'cg-glow',
    'cg-out-sink', 'cg-out-rise', 'cg-out-vanish');
  img.style.visibility = '';
}

export async function playPeMove(moveId, side, { melee = false, cast = false, twoTurn = false, turn = 1, onImpact = null, onReveal = null, keepHidden = false, speed = 1, type = null, hitOnShake = false } = {}) {
  if (!enabled) return false;
  let restoreLayer = () => {};
  try {
    const eng = await getEngine();
    if (!eng || !eng.hasMove(moveId)) return false;
    const stage = eng.stage;
    stage.classList.add('pe-anim-host');
    clearOldAnim(eng.atkImg);
    clearOldAnim(eng.tgtImg);
    if (keepHidden) {
      const img = side === 'be' ? eng.tgtImg : eng.atkImg;
      if (img) img.style.visibility = 'hidden';
    }
    // 原作动画期间攻击方始终压在目标上层
    const layer = side === 'be' ? eng.tgtImg : eng.atkFlip;
    if (layer) {
      const prev = layer.style.zIndex;
      layer.style.zIndex = '6';
      restoreLayer = () => { layer.style.zIndex = prev; };
    }
    await eng.playMove(moveId, {
      speed: (speed || 1) * speedFactor,
      melee,
      cast,
      twoTurn,
      turn,
      opponent: side === 'be',
      onImpact,
      onReveal,
      type,
      hitOnShake,
    });
    return true;
  } catch (e) {
    console.warn('pe battle anim', e);
    if (engine) engine.stop();
    return false;
  } finally {
    restoreLayer();
  }
}


export async function playPeLabel(label, side, opts = {}) {
  if (!enabled) return false;
  try {
    const eng = await getEngine();
    if (!eng) return false;
    await eng.play(label, { ...opts, speed: (opts.speed || 1) * speedFactor, opponent: side === 'be' });
    return true;
  } catch (e) {
    console.warn('pe battle label', e);
    return false;
  }
}
