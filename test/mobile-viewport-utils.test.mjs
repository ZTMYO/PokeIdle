import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateMobileLayout, calculateMobileScale } from '../mobile/viewport-utils.mjs';

test('竖屏设备按可用宽度等比放大', () => {
  assert.equal(calculateMobileScale(360, 800), 360 / 274);
});

test('矮屏设备按扣除安全区后的高度缩放', () => {
  assert.equal(calculateMobileScale(360, 400, { top: 20, bottom: 20 }), 360 / 342);
});

test('无效视口回退为原始比例', () => {
  assert.equal(calculateMobileScale(0, 0), 1);
});

test('竖屏设备返回按缩放反算的动态设计高度', () => {
  assert.deepEqual(calculateMobileLayout(360, 800), {
    scale: 360 / 274,
    designHeight: 800 / (360 / 274),
  });
});

test('矮屏设备动态高度不小于基础高度', () => {
  assert.deepEqual(calculateMobileLayout(360, 400, { top: 20, bottom: 20 }), {
    scale: 360 / 342,
    designHeight: 342,
  });
});
