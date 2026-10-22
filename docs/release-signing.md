# Release signing and in-app APK updates

## Why

Until now release APKs were signed with the public debug key that every Expo project shares. Anyone could build an APK Android would accept as an update to ExMan. With your own key, only you can.

## One-time: make the repo public (needed for the in-app update check)

The app finds new APKs from the repository's **public** GitHub Releases, because a private repository's releases cannot be read without a login. Before switching:

1. Skim the repo once for anything you would not want public: the parser test corpus (`src/utils/parser.india.test.ts`) and docs. I scanned the history for tokens and keys and found none.
2. GitHub repo **Settings > General > Danger Zone > Change visibility > Make public**.

The EXPO_TOKEN and the signing secrets live in GitHub Secrets and stay private. The code, docs and MIT licence become public. Your Expo account name and project ID are in `app.json` and become visible, which is normal for Expo apps.

If you would rather stay private, tell me and I will host the APK on the telemetry VM instead.

## One-time: create your release key

Do this on your computer (needs Java; `keytool` ships with it, or install via `brew install openjdk`):

```bash
keytool -genkeypair -v -keystore exman-release.jks -alias exman -keyalg RSA -keysize 2048 -validity 10000
```

It asks for a keystore password and a key password (use the same for both if you like), and some name fields (any values). Then:

1. **Back it up now.** Put `exman-release.jks` and both passwords in a password manager or an encrypted drive. If you lose them, you can never publish an update that installs over the existing app. Never commit the file (`*.jks` is already git-ignored). Key files with other extensions (`.pem`, `.keystore`) are not, so in any checkout where you keep them run once: `printf '*.pem\n*.keystore\n*.pfx\n' >> .git/info/exclude` (a local ignore; editing the shared `.gitignore` would change the OTA fingerprint).
2. Make the base64 text for GitHub:
   ```bash
   base64 -i exman-release.jks | pbcopy        # macOS (copies it); on Linux: base64 -w0 exman-release.jks
   ```
3. GitHub repo **Settings > Secrets and variables > Actions > Secrets > New repository secret**, four of them:
   - `ANDROID_KEYSTORE_BASE64`: the base64 text
   - `ANDROID_KEYSTORE_PASSWORD`: the keystore password
   - `ANDROID_KEY_ALIAS`: `exman`
   - `ANDROID_KEY_PASSWORD`: the key password

The build workflow signs with this key whenever the four secrets exist, and falls back to the debug key when they do not. The build log says which one it used ("release build will be signed with the release keystore").

## Switching the phone to the new key (once)

Android will not install an APK signed with a different key over an existing one, so the first install of a release-signed build needs a clean install:

1. In the current app: Settings > Backup, restore and export > create an encrypted backup and **save it to a folder** (not just share).
2. Uninstall ExMan.
3. Install the new APK (GitHub Releases, run the Build APK workflow first).
4. Grant the permissions again and restore the backup.

From then on every new APK installs over the old one, and the in-app check tells you when one is out.

## How the in-app check works

- Each release body now contains `runtime: <fingerprint>`, the OTA runtime of that APK (written by `build-apk.yml`).
- The app compares its own runtime with the newest release's. A different value means the native part changed, so a normal update cannot deliver it and a new APK is needed.
- Home shows a card with **Download** (opens the APK link in the browser; you then open the file to install). Settings > App updates > "New app versions (APK)" has the daily automatic check switch and a "Check now" button.
- The check is one GET to `api.github.com`; it sends no identifier. It can be turned off in Settings.
- Android may ask you to allow your browser to "install unknown apps" the first time.

## Version codes

CI now sets Android's `versionCode` to the workflow run number so builds always increase. It does not change the OTA fingerprint (checked).
