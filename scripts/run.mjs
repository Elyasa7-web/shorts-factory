// One full cycle for the "Canlı Garaj" channel: pick a vehicle topic -> script (Turkish, fact-checked) -> footage
// -> voice -> render -> upload as a scheduled public video. The old English "ranking" format only runs with FORMAT=ranking.
// Env: PUBLISH_HOURS_UTC="9,12,15,18"  DAILY_TARGET=4  MAX_QUEUE=12  DRY_RUN=1  FORCE=1  FORMAT=garage|ranking  STORY_FIXTURE=1
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { generateTopic } from "./generate-topic.mjs";
import { uploadToYouTube } from "./upload.mjs";
import { addToPlaylists } from "./playlists.mjs";

const SCHEDULE = "data/schedule.json";
// Four public slots per day, all inside the Turkish day: 12:00, 15:00, 18:00, 21:00 TRT (UTC+3), none around midnight.
// YouTube's free API quota (10,000 units, 1,600 per upload) allows at most 6 uploads a day; 4 keeps a safe margin.
const HOURS = (process.env.PUBLISH_HOURS_UTC || "9,12,15,18").split(",").map(Number);
const DAILY_TARGET = Number(process.env.DAILY_TARGET || 4);   // videos per YouTube quota day (the free quota fits 6 uploads; 4 leaves a safe margin)
const MAX_QUEUE = Number(process.env.MAX_QUEUE || 12);  // videos scheduled but not yet public (two days of slots)
const LEAD_MS = 45 * 60 * 1000; // YouTube needs publishAt comfortably in the future

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const python = process.platform === "win32" ? "python" : "python3";

// Kill switch: while data/PAUSE exists, normal (cron / dispatch) runs make nothing. Test runs (DRY_RUN) and FORCE ignore it.
if (existsSync("data/PAUSE") && !process.env.DRY_RUN && !process.env.FORCE) {
  console.log("data/PAUSE exists: production is paused.");
  process.exit(0);
}

const log = existsSync(SCHEDULE) ? JSON.parse(readFileSync(SCHEDULE, "utf8")) : [];

// DAILY BATCH: every YouTube quota day (it resets at midnight Pacific time) DAILY_TARGET videos are made back to back,
// each one uploaded as a scheduled public video into the next free slot (or saved as a manual package when YouTube
// refuses). When the target is reached nothing more is made until the quota resets; the hourly triggers then start
// the next batch and every finished video starts the next one itself (see "Continue the batch" in upload.yml).
// Two triggers (GitHub cron + cron-job.org) firing together are harmless: the runs are serialized and the daily target caps them.
const pacificDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date(ms));
const madeToday = log.filter((l) => l.uploadedAt && pacificDay(Date.parse(l.uploadedAt)) === pacificDay(Date.now())).length;
if (!process.env.FORCE && madeToday >= DAILY_TARGET) {
  console.log(`Today's batch is complete (${madeToday}/${DAILY_TARGET} videos in the current quota day); next batch after the quota reset.`);
  process.exit(0);
}
// Safety net: never let the schedule run more than MAX_QUEUE videos ahead.
const queued = log.filter((l) => !l.cancelled && Date.parse(l.publishAt) > Date.now()).length;
if (!process.env.FORCE && queued >= MAX_QUEUE) {
  console.log(`${queued} videos already scheduled (limit ${MAX_QUEUE}), nothing to make now.`);
  process.exit(0);
}
// Tells the workflow to start the next run immediately while today's batch is not complete.
function continueBatchIfNeeded() {
  if (process.env.DRY_RUN || process.env.FORCE) return;
  if (madeToday + 1 < DAILY_TARGET) { mkdirSync("out", { recursive: true }); writeFileSync("out/continue-batch", String(madeToday + 1)); }
}

function nextFreeSlot() {
  const taken = new Set(log.filter((l) => !l.cancelled).map((l) => l.publishAt));
  const t = new Date(Date.now() + LEAD_MS);
  t.setUTCMinutes(0, 0, 0);
  for (let i = 0; i < 24 * 14; i++) {
    t.setUTCHours(t.getUTCHours() + 1);
    const iso = t.toISOString();
    if (HOURS.includes(t.getUTCHours()) && t.getTime() > Date.now() + LEAD_MS && !taken.has(iso)) return iso;
  }
  throw new Error("No free publish slot in the next 14 days");
}

mkdirSync("out", { recursive: true });
const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
const node = process.execPath;
const remotion = (composition, propsFile) => {
  // Rendering is deterministic but Chrome can flake on a busy runner: retry once before giving up.
  for (let attempt = 1; ; attempt++) {
    try {
      sh(node, ["node_modules/@remotion/cli/remotion-cli.js", "render", "src/index.ts", composition, "out/video.mp4", `--props=${propsFile}`, "--crf=23"]);
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      console.error("render failed, retrying once...");
    }
  }
};

// ---------- format 1: data ranking ----------
async function makeRanking() {
  const topic = await generateTopic();
  writeFileSync("data/current.json", JSON.stringify(topic, null, 2));
  writeFileSync("data/props.json", JSON.stringify(topic.props));
  console.log(`Ranking topic: ${topic.title}`);
  sh(node, ["scripts/fetch-assets.mjs", "data/props.json"]);
  // narrate.py exits non-zero when every TTS provider fails, which aborts the run (never a silent video)
  sh(python, ["scripts/narrate.py"], { env });
  remotion("Top5", "data/props.json");
  return { format: "ranking", key: topic.key, title: topic.title, description: topic.description, tags: topic.tags };
}

// ---------- Canlı Garaj: Turkish, source-grounded vehicle explainers ----------
const hashtag = (t) => t.toLowerCase().replace(/[^a-z0-9çğıöşü]/g, "");

async function makeGarage() {
  sh(node, ["scripts/story-script.mjs", ...(process.env.STORY_FIXTURE ? ["--fixture"] : [])]);
  const story = JSON.parse(readFileSync("data/story.json", "utf8"));
  const sc = story.script;
  console.log(`Garage: ${story.topic} -> ${sc.title}`);
  sh(node, ["scripts/story-assets.mjs"]);
  sh(python, ["scripts/story_narrate.py"], { env });
  remotion("Story", "data/story-props.json");
  const baseTags = ["shorts", "araba", "otomobil", "araç", "motor", "canlı garaj", "nasıl çalışır", "oto bilgi", "usta"];
  const tags = [...new Set([...baseTags, ...sc.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)])].slice(0, 15);
  const tagLine = ["shorts", "araba", "otomobil", "canlıgaraj", ...sc.tags.map(hashtag).filter((t) => t && t.length > 2)].slice(0, 8);
  // No source / credit lines on purpose: every image, clip, sound and music track used here needs no attribution
  // (Pexels, Pixabay, CC0, public domain), and the narration is our own wording of plain facts.
  const description = [
    sc.title, "", sc.payoff.text, "", sc.cta, "",
    "Bu video bilgilendirme amaçlıdır. Aracınla ilgili bir arıza şüphesinde yetkili bir servise başvur.",
    "", [...new Set(tagLine)].map((t) => `#${t}`).join(" "),
  ].join("\n");
  return { format: "garage", key: story.key, title: sc.title, description, tags, kind: story.vehicle ?? "car", category: story.category };
}

// Only the garage format is made (the old English ranking videos do not fit the channel any more).
// A failed attempt must never turn into an off-topic upload: the queue check at the top retries on the next trigger.
const wanted = process.env.FORMAT === "ranking" ? "ranking" : "garage";
rmSync("out/narration.m4a", { force: true });
let made;
try {
  made = wanted === "ranking" ? await makeRanking() : await makeGarage();
} catch (e) {
  console.error(`::warning::no video made this cycle: ${e.message}`);
  process.exit(process.env.DRY_RUN ? 1 : 0); // a normal cycle ends quietly (next trigger retries); a test run must show the failure
}

sh("ffmpeg", ["-y", "-loglevel", "error", "-i", "out/video.mp4", "-i", "out/narration.m4a",
  "-c:v", "copy", "-c:a", "aac", "-shortest", "out/final.mp4"]);

if (process.env.DRY_RUN) {
  console.log(`DRY_RUN set: built out/final.mp4 (${made.format}), not uploading.`);
  process.exit(0);
}

// ---- manual-upload package: when YouTube refuses the upload (daily API quota, auth...), the finished video is NOT lost.
// It is published as a GitHub Release (video + title + description + tags + suggested time) that can be opened on a phone,
// and scripts/sync-manual.mjs mirrors it into a folder on the PC.
const MAX_MANUAL_PER_DAY = Number(process.env.MAX_MANUAL_PER_DAY || 6);
function saveForManualUpload(reason) {
  const today = new Date().toISOString().slice(0, 10);
  if (log.filter((l) => l.manual && l.uploadedAt.startsWith(today)).length >= MAX_MANUAL_PER_DAY) {
    console.error(`::warning::manual packages for today are at the limit (${MAX_MANUAL_PER_DAY}); video dropped`);
    return false;
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);       // 202610041530
  const tag = `manual-${stamp}`;
  const slug = made.title.toLowerCase().replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "video";
  const video = `out/${slug}.mp4`;
  copyFileSync("out/final.mp4", video);
  let slot = "";
  try { slot = new Date(Date.parse(nextFreeSlot()) + 3 * 3600_000).toISOString().slice(0, 16).replace("T", " ") + " (TSİ)"; } catch { /* no slot info */ }
  const info = [
    "BAŞLIK", made.title, "",
    "AÇIKLAMA", made.description, "",
    "ETİKETLER (virgülle ayrılmış)", made.tags.join(", "), "",
    `ÖNERİLEN YAYIN SAATİ: ${slot || "fark etmez"}`,
    "KATEGORİ: Otomobil ve Araçlar   DİL: Türkçe   Çocuklara özel: Hayır", "",
    `Neden elle: ${reason}`,
  ].join("\n");
  const infoFile = `out/${slug}-bilgiler.txt`;
  writeFileSync(infoFile, info, "utf8");
  const notes = [
    `**Başlık** (kopyala-yapıştır)\n\n\`\`\`\n${made.title}\n\`\`\`\n`,
    `**Açıklama** (kopyala-yapıştır)\n\n\`\`\`\n${made.description}\n\`\`\`\n`,
    `**Etiketler**\n\n\`\`\`\n${made.tags.join(", ")}\n\`\`\`\n`,
    `**Önerilen yayın saati:** ${slot || "fark etmez"}\n`,
    "_YouTube'a elle yüklemek için videoyu indir; kategori Otomobil ve Araçlar, dil Türkçe, çocuklara özel değil._",
  ].join("\n");
  const notesFile = `out/${slug}-notes.md`;
  writeFileSync(notesFile, notes, "utf8");
  sh("gh", ["release", "create", tag, video, infoFile, "--title", made.title, "--notes-file", notesFile]);
  log.push({ id: tag, manual: true, format: made.format, key: made.key, title: made.title, uploadedAt: new Date().toISOString() });
  writeFileSync(SCHEDULE, JSON.stringify(log.slice(-500), null, 1));
  if (made.format === "garage") {
    const hp = "data/history.json";
    const h = existsSync(hp) ? JSON.parse(readFileSync(hp, "utf8")) : [];
    h.push({ key: made.key, at: new Date().toISOString() });
    writeFileSync(hp, JSON.stringify(h.slice(-2000), null, 1));
  }
  console.log(`Saved for manual upload: release ${tag} (${reason})`);
  return true;
}

const publishAt = nextFreeSlot();
let id;
try {
  if (process.env.TEST_MANUAL) throw new Error("test: pretending YouTube refused the upload (quotaExceeded)");
  id = await uploadToYouTube({ file: "out/final.mp4", title: made.title, description: made.description, tags: made.tags, publishAt });
} catch (e) {
  // YouTube's free API quota (10,000 units/day = 6 uploads) resets daily; running out is normal, not an error.
  // Whatever the reason, keep the finished video as a ready-to-upload package instead of losing it.
  const quota = /quotaExceeded|dailyLimitExceeded|uploadLimitExceeded|rateLimitExceeded/i.test(e.message);
  console.error(`::warning::upload failed (${e.message.slice(0, 160)}); saving the video for manual upload`);
  let saved = false;
  try { saved = saveForManualUpload(quota ? "YouTube günlük API kotası doldu" : `yükleme hatası: ${e.message.slice(0, 120)}`); } catch (err) { console.error(`manual package failed: ${err.message}`); }
  if (saved) continueBatchIfNeeded();   // the video exists as a package: the batch goes on
  process.exit(0);
}
log.push({ id, format: made.format, key: made.key, title: made.title, uploadedAt: new Date().toISOString(), publishAt });
writeFileSync(SCHEDULE, JSON.stringify(log.slice(-500), null, 1));
if (made.format === "garage") {
  // remember the topic so it is not repeated (rankings record themselves in generate-topic.mjs)
  const hp = "data/history.json";
  const h = existsSync(hp) ? JSON.parse(readFileSync(hp, "utf8")) : [];
  h.push({ key: made.key, at: new Date().toISOString() });
  writeFileSync(hp, JSON.stringify(h.slice(-2000), null, 1));
}
console.log(`Uploaded https://youtube.com/shorts/${id} (${made.format}) -> goes public at ${publishAt}  [${madeToday + 1}/${DAILY_TARGET} today]`);
// playlists by vehicle kind / topic; a failure here must never cost the upload (it is retried from data/playlist-queue.json)
if (made.format === "garage") {
  try {
    const r = await addToPlaylists({ videoId: id, kind: made.kind, category: made.category });
    console.log(`Playlists: ${r.done} done, ${r.waiting} waiting${r.blocked ? ` (${r.blocked})` : ""}`);
  } catch (e) { console.error(`::warning::playlist step failed: ${e.message.slice(0, 200)}`); }
}
continueBatchIfNeeded();
