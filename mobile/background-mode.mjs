function getPlugin(capacitor) {
  return capacitor?.Plugins?.PokeIdleBackground
    || capacitor?.Plugins?.PokeIdleBackgroundPlugin
    || null;
}
export function isBackgroundModeSupported({ capacitor } = {}) {
  const plugin = getPlugin(capacitor);
  return !!plugin
    && typeof plugin.start === 'function'
    && typeof plugin.stop === 'function';
}

export function createBackgroundMode({ capacitor = globalThis.Capacitor } = {}) {
  const plugin = getPlugin(capacitor);
  let removeTickListener = null;
  let removeStoppedListener = null;

  return {
    async startBackgroundMode() {
      if (!plugin?.start) return false;
      return plugin.start();
    },

    async stopBackgroundMode() {
      if (!plugin?.stop) return false;
      return plugin.stop();
    },

    async isBackgroundModeSupported() {
      if (!plugin?.isSupported) return isBackgroundModeSupported({ capacitor });
      return plugin.isSupported();
    },

    async onBackgroundTick(callback) {
      if (!plugin?.addListener || typeof callback !== 'function') {
        return () => {};
      }
      removeTickListener?.();
      const listener = await plugin.addListener('backgroundTick', event => {
        const now = Number.isFinite(event?.now) ? event.now : Date.now();
        callback({ now });
      });
      removeTickListener = () => listener?.remove?.();
      return removeTickListener;
    },

    async onBackgroundStopped(callback) {
      if (!plugin?.addListener || typeof callback !== 'function') {
        return () => {};
      }
      removeStoppedListener?.();
      const listener = await plugin.addListener('backgroundStopped', callback);
      removeStoppedListener = () => listener?.remove?.();
      return removeStoppedListener;
    },
  };
}
