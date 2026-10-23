// Backlog: videos that were produced but could not be uploaded (they wait as "manual packages" = GitHub Releases manual-*)
// are published to YouTube BEFORE new videos are made. Between 2026-10-17 and 2026-10-23 every upload failed (dead
// keep-alive socket), so ~21 finished videos were waiting; this drains them at the daily cadence without extra quota.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PARTS, SCENARIOS } from "./sources/garage-topics.mjs";
import { accessToken, ytFetch } from "./upload.mjs";

const REPO = process.env.GITHUB_REPOSITORY || "Elyasa7-web/shorts-factory";
const FILE = "data/backlog.json";                       // { done: { "<release tag>": "<youtube video id>" } }
const SKIP = new Set(["manual-202610041037"]);          // test package of 4 Oct (the fixed "Debriyaj" test script)
const state = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { done: {} });

/** Parses the bilgiler.txt that run.mjs writes into every manual package. */
export function parseInfo(txt) {
  const t = txt.replace(/\r\n/g, "\n");
  const between = (a, b) => { const i = t.indexOf(a); if (i < 0) return ""; const s = i + a.length; const j = b ? t.indexOf(b, s) : -1; return t.slice(s, j < 0 ? undefined : j).trim(); };
  const title = between("BAŞLIK\n", "\n\nAÇIKLAMA\n");
  const description = between("AÇIKLAMA\n", "\n\nETİKETLER (virgülle ayrılmış)\n");
  const tags = between("ETİKETLER (virgülle ayrılmış)\n", "\n\nÖNERİLEN").split(",").map((x) => x.trim()).filter(Boolean);
  return { title, description, tags };
}

const topicOfKey = (key = "") => {
  if (key.startsWith("garage|q|")) { const s = SCENARIOS.find((x) => x.q === key.slice(9)); return s && { kind: s.vehicle, category: "senaryo" }; }
  const m = /^garage\|(.+)\|[^|]+$/.exec(key); const p = m && PARTS.find((x) => x.wiki === m[1]);
  return p && { kind: p.vehicle, category: p.category };
};

async function channelTitles() {
  const token = await accessToken(); const H = { Authorization: `Bearer ${token}` };
  const ch = await (await ytFetch("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true", { headers: H })).json();
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  const titles = new Set(); let page = "";
  do {
    const j = await (await ytFetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploads}&maxResults=50${page ? `&pageToken=${page}` : ""}`, { headers: H })).json();
    for (const i of j.items ?? []) titles.add(i.snippet.title.trim().toLowerCase());
    page = j.nextPageToken ?? "";
  } while (page);
  return titles;
}

async function download(url) {
  const res = await fetch(url, { headers: { "User-Agent": "canli-garaj" }, signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Takes the oldest waiting package, writes it to out/final.mp4 and returns what run.mjs needs (or null when nothing waits). */
export async function takeBacklogVideo(log) {
  const st = state();
  const H = { "User-Agent": "canli-garaj", Accept: "application/vnd.github+json", ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
  const releases = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers: H, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`releases API ${r.status}`);
    const part = await r.json(); releases.push(...part); if (part.length < 100) break;
  }
  const waiting = releases.filter((r) => r.tag_name.startsWith("manual-") && !SKIP.has(r.tag_name) && !st.done[r.tag_name]).sort((a, b) => a.tag_name.localeCompare(b.tag_name));
  if (!waiting.length) return null;
  const onChannel = await channelTitles();
  for (const rel of waiting) {
    const mp4 = rel.assets.find((a) => a.name.endsWith(".mp4")), txt = rel.assets.find((a) => a.name.endsWith(".txt"));
    if (!mp4 || !txt) { st.done[rel.tag_name] = "incomplete package"; continue; }
    const info = parseInfo((await download(txt.browser_download_url)).toString("utf8"));
    if (!info.title || !info.description) { console.error(`::warning::backlog ${rel.tag_name}: info file could not be read`); continue; }
    if (onChannel.has(info.title.trim().toLowerCase())) { st.done[rel.tag_name] = "already on the channel"; console.log(`backlog ${rel.tag_name}: already on the channel, skipped`); continue; }
    mkdirSync("out", { recursive: true });
    writeFileSync("out/final.mp4", await download(mp4.browser_download_url));
    const entry = log.find((l) => l.id === rel.tag_name);
    const topic = topicOfKey(entry?.key);
    writeFileSync(FILE, JSON.stringify(st, null, 1));
    console.log(`backlog: publishing "${info.title}" (${rel.tag_name}); ${waiting.length - 1} more waiting after it`);
    return { format: "garage", key: entry?.key ?? `garage|backlog|${rel.tag_name}`, ...info, kind: topic?.kind ?? "car", category: topic?.category, backlogTag: rel.tag_name };
  }
  writeFileSync(FILE, JSON.stringify(st, null, 1));
  return null;
}

export function markBacklogDone(tag, videoId) {
  const st = state(); st.done[tag] = videoId; writeFileSync(FILE, JSON.stringify(st, null, 1));
}
