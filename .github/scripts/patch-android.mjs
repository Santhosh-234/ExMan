// Run in CI after `expo prebuild`: stamps a rising versionCode and, when release-key secrets are present, signs the release build with them.
// Fails loudly if the generated Gradle file no longer looks the way we expect, rather than silently shipping a debug-signed APK.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2] ?? 'android/app/build.gradle';
let g = readFileSync(file, 'utf8');
const need = (cond, msg) => { if (!cond) throw new Error(`patch-android: ${msg}`); };

const build = Number(process.env.BUILD_NUMBER);
need(Number.isInteger(build) && build > 0, 'BUILD_NUMBER must be a positive integer');
need(/versionCode \d+/.test(g), 'versionCode not found');
g = g.replace(/versionCode \d+/, `versionCode ${build}`);

const { KEYSTORE_PATH, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD } = process.env;
if (KEYSTORE_PATH) {
  need(KEYSTORE_PASSWORD && KEY_ALIAS && KEY_PASSWORD, 'KEYSTORE_PATH is set but the password/alias variables are not');
  const debugBlock = /(signingConfigs \{\s*debug \{[^}]*\})/;
  need(debugBlock.test(g), 'signingConfigs.debug block not found');
  g = g.replace(debugBlock, `$1
        release {
            storeFile file(System.getenv('KEYSTORE_PATH'))
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias System.getenv('KEY_ALIAS')
            keyPassword System.getenv('KEY_PASSWORD')
        }`);
  const rel = /(release \{\s*\/\/ Caution![^\n]*\n[^\n]*\n\s*)signingConfig signingConfigs\.debug/;
  need(rel.test(g), 'release buildType signingConfig not found');
  g = g.replace(rel, '$1signingConfig signingConfigs.release');
  console.log('release build will be signed with the release keystore');
} else {
  console.log('no release keystore provided: release build stays debug-signed');
}
writeFileSync(file, g);
console.log(`versionCode ${build}`);
