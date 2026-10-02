// One full cycle: pick a video format -> make it -> upload (scheduled publish).
// Formats alternate for the A/B test: "ranking" (data Top 5) and "story" (verified fact story).
// Env: PUBLISH_HOURS_UTC="2,8,14,20"  MIN_GAP_HOURS=5  DRY_RUN=1  FORCE=1  FORMAT=ranking|story  STORY_FIXTURE=1
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { generateTopic } from "./generate-topic.mjs";
import { uploadToYouTube } from "./upload.mjs";

const SCHEDULE = "data/schedule.json";
const HOURS = (process.env.PUBLISH_HOURS_UTC || "2,8,14,20").split(",").map(Number);
const MIN_GAP_H = Number(process.env.MIN_GAP_HOURS || 5);
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

// ---------- format 2: verified fact story ----------
async function makeStory() {
  sh(node, ["scripts/story-script.mjs", ...(process.env.STORY_FIXTURE ? ["--fixture"] : [])]);
  const story = JSON.parse(readFileSync("data/story.json", "utf8"));
  const sc = story.script;
  console.log(`Story: ${story.topic} -> ${sc.title}`);
  sh(node, ["scripts/story-assets.mjs"]);
  sh(python, ["scripts/story_narrate.py"], { env });
  remotion("Story", "data/story-props.json");
  const tags = [...new Set(["shorts", "facts", "didyouknow", ...sc.tags.map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean)])].slice(0, 12);
  const description = [
    sc.title, "", sc.payoff.text, "", sc.cta, "",
    `Source: ${story.source.url} (Wikipedia, CC BY-SA)`,
    "Footage: Pexels, NASA, Wikimedia Commons. Music and sound effects: Freesound (CC0).",
    ...(JSON.parse(readFileSync("data/story-props.json", "utf8")).credits ?? []).map((c) => `Image: ${c}`),
    "",
    tags.map((t) => `#${t}`).join(" "),
  ].join("\n");
  return { format: "story", key: `story|${story.topic}`, title: sc.title, description, tags };
}

// Alternate the formats so both collect comparable data; a failed story never costs a video.
const wanted = process.env.FORMAT || (last?.format === "story" ? "ranking" : "story");
rmSync("out/narration.m4a", { force: true });
let made;
if (wanted === "story") {
  try {
    made = await makeStory();
  } catch (e) {
    console.error(`story format failed (${e.message}); making a ranking video instead`);
    rmSync("out/narration.m4a", { force: true });
    made = await makeRanking();
  }
} else {
  made = await makeRanking();
}

sh("ffmpeg", ["-y", "-loglevel", "error", "-i", "out/video.mp4", "-i", "out/narration.m4a",
  "-c:v", "copy", "-c:a", "aac", "-shortest", "out/final.mp4"]);

if (process.env.DRY_RUN) {
  console.log(`DRY_RUN set: built out/final.mp4 (${made.format}), not uploading.`);
  process.exit(0);
}

const publishAt = nextFreeSlot();
const id = await uploadToYouTube({ file: "out/final.mp4", title: made.title, description: made.description, tags: made.tags, publishAt });
log.push({ id, format: made.format, key: made.key, title: made.title, uploadedAt: new Date().toISOString(), publishAt });
writeFileSync(SCHEDULE, JSON.stringify(log.slice(-500), null, 1));
if (made.format === "story") {
  // remember the topic so it is not repeated (rankings record themselves in generate-topic.mjs)
  const hp = "data/history.json";
  const h = existsSync(hp) ? JSON.parse(readFileSync(hp, "utf8")) : [];
  h.push({ key: made.key, at: new Date().toISOString() });
  writeFileSync(hp, JSON.stringify(h.slice(-2000), null, 1));
}
console.log(`Uploaded https://youtube.com/shorts/${id} (${made.format}) -> goes public at ${publishAt}`);
