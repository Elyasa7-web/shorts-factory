// Story Shorts, step 2: one stock clip per scene (hook, beats, payoff) from Pexels (royalty-free).
// Reads data/story.json, writes public/clips/story-<n>.mp4 and data/story-props.json.
// A scene without a clip simply falls back to a gradient backdrop; this never fails the build.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const story = JSON.parse(readFileSync("data/story.json", "utf8"));
const KEY = process.env.PEXELS_API_KEY;
mkdirSync("public/clips", { recursive: true });

async function download(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// prefer portrait, close to 1080x1920, not huge
function bestFile(video) {
  const files = video.video_files.filter((f) => f.file_type === "video/mp4" && f.width >= 540 && f.height <= 2600);
  if (!files.length) return null;
  const portrait = files.filter((f) => f.height >= f.width);
  return (portrait.length ? portrait : files).sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
}

const used = new Set(); // never show the same clip twice in one video
async function findClip(query) {
  for (const orientation of ["portrait", undefined]) {
    const params = new URLSearchParams({ query, per_page: "15", size: "medium" });
    if (orientation) params.set("orientation", orientation);
    const res = await fetch(`https://api.pexels.com/videos/search?${params}`, {
      headers: { Authorization: KEY },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Pexels ${res.status}`);
    const { videos = [] } = await res.json();
    const pool = videos.filter((v) => v.duration >= 4 && !used.has(v.id) && bestFile(v));
    if (pool.length) {
      const v = pool[Math.floor(Math.random() * Math.min(pool.length, 5))];
      used.add(v.id);
      return bestFile(v);
    }
  }
  return null;
}

const s = story.script;
const scenes = [
  { kind: "hook", text: s.hook.text, visual: s.hook.visual },
  ...s.beats.map((b) => ({ kind: "beat", text: b.text, visual: b.visual })),
  { kind: "payoff", text: s.payoff.text, visual: s.payoff.visual },
  { kind: "cta", text: s.cta, visual: s.payoff.visual },
];

let got = 0;
for (let i = 0; i < scenes.length; i++) {
  const sc = scenes[i];
  if (!KEY) continue;
  try {
    // the CTA reuses the hook's footage so the Short loops visually
    if (sc.kind === "cta") { sc.clip = scenes[0].clip; continue; }
    const f = (await findClip(sc.visual)) ?? (await findClip(story.topic));
    if (f) {
      sc.clip = `clips/story-${i}.mp4`;
      await download(f.link, `public/${sc.clip}`);
      got++;
    } else {
      console.error(`no clip for "${sc.visual}"`);
    }
  } catch (e) {
    console.error(`clip for "${sc.visual}" failed (${e.message})`);
  }
}

writeFileSync("data/story-props.json", JSON.stringify({ scenes, title: s.title }));
console.log(`story assets: ${got}/${scenes.length - 1} clips${KEY ? "" : " (no PEXELS_API_KEY)"}`);
