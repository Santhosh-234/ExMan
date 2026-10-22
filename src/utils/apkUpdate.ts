// Decides whether a newer APK exists, from the repository's public GitHub Releases.
// Each release body carries "runtime: <40 hex>", the OTA runtime fingerprint of that APK (written by build-apk.yml).
// A different runtime than the one running means the native part changed, so an OTA update cannot cover it and a new APK is needed.
export const RELEASES_URL = 'https://api.github.com/repos/Santhosh-234/ExMan/releases?per_page=10';

export type Release = { tag_name: string; name?: string | null; body?: string | null; draft?: boolean; published_at?: string | null; assets?: { name: string; browser_download_url: string; size?: number }[] };
export type ApkUpdate = { tag: string; name: string; url: string; sizeMb: number | null; published: string | null };

export const parseRuntime = (body: string | null | undefined) => body?.match(/runtime:\s*([0-9a-f]{40})\b/i)?.[1]?.toLowerCase() ?? null;

export function newerApk(releases: Release[], runtime: string | null | undefined): ApkUpdate | null {
  if (!runtime || !/^[0-9a-f]{40}$/i.test(runtime)) return null; // not a fingerprint build (dev client, etc.): nothing sensible to compare
  const mine = runtime.toLowerCase();
  const usable = releases
    .filter((r) => !r.draft && r.assets?.some((a) => /\.apk$/i.test(a.name)))
    .sort((a, b) => Date.parse(b.published_at ?? '') - Date.parse(a.published_at ?? ''));
  const latest = usable[0];
  const latestRuntime = parseRuntime(latest?.body);
  if (!latest || !latestRuntime || latestRuntime === mine) return null;
  // if this installation's own release is listed it must be older than the latest (it is not the first entry, which we checked above)
  const apk = latest.assets!.find((a) => /\.apk$/i.test(a.name))!;
  return { tag: latest.tag_name, name: latest.name?.trim() || latest.tag_name, url: apk.browser_download_url, sizeMb: apk.size ? Math.round((apk.size / 1048576) * 10) / 10 : null, published: latest.published_at ?? null };
}

/** Only https links to this repository's release assets are ever opened. */
export const isTrustedApkUrl = (url: string) => /^https:\/\/github\.com\/Santhosh-234\/ExMan\/releases\/download\/[^/]+\/[^/]+\.apk$/.test(url);
