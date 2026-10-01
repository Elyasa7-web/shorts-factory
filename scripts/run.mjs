// One full cycle: pick topic -> narrate -> render -> mux -> upload (scheduled publish).
// Env: PUBLISH_HOURS_UTC="2,6,10,14,18,22"  MIN_GAP_HOURS=3  DRY_RUN=1  FORCE=1
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { generateTopic } from "./generate-topic.mjs";
import { uploadToYouTube } from "./upload.mjs";

const SCHEDULE = "data/schedule.json";
const HOURS = (process.env.PUBLISH_HOURS_UTC || "2,6,10,14,18,22").split(",").map(Number);
const MIN_GAP_H = Number(process.env.MIN_GAP_HOURS || 3);
const LEAD_MS = 45 * 60 * 1000; // YouTube needs publishAt comfortably in the future

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const python = process.platform === "win32" ? "python" : "python3";

const log = existsSync(SCHEDULE) ? JSON.parse(readFileSync(SCHEDULE, "utf8")) : [];

// Two triggers (GitHub cron + cron-job.org) can fire close together: upload only once per gap.
const last = log.at(-1);
if (last && !process.env.FORCE && Date.now() - Date.parse(last.uploadedAt) < MIN_GAP_H * 3600_000) {
  console.log(`Last upload was ${last.uploadedAt}; < ${MIN_GAP_H}h ago, skipping.`);
  process.exit(0);
}

function nextFreeSlot() {
  const taken = new Set(log.map((l) => l.publishAt));
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
const topic = await generateTopic();
writeFileSync("data/current.json", JSON.stringify(topic, null, 2));
writeFileSync("data/props.json", JSON.stringify(topic.props));
console.log(`Topic: ${topic.title}`);

// Never reuse a stale voice track, and never publish a silent video: narrate.py
// exits non-zero when every TTS provider fails, which aborts this run (retry next cycle).
rmSync("out/narration.m4a", { force: true });
sh(process.execPath, ["scripts/fetch-assets.mjs", "data/props.json"]);
sh(python, ["scripts/narrate.py"], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
// Rendering is deterministic but Chrome can flake on a busy runner: retry once before giving up.
for (let attempt = 1; ; attempt++) {
  try {
    sh(process.execPath, ["node_modules/@remotion/cli/remotion-cli.js", "render", "src/index.ts", "Top5", "out/video.mp4", "--props=data/props.json"]);
    break;
  } catch (e) {
    if (attempt === 2) throw e;
    console.error("render failed, retrying once...");
  }
}
sh("ffmpeg", ["-y", "-loglevel", "error", "-i", "out/video.mp4", "-i", "out/narration.m4a",
  "-c:v", "copy", "-c:a", "aac", "-shortest", "out/final.mp4"]);

if (process.env.DRY_RUN) {
  console.log("DRY_RUN set: built out/final.mp4, not uploading.");
  process.exit(0);
}

const publishAt = nextFreeSlot();
const id = await uploadToYouTube({
  file: "out/final.mp4",
  title: topic.title,
  description: topic.description,
  tags: topic.tags,
  publishAt,
});
log.push({ id, key: topic.key, title: topic.title, uploadedAt: new Date().toISOString(), publishAt });
writeFileSync(SCHEDULE, JSON.stringify(log.slice(-500), null, 1));
console.log(`Uploaded https://youtube.com/shorts/${id} -> goes public at ${publishAt}`);
