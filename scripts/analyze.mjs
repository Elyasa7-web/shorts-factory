// Channel analysis report: views, retention (YouTube Analytics) and subscribers per video, split into
//   BEFORE and AFTER the script/topic changes of 2026-10-17 so we can see whether they worked.
// usage: node scripts/analyze.mjs [--cutoff 2026-10-17T00:30:00Z] [--min-age-h 48]
// Needs the OAuth token with the youtube + yt-analytics.readonly scopes: env YT_CLIENT_ID/YT_CLIENT_SECRET/YT_REFRESH_TOKEN,
// or (locally) the client_secret json in Desktop\otomasyon and .yt-refresh-token.txt.  Writes reports/analysis-<date>.md
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PARTS, SCENARIOS } from "./sources/garage-topics.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const CUTOFF = Date.parse(arg("cutoff", "2026-10-17T00:30:00Z"));
const MIN_AGE_H = Number(arg("min-age-h", 48));
const START = "2026-10-04";
const today = new Date().toISOString().slice(0, 10);

function credentials() {
  if (process.env.YT_CLIENT_ID && process.env.YT_REFRESH_TOKEN) return { id: process.env.YT_CLIENT_ID, secret: process.env.YT_CLIENT_SECRET, refresh: process.env.YT_REFRESH_TOKEN };
  const dir = join(homedir(), "Desktop", "otomasyon");
  const f = readdirSync(dir).find((x) => /^client_secret.*\.json$/.test(x));
  const c = JSON.parse(readFileSync(join(dir, f), "utf8")).installed;
  return { id: c.client_id, secret: c.client_secret, refresh: readFileSync(".yt-refresh-token.txt", "utf8").trim() };
}
const cr = credentials();
const tok = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: cr.id, client_secret: cr.secret, refresh_token: cr.refresh, grant_type: "refresh_token" }) })).json();
if (!tok.access_token) throw new Error("token refresh failed: " + JSON.stringify(tok));
const H = { Authorization: `Bearer ${tok.access_token}` };
const get = async (url) => { const r = await fetch(url, { headers: H }); if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 90)} ${(await r.text()).slice(0, 150)}`); return r.json(); };
const analytics = (p) => get("https://youtubeanalytics.googleapis.com/v2/reports?" + new URLSearchParams({ ids: "channel==MINE", startDate: START, endDate: today, ...p }));

// ---- what we uploaded ----
const log = JSON.parse(readFileSync("data/schedule.json", "utf8")).filter((l) => l.format === "garage" && l.id && !l.manual && !l.cancelled && !l.deleted);
const partByWiki = new Map(PARTS.map((p) => [p.wiki, p]));
const qByText = new Map(SCENARIOS.map((s) => [s.q, s]));
const topicOf = (key) => {
  if (key.startsWith("garage|q|")) { const s = qByText.get(key.slice(9)); return s && { kind: s.vehicle, angle: "question", cat: "senaryo" }; }
  const m = /^garage\|(.+)\|([^|]+)$/.exec(key); const p = m && partByWiki.get(m[1]);
  // topics removed from the bank on 2026-10-17 (weak machine topics) still have videos on the channel
  const LEGACY = { "Loader (equipment)": "machine", "Seed drill": "machine", "Baler": "machine", "Plough": "machine", "Skid-steer loader": "machine" };
  if (!p && m && LEGACY[m[1]]) return { kind: LEGACY[m[1]], angle: m[2], cat: "is-makinesi" };
  return p && { kind: p.vehicle, angle: m[2], cat: p.category };
};

// ---- YouTube numbers ----
const stats = {};
for (let i = 0; i < log.length; i += 50) {
  const j = await get(`https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails,status&id=${log.slice(i, i + 50).map((l) => l.id).join(",")}`);
  for (const v of j.items ?? []) {
    const d = /PT(?:(\d+)M)?(?:(\d+)S)?/.exec(v.contentDetails.duration);
    stats[v.id] = { views: +v.statistics.viewCount || 0, likes: +v.statistics.likeCount || 0, comments: +v.statistics.commentCount || 0, secs: (+d[1] || 0) * 60 + (+d[2] || 0), priv: v.status.privacyStatus };
  }
}
const per = {};
const rep = await analytics({ dimensions: "video", metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,shares", sort: "-views", maxResults: "200" });
const cols = rep.columnHeaders.map((c) => c.name);
for (const r of rep.rows ?? []) per[r[0]] = Object.fromEntries(cols.map((c, i) => [c, r[i]]));

const rows = [];
for (const l of log) {
  const s = stats[l.id], a = per[l.id], t = topicOf(l.key ?? "");
  if (!s || !a || s.priv !== "public") continue;
  const ageH = (Date.now() - Date.parse(l.publishAt)) / 3600e3;
  rows.push({ id: l.id, title: l.title, after: Date.parse(l.uploadedAt) >= CUTOFF, ageH, hourTRT: (new Date(l.publishAt).getUTCHours() + 3) % 24, kind: t?.kind ?? "?", angle: t?.angle ?? "?", cat: t?.cat ?? "?",
    views: s.views, secs: s.secs, avgPct: a.averageViewPercentage, avgSec: a.averageViewDuration, subs: a.subscribersGained, shares: a.shares });
}
const eligible = rows.filter((r) => r.ageH >= MIN_AGE_H && r.views >= 100);   // old enough to judge, not a distribution failure
const curves = {};
for (const r of eligible) {
  try {
    const c = await analytics({ dimensions: "elapsedVideoTimeRatio", metrics: "audienceWatchRatio", filters: `video==${r.id}` });
    curves[r.id] = c.rows.map((x) => x[1]);
    r.keep20 = curves[r.id][20]; r.loss = curves[r.id][8] - curves[r.id][20];
  } catch { /* no curve for this video */ }
}

// ---- report ----
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "-");
const summary = (g) => ({ n: g.length, views: mean(g.map((r) => r.views)), pct: mean(g.map((r) => r.avgPct)), keep20: mean(g.filter((r) => r.keep20 != null).map((r) => r.keep20 * 100)),
  loss: mean(g.filter((r) => r.loss != null).map((r) => r.loss * 100)), subs1k: (1000 * g.reduce((a, r) => a + r.subs, 0)) / Math.max(1, g.reduce((a, r) => a + r.views, 0)) });
const line = (name, s) => `| ${name} | ${s.n} | ${f(s.views)} | ${f(s.pct, 1)}% | ${f(s.keep20)}% | ${f(s.loss, 1)} | ${f(s.subs1k, 2)} |`;
const head = "| group | videos | avg views | avg view % | still watching at 20% | lost 8%→20% (pts) | subs / 1k views |\n|---|---|---|---|---|---|---|";
const group = (key) => { const m = new Map(); for (const r of eligible) m.set(r[key], [...(m.get(key) ?? []), r]); return [...new Map(Object.entries(Object.groupBy(eligible, (r) => r[key]))).entries()]; };

const before = eligible.filter((r) => !r.after), after = eligible.filter((r) => r.after);
let md = `# Canlı Garaj analysis ${today}\n\nVideos judged: ${eligible.length} (public, >= ${MIN_AGE_H} h old, >= 100 views). "After" = uploaded after ${new Date(CUTOFF).toISOString()}.\n`;
md += `Channel: ${rows.length} public analysed videos, ${rows.reduce((a, r) => a + r.views, 0)} views, ${rows.reduce((a, r) => a + r.subs, 0)} subscribers gained since ${START}.\n\n`;
md += `## Before vs after the 2026-10-17 changes\n${head}\n${line("BEFORE", summary(before))}\n${line("AFTER", summary(after))}\n\n`;
for (const kind of ["motorcycle", "machine"]) {
  md += `### ${kind}\n${head}\n${line(`${kind} before`, summary(before.filter((r) => r.kind === kind)))}\n${line(`${kind} after`, summary(after.filter((r) => r.kind === kind)))}\n\n`;
}
for (const [key, label] of [["kind", "vehicle kind"], ["angle", "angle"], ["hourTRT", "publish hour (TRT)"]]) {
  md += `## By ${label} (all judged videos)\n${head}\n`;
  for (const [k, g] of Object.entries(Object.groupBy(eligible, (r) => r[key])).sort((a, b) => mean(b[1].map((r) => r.avgPct)) - mean(a[1].map((r) => r.avgPct)))) md += line(String(k), summary(g)) + "\n";
  md += "\n";
}
const tl = (r) => `${f(r.avgPct, 1)}% | ${r.views} views | ${r.kind}/${r.angle} | ${r.title}`;
const byPct = [...(after.length ? after : eligible)].sort((a, b) => b.avgPct - a.avgPct);
md += `## Best / worst retention (${after.length ? "after" : "all"})\n${byPct.slice(0, 5).map(tl).join("\n")}\n...\n${byPct.slice(-5).map(tl).join("\n")}\n\n`;
const dead = rows.filter((r) => r.ageH >= 36 && r.views < 100);
md += `## Dead videos (public 36 h+, < 100 views): ${dead.length}\n${dead.map((r) => `${r.id} ${r.title}`).join("\n")}\n`;
mkdirSync("reports", { recursive: true });
const out = `reports/analysis-${today}.md`;
writeFileSync(out, md);
console.log(md);
console.log(`\n(saved ${out})`);
