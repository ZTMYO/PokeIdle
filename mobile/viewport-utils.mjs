const DESIGN_WIDTH = 274;
const DESIGN_HEIGHT = 342;

export function calculateMobileScale(width, height, insets = {}) {
  return calculateMobileLayout(width, height, insets).scale;
}

export function calculateMobileLayout(width, height, insets = {}) {
  const availableWidth = Number(width) - (Number(insets.left) || 0) - (Number(insets.right) || 0);
  const availableHeight = Number(height) - (Number(insets.top) || 0) - (Number(insets.bottom) || 0);
  if (availableWidth <= 0 || availableHeight <= 0) {
    return { scale: 1, designHeight: DESIGN_HEIGHT };
  }
  const scale = Math.min(availableWidth / DESIGN_WIDTH, availableHeight / DESIGN_HEIGHT);
  return {
    scale,
    designHeight: Math.max(DESIGN_HEIGHT, availableHeight / scale),
  };
}
