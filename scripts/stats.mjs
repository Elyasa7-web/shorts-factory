// Daily snapshot of every uploaded video's public numbers (data/stats-history.json) so the channel can be analysed over
// time, plus an early warning when a video that has been public for 36 h+ is still stuck under 100 views.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { accessToken } from "./upload.mjs";

const FILE = "data/stats-history.json";

export async function snapshotStats(log) {
  const hist = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
  if (hist.length && Date.now() - Date.parse(hist.at(-1).at) < 20 * 3600_000) return null;   // one snapshot a day is enough
  const ids = log.filter((l) => l.format === "garage" && l.id && !l.manual).map((l) => l.id);
  const token = await accessToken();
  const v = {};
  for (let i = 0; i < ids.length; i += 50) {
    const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.slice(i, i + 50).join(",")}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`videos.list ${res.status}`);
    for (const x of (await res.json()).items ?? []) v[x.id] = [+x.statistics.viewCount || 0, +x.statistics.likeCount || 0, +x.statistics.commentCount || 0];
  }
  hist.push({ at: new Date().toISOString(), v });
  writeFileSync(FILE, JSON.stringify(hist.slice(-90)));
  const dead = log.filter((l) => v[l.id] && Date.parse(l.publishAt) < Date.now() - 36 * 3600_000 && v[l.id][0] < 100);
  const total = Object.values(v).reduce((a, x) => a + x[0], 0);
  console.log(`Stats snapshot: ${Object.keys(v).length} videos, ${total} views in total`);
  if (dead.length) console.error(`::warning::${dead.length} video(s) public for 36 h+ still have < 100 views (distribution dip?): ${dead.map((d) => d.id).join(", ")}`);
  return { videos: Object.keys(v).length, total, dead: dead.length };
}
