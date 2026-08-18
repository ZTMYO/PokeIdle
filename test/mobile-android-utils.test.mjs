import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as androidUtils from '../mobile/android-utils.mjs';

import {
  artifactFileName,
  formatSigningProperties,
  gradleUserHome,
  gradleExecutable,
  sha256Text,
} from '../mobile/android-utils.mjs';

test('release APK 文件名包含应用版本', () => {
  assert.equal(artifactFileName('1.0.8'), 'pokeidle-android-v1.0.8.apk');
});

test('按操作系统选择 Gradle Wrapper', () => {
  assert.equal(gradleExecutable('win32'), 'gradlew.bat');
  assert.equal(gradleExecutable('darwin'), './gradlew');
});

test('Gradle 缓存固定在项目可写目录', () => {
  assert.equal(gradleUserHome('/workspace/pokeidle'), '/workspace/pokeidle/mobile/.gradle-home');
});

test('Capacitor 7 Android 构建要求 JDK 21', () => {
  assert.equal(androidUtils.androidJavaVersion, 21);
});

test('签名配置使用 Android 根目录相对路径', () => {
  assert.equal(formatSigningProperties({ password: 'secret', alias: 'pokeidle-release' }), [
    'storeFile=../mobile/keystore/pokeidle-release.jks',
    'storePassword=secret',
    'keyAlias=pokeidle-release',
    'keyPassword=secret',
    '',
  ].join('\n'));
});

test('生成稳定的 SHA-256 文本', () => {
  assert.equal(
    sha256Text(Buffer.from('pokeidle'), 'pokeidle.apk'),
    '48e21d243280cf3591f55b9963868a049391220a9e1fe4ef0147a258a7cef5fd  pokeidle.apk\n',
  );
});

test('release 签名使用 AGP 8 支持的 V3 签名属性', async () => {
  const buildGradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');

  assert.doesNotMatch(buildGradle, /\bv3SigningEnabled\b/);
  assert.match(buildGradle, /\benableV3Signing\s*=\s*true\b/);
});
