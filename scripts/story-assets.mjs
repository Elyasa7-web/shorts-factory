// Story Shorts, step 2: the best visual for every scene, from several free libraries
// (see sources/media.mjs). Reads data/story.json, writes public/clips/story-<n>.(mp4|jpg)
// and data/story-props.json. A scene without a visual falls back to a moving gradient;
// this step never fails the build.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { findVisual, pexelsVideos, wikiArticleMedia, commonsCategoryMedia, tokenize, CATEGORY_CONTEXT } from "./sources/media.mjs";

const story = JSON.parse(readFileSync("data/story.json", "utf8"));
const KEY = process.env.PEXELS_API_KEY;
const PIXABAY = process.env.PIXABAY_API_KEY;
const MAX_BYTES = 70 * 1024 * 1024;
mkdirSync("public/clips", { recursive: true });

async function download(url, file, min = 0) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { "User-Agent": "shorts-factory/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("file too large");
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
// the story's own vocabulary + the category's words: what a clip must share to count as "the same thing" as the topic
// scene words (ocean, coral, reef...) are generic, so a clip needs two of them; a category word (marine, aquarium...) alone is enough
const context = new Set(tokenize([s.hook, ...s.beats, s.payoff].map((x) => x.visual).join(" ")));
const categoryWords = new Set(tokenize(CATEGORY_CONTEXT[story.category] ?? ""));
// media that is KNOWN to show the topic: the Wikipedia article's own files + the topic's Commons category
const exact = [];
for (const [name, fn] of [["article", wikiArticleMedia], ["commons category", commonsCategoryMedia]]) {
  try { exact.push(...(await fn(story.source?.title ?? story.topic))); } catch (e) { console.error(`${name} media failed: ${e.message}`); }
}
const article = [...new Map(exact.map((c) => [c.id, c])).values()];
console.log(`  topic-exact media: ${article.length} files (${article.filter((a) => a.type === "video").length} videos)`);
const credits = new Set();

// If nothing matches a scene's own description, search generic footage of the right KIND of vehicle instead of
// reusing an old clip or showing an unrelated one (a rack-and-pinion topic once returned a mountain railway).
const CAR_POOL = ["car driving road", "car engine close up", "mechanic repairing car", "car wheel close up", "car steering wheel",
  "car dashboard", "garage workshop tools", "highway traffic cars", "car brake disc", "car interior driver", "engine bay open hood", "car tire road"];
const FALLBACK = {
  motosiklet: ["motorcycle riding road", "motorcycle engine close up", "motorcycle mechanic", "motorcycle wheel", "motorcycle rider helmet", "motorcycle exhaust"],
  "agir-vasita": ["truck driving highway", "excavator construction", "bus city street", "heavy machinery", "tractor field", "crane construction"],
  "diger-arac": [`${story.topic}`, `${story.topic} moving`, `${story.topic} close up`],
};
const fallbackQueries = FALLBACK[story.category] ?? CAR_POOL;
// words that mean "wrong vehicle / not a photo" for car and motorcycle topics (trains, planes, boats, cartoons)
const OFF_VEHICLE = "train railway railroad locomotive tram cog funicular aircraft airplane airport helicopter ship boat bicycle bike skyline";
const extraBlock = ["motor", "aktarma", "fren-suspansiyon", "elektrik-guvenlik", "elektrikli", "motosiklet"].includes(story.category)
  ? OFF_VEHICLE.split(" ").filter((w) => !(story.category === "motosiklet" && w === "bike")) : [];
const report = [];
for (let i = 0; i < scenes.length; i++) {
  const sc = scenes[i];
  if (sc.kind === "cta") { // the CTA reuses the hook's visual so the Short loops
    sc.clip = scenes[0].clip; sc.image = scenes[0].image;
    continue;
  }
  const queries = [...new Set([`${story.topic} ${sc.visual}`, sc.visual, story.topic])];
  const opts = { pexelsKey: KEY, pixabayKey: PIXABAY, spaceTopic: story.category === "space", topic: story.topic, visual: sc.visual, context, categoryWords, article, strict: true, extraBlock };
  let done = false;
  // up to 4 attempts: if the best candidate cannot be downloaded, its id stays in `used` and the next best is tried
  for (let attempt = 0; attempt < 4 && !done; attempt++) {
    try {
      let v = await findVisual(queries, used, opts);
      if (!v && KEY) { // last resort: any stock clip about the topic itself
        v = (await pexelsVideos(story.topic, KEY)).find((x) => !used.has(x.id)) ?? null;
        if (v) used.add(v.id);
      }
      if (!v) { report.push(`${sc.kind}: none for "${sc.visual}"`); break; }
      const ext = v.type === "video" ? (/\.webm(\?|$)/i.test(v.url) ? "webm" : "mp4") : "jpg";
      const rel = `clips/story-${i}.${ext}`;
      try {
        await download(v.url, `public/${rel}`, v.type === "image" ? 30_000 : 0);
      } catch (e) {
        if (!v.fallbackUrl) { report.push(`${sc.kind}: ${v.source} download failed (${e.message}), trying next`); continue; }
        await download(v.fallbackUrl, `public/${rel}`, 5_000);
      }
      if (v.type === "video") sc.clip = rel; else sc.image = rel;
      if (v.credit) credits.add(v.credit);
      used.add(v.id);
      report.push(`${sc.kind}: ${v.type} from ${v.source} (scene ${v.scene?.toFixed?.(2)}, topic ${v.about?.toFixed?.(2)}, pool ${v.poolSize}) for "${sc.visual}" <- ${String(v.hay ?? "").slice(0, 60)}`);
      done = true;
    } catch (e) {
      report.push(`${sc.kind}: failed for "${sc.visual}" (${e.message})`);
    }
  }
}

// scenes that found nothing: search the generic pool of this kind of vehicle (still never an off-topic clip)
for (let i = 0; i < scenes.length; i++) {
  const sc = scenes[i];
  if (sc.kind === "cta" || sc.clip || sc.image) continue;
  for (const q of [...fallbackQueries].sort(() => Math.random() - 0.5)) {
    try {
      const v = await findVisual([q], used, { pexelsKey: KEY, pixabayKey: PIXABAY, topic: "", visual: q, context, categoryWords, strict: true, extraBlock });
      if (!v) continue;
      const rel = `clips/story-${i}.${v.type === "video" ? "mp4" : "jpg"}`;
      await download(v.url, `public/${rel}`, v.type === "image" ? 30_000 : 0);
      if (v.type === "video") sc.clip = rel; else sc.image = rel;
      if (v.credit) credits.add(v.credit);
      report.push(`${sc.kind}: generic ${v.type} from ${v.source} for "${q}" (scene wanted "${sc.visual}")`);
      break;
    } catch (e) { /* try the next generic query */ }
  }
}

// the CTA reuses the hook's visual so the Short loops
for (const sc of scenes) if (sc.kind === "cta") { sc.clip = scenes[0].clip; sc.image = scenes[0].image; }

// a scene with no footage reuses a good one from this video (the camera move differs per scene) instead of a bare gradient
const withMedia = scenes.filter((x) => x.kind !== "cta" && (x.clip || x.image));
let k = 0;
for (const sc of scenes) {
  if (sc.kind === "cta" || sc.clip || sc.image || !withMedia.length) continue;
  const src = withMedia[k++ % withMedia.length];
  sc.clip = src.clip; sc.image = src.image;
  report.push(`${sc.kind}: reused footage from another scene for "${sc.visual}"`);
}

writeFileSync("data/story-props.json", JSON.stringify({
  scenes, title: s.title, credits: [...credits],
  accent: "#ff7a1a", lang: story.lang ?? "tr", ctaLabel: story.lang === "en" ? "COMMENT YOUR ANSWER 👇" : "CEVABINI YORUMA YAZ 👇", brand: "CANLI GARAJ",
}));
console.log(report.map((r) => "  " + r).join("\n"));
console.log(`story visuals: ${scenes.filter((x) => x.clip || x.image).length}/${scenes.length}${KEY ? "" : " (no PEXELS_API_KEY)"}`);
