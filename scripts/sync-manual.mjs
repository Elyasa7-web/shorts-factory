// Mirrors the "manual upload" packages (GitHub Releases tagged manual-*) into a folder on this PC:
//   <Desktop>\otomasyon\Manuel Yukleme\<date>_<topic>\  video.mp4 + bilgiler.txt (title, description, tags, suggested time)
// Safe to run any number of times: packages already downloaded are skipped.
// usage: node scripts/sync-manual.mjs [targetFolder]
import { mkdirSync, existsSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPO = process.env.SYNC_REPO || "Elyasa7-web/shorts-factory";
const TARGET = process.argv[2] || join(homedir(), "Desktop", "otomasyon", "Manuel Yukleme");
mkdirSync(TARGET, { recursive: true });
const logFile = join(TARGET, "_sync-log.txt");
const log = (m) => { const line = `${new Date().toISOString()}  ${m}`; console.log(line); try { appendFileSync(logFile, line + "\n"); } catch { /* log is optional */ } };

const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=40`, {
  headers: { "User-Agent": "canli-garaj-sync", Accept: "application/vnd.github+json" },
  signal: AbortSignal.timeout(30_000),
});
if (!res.ok) { log(`GitHub API ${res.status}`); process.exit(1); }
const releases = (await res.json()).filter((r) => r.tag_name?.startsWith("manual-"));

let fresh = 0;
for (const r of releases) {
  const slug = (r.assets.find((a) => a.name.endsWith(".mp4"))?.name ?? r.tag_name).replace(/\.mp4$/, "");
  const stamp = r.tag_name.replace("manual-", "");                       // 202610041530
  const folder = join(TARGET, `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}_${stamp.slice(8, 12)}_${slug}`);
  if (existsSync(join(folder, "video.mp4"))) continue;
  mkdirSync(folder, { recursive: true });
  for (const a of r.assets) {
    const out = join(folder, a.name.endsWith(".mp4") ? "video.mp4" : "bilgiler.txt");
    const dl = await fetch(a.browser_download_url, { headers: { "User-Agent": "canli-garaj-sync" }, signal: AbortSignal.timeout(300_000) });
    if (!dl.ok) { log(`download failed ${a.name}: ${dl.status}`); continue; }
    writeFileSync(out, Buffer.from(await dl.arrayBuffer()));
  }
  fresh++;
  log(`new package: ${folder}`);
}
log(fresh ? `${fresh} new package(s) saved to ${TARGET}` : "nothing new");
