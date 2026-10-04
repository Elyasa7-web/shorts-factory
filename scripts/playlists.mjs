// Puts every uploaded video into the channel's playlists: one per KIND of vehicle (Otomobil, Motosiklet, Tren, ...)
// and, for cars, one per TOPIC (Motor, Şanzıman, Fren, ...). Playlists are created on first use.
// Needs the OAuth scope "youtube" (the upload-only scope cannot touch playlists): while the token lacks it, additions are
// kept in data/playlist-queue.json and are done automatically once a token with the scope is installed.
// Quota: playlists.insert / playlistItems.insert cost 50 units each, a list call 1.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { accessToken } from "./upload.mjs";

const CACHE = "data/playlists.json";        // { "<playlist title>": "<playlist id>" }
const QUEUE = "data/playlist-queue.json";   // [{ videoId, kind, category }] waiting for a token with the right scope

export const KIND_PLAYLIST = {
  car: ["Otomobil", "Otomobillerin parçaları, nasıl çalıştıkları ve arızaları. Kısa, net, ustadan anlatım."],
  motorcycle: ["Motosiklet", "Motosiklet parçaları, nasıl çalıştıkları ve sürüş bilgileri."],
  train: ["Tren", "Trenler ve demiryolu araçları nasıl çalışır?"],
  aircraft: ["Uçak", "Uçaklar ve helikopterler nasıl çalışır?"],
  ship: ["Gemi", "Gemiler ve denizaltılar nasıl çalışır?"],
  machine: ["İş Makineleri", "Ekskavatör, vinç, dozer ve diğer iş makineleri nasıl çalışır?"],
  truck: ["Kamyon ve Otobüs", "Kamyonlar, otobüsler ve ağır vasıtalar nasıl çalışır?"],
};
export const TOPIC_PLAYLIST = {
  motor: ["Motor ve Yakıt Sistemi", "Motor parçaları ve çalışma prensipleri."],
  aktarma: ["Şanzıman, Debriyaj ve Aktarma", "Şanzıman, debriyaj, diferansiyel ve güç aktarımı."],
  "fren-suspansiyon": ["Fren ve Süspansiyon", "Fren, amortisör, yay ve direksiyon sistemleri."],
  "elektrik-guvenlik": ["Elektrik ve Güvenlik Sistemleri", "Akü, marş, ABS, hava yastığı ve diğer sistemler."],
  elektrikli: ["Elektrikli Araçlar", "Elektrikli ve hibrit araçlar nasıl çalışır?"],
  "otomobil-turleri": ["Otomobil Türleri", "Sedan, SUV, hatchback ve diğer kasa tipleri."],
  senaryo: ["Ya Şöyle Olursa?", "Araçlarla ilgili merak edilen \"ya şöyle yaparsam ne olur?\" soruları."],
};

const readJson = (f, fallback) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback; } catch { return fallback; } };
const writeJson = (f, v) => writeFileSync(f, JSON.stringify(v, null, 1));

const api = async (path, { method = "GET", body } = {}) => {
  const token = await accessToken();
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) { const e = new Error(`${method} ${path.split("?")[0]} -> ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; e.body = text; throw e; }
  return json;
};
const missingScope = (e) => e.status === 403 && /insufficientPermissions|SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(e.body ?? "");

/** The playlist titles a video belongs to. */
export function playlistsFor({ kind = "car", category } = {}) {
  const titles = [];
  const k = KIND_PLAYLIST[kind] ?? KIND_PLAYLIST.car;
  titles.push(k);
  const t = TOPIC_PLAYLIST[category];
  if (t && t[0] !== k[0]) titles.push(t);
  return titles;                                   // [[title, description], ...]
}

async function ensurePlaylist([title, description], cache) {
  if (cache[title]) return cache[title];
  // an existing playlist with that title (created by hand or by an earlier run) is reused
  let pageToken = "";
  do {
    const j = await api(`playlists?part=snippet&mine=true&maxResults=50${pageToken ? `&pageToken=${pageToken}` : ""}`);
    const hit = (j.items ?? []).find((p) => p.snippet?.title === title);
    if (hit) { cache[title] = hit.id; writeJson(CACHE, cache); return hit.id; }
    pageToken = j.nextPageToken ?? "";
  } while (pageToken);
  const made = await api("playlists?part=snippet,status", {
    method: "POST",
    body: { snippet: { title, description, defaultLanguage: "tr" }, status: { privacyStatus: "public" } },
  });
  cache[title] = made.id;
  writeJson(CACHE, cache);
  console.log(`  created playlist "${title}" (${made.id})`);
  return made.id;
}

async function addOne(videoId, def, cache) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const playlistId = await ensurePlaylist(def, cache);
    try {
      await api("playlistItems?part=snippet", {
        method: "POST",
        body: { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } },
      });
      console.log(`  ${videoId} -> playlist "${def[0]}"`);
      return;
    } catch (e) {
      if (e.status === 404 && /playlistNotFound/.test(e.body ?? "")) { delete cache[def[0]]; continue; }   // deleted by hand: recreate
      if (e.status === 409) return;                                                                           // already in it
      throw e;
    }
  }
}

/** Adds a video to its playlists. Never throws: a failure keeps the job in the queue for the next run. */
export async function addToPlaylists({ videoId, kind, category }) {
  const queue = readJson(QUEUE, []);
  if (videoId && !queue.some((q) => q.videoId === videoId)) queue.push({ videoId, kind, category });
  const cache = readJson(CACHE, {});
  const left = [];
  let blocked = null;
  for (const job of queue.slice(0, 12)) {
    if (blocked) { left.push(job); continue; }
    try {
      job.done = job.done ?? [];                     // playlists this video is already in (YouTube allows duplicates, so never repeat)
      for (const def of playlistsFor(job)) {
        if (job.done.includes(def[0])) continue;
        await addOne(job.videoId, def, cache);
        job.done.push(def[0]);
      }
    } catch (e) {
      if (missingScope(e)) blocked = "the YouTube token has no playlist permission yet (needs the 'youtube' scope)";
      else blocked = e.message;
      console.error(`::warning::playlists: ${blocked}`);
      left.push(job);
    }
  }
  const rest = [...left, ...queue.slice(12)];
  writeJson(QUEUE, rest);
  return { done: queue.length - rest.length, waiting: rest.length, blocked };
}
