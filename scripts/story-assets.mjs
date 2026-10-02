// Story Shorts, step 2: the best visual for every scene, from several free libraries
// (see sources/media.mjs). Reads data/story.json, writes public/clips/story-<n>.(mp4|jpg)
// and data/story-props.json. A scene without a visual falls back to a moving gradient;
// this step never fails the build.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { findVisual, pexelsVideos } from "./sources/media.mjs";

const story = JSON.parse(readFileSync("data/story.json", "utf8"));
const KEY = process.env.PEXELS_API_KEY;
mkdirSync("public/clips", { recursive: true });

async function download(url, file, min = 0) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { "User-Agent": "shorts-factory/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < min) throw new Error("file too small");
  writeFileSync(file, buf);
}

const s = story.script;
const scenes = [
  { kind: "hook", text: s.hook.text, visual: s.hook.visual },
  ...s.beats.map((b) => ({ kind: "beat", text: b.text, visual: b.visual })),
  { kind: "payoff", text: s.payoff.text, visual: s.payoff.visual },
  { kind: "cta", text: s.cta, visual: s.payoff.visual },
];

const used = new Set(); // never show the same asset twice in one video
const credits = new Set();
const report = [];
for (let i = 0; i < scenes.length; i++) {
  const sc = scenes[i];
  if (sc.kind === "cta") { // the CTA reuses the hook's visual so the Short loops
    sc.clip = scenes[0].clip; sc.image = scenes[0].image;
    continue;
  }
  const queries = [...new Set([`${story.topic} ${sc.visual}`, sc.visual, story.topic])];
  try {
    let v = await findVisual(queries, used, { pexelsKey: KEY, spaceTopic: story.category === "space", topic: story.topic });
    if (!v && KEY) { // last resort: any stock clip about the topic itself
      v = (await pexelsVideos(story.topic, KEY)).find((x) => !used.has(x.id)) ?? null;
      if (v) used.add(v.id);
    }
    if (!v) { report.push(`${sc.kind}: none for "${sc.visual}"`); continue; }
    const ext = v.type === "video" ? "mp4" : "jpg";
    const rel = `clips/story-${i}.${ext}`;
    try {
      await download(v.url, `public/${rel}`, v.type === "image" ? 30_000 : 0);
    } catch (e) {
      if (!v.fallbackUrl) throw e;
      await download(v.fallbackUrl, `public/${rel}`, 5_000);
    }
    if (v.type === "video") sc.clip = rel; else sc.image = rel;
    if (v.credit) credits.add(v.credit);
    report.push(`${sc.kind}: ${v.type} from ${v.source} (relevance ${v.score?.toFixed?.(2) ?? "-"}) for "${sc.visual}"`);
  } catch (e) {
    report.push(`${sc.kind}: failed for "${sc.visual}" (${e.message})`);
  }
}

writeFileSync("data/story-props.json", JSON.stringify({ scenes, title: s.title, credits: [...credits] }));
console.log(report.map((r) => "  " + r).join("\n"));
console.log(`story visuals: ${scenes.filter((x) => x.clip || x.image).length}/${scenes.length}${KEY ? "" : " (no PEXELS_API_KEY)"}`);
