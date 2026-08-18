import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const androidJavaVersion = 21;

export function artifactFileName(version) {
  return `pokeidle-android-v${version}.apk`;
}

export function gradleExecutable(platform = process.platform) {
  return platform === 'win32' ? 'gradlew.bat' : './gradlew';
}

export function gradleUserHome(projectRoot) {
  return join(projectRoot, 'mobile', '.gradle-home');
}

export function formatSigningProperties({ password, alias }) {
  return [
    'storeFile=../mobile/keystore/pokeidle-release.jks',
    `storePassword=${password}`,
    `keyAlias=${alias}`,
    `keyPassword=${password}`,
    '',
  ].join('\n');
}

export function sha256Text(content, fileName) {
  const hash = createHash('sha256').update(content).digest('hex');
  return `${hash}  ${fileName}\n`;
}
