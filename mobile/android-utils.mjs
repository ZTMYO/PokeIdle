import { createHash } from 'node:crypto';

export function artifactFileName(version) {
  return `pokeidle-android-v${version}.apk`;
}

export function gradleExecutable(platform = process.platform) {
  return platform === 'win32' ? 'gradlew.bat' : './gradlew';
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
