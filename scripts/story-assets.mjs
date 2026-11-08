// Story Shorts, step 2: the best visual for every scene, from several free libraries
// (see sources/media.mjs). Reads data/story.json, writes public/clips/story-<n>.(mp4|jpg)
// and data/story-props.json. A scene without a visual falls back to a moving gradient;
// this step never fails the build.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { findVisual, candidatePool, wikiArticleMedia, commonsCategoryMedia, tokenize, CATEGORY_CONTEXT } from "./sources/media.mjs";
import { trimBlackLead, isTooDark } from "./clip-utils.mjs";
import { checkVisual, pickBest } from "./vision.mjs";

const story = JSON.parse(readFileSync("data/story.json", "utf8"));
const KEY = process.env.PEXELS_API_KEY;
const PIXABAY = process.env.PIXABAY_API_KEY;
const MAX_BYTES = 70 * 1024 * 1024;
const HOOK_MIN_LUMA = Number(process.env.HOOK_MIN_LUMA || 90);   // the opening shot must be bright (average of 0-255)
mkdirSync("public/clips", { recursive: true });

async function download(url, file, min = 0, minLuma = 65) {
  const res = await fetch(url, { signal: AbortSignal.timeout(90_000), headers: { "User-Agent": "shorts-factory/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("file too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < min) throw new Error("file too small");
  writeFileSync(file, buf);
  if (/\.(mp4|webm)$/i.test(file)) {
    try { const cut = trimBlackLead(file); if (cut) console.log(`  trimmed ${cut.toFixed(1)}s of black from the start of ${file}`); } catch { /* keep the clip as downloaded */ }
  }
  if (/\.(mp4|webm|jpe?g|png)$/i.test(file)) {
    let dark = false;
    try { dark = isTooDark(file, minLuma); } catch { /* unknown brightness: keep */ }
    if (dark) { rmSync(file, { force: true }); throw new Error("too dark"); }       // the caller moves on to the next candidate
  }
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
const POOLS = {
  car: ["car driving road", "car engine close up", "mechanic repairing car", "car wheel close up", "car brake disc",
    "garage workshop tools", "highway traffic cars", "engine bay open hood", "car tire road", "car exhaust pipe", "car suspension wheel"],
  motorcycle: ["motorcycle riding road", "motorcycle engine close up", "motorcycle mechanic", "motorcycle wheel", "motorcycle rider helmet",
    "motorcycle exhaust", "motorcycle chain close up", "motorcycle dashboard"],
  train: ["train railway tracks", "locomotive close up", "train passing station", "railway wheels", "train interior"],
  aircraft: ["airplane flying sky", "airplane engine close up", "airplane cockpit", "airport runway takeoff", "helicopter flying"],
  ship: ["ship at sea", "cargo ship ocean", "ship engine room", "ship bow waves", "port harbor ships"],
  machine: ["excavator digging", "construction site machinery", "bulldozer working", "forklift warehouse", "crane lifting"],
  truck: ["truck driving highway", "truck engine close up", "bus city street", "truck wheels road", "truck loading"],
};
// A topic's footage may ONLY show its own kind of vehicle: these words are blocked for everything else
const KIND_WORDS = {
  car: "car cars automobile sedan suv hatchback", motorcycle: "motorcycle motorbike scooter moped",
  train: "train railway railroad locomotive tram rail", aircraft: "aircraft airplane airport helicopter jet aviation plane",
  ship: "ship boat vessel submarine harbor yacht sailing", machine: "excavator bulldozer crane forklift tractor construction",
  truck: "truck lorry bus trailer",
};
const kind = story.vehicle ?? "car";
const fallbackQueries = POOLS[kind] ?? POOLS.car;
const extraBlock = Object.entries(KIND_WORDS).filter(([k]) => k !== kind).flatMap(([, w]) => w.split(" "))
  .concat(["bicycle", "skyline", "cartoon", "clipart"])
  // a truck or a machine topic may legitimately show trucks/cars on the road; keep those words only for the car/motorcycle kinds
  .filter((w) => !(["truck", "machine"].includes(kind) && ["car", "cars", "automobile"].includes(w)));
const report = [];

/**
 * Finds, vision-checks and downloads one clip for a scene. Returns { rel, type } or null.
 * `suffix` "" is the scene's main clip, "b" its second shot. The hook must be a bright VIDEO: the first second decides
 * whether a viewer swipes away (56.9 % did on this channel), and a dark or still opening is the worst start.
 * If a candidate cannot be downloaded or fails the check, its id stays in `used` and the next best is tried.
 */
async function acquire(sc, i, suffix, { videoOnly = false, minLuma = 65, attempts = 4 } = {}) {
  let queries = [...new Set(suffix ? [sc.visual, `${story.topic} ${sc.visual}`, story.topic] : [`${story.topic} ${sc.visual}`, sc.visual, story.topic])];
  const tag = `${sc.kind}${suffix ? "/2" : ""}`;
  // Gemini often writes a very specific search ("vintage open top truck driving") that stock libraries have never heard of.
  // When the full description finds nothing, the same scene is searched again with its first three words; the vision check
  // then decides whether what turned up really shows the sentence.
  const short = sc.visual.split(/\s+/).slice(0, 3).join(" ");
  const variants = short === sc.visual ? [sc.visual] : [sc.visual, short];
  let variant = 0;
  let opts = { pexelsKey: KEY, pixabayKey: PIXABAY, spaceTopic: story.category === "space", topic: story.topic, visual: variants[0], context, categoryWords, article, strict: true, extraBlock, videoOnly };
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // no loose guesses: a scene without a real match gets generic footage of the right vehicle kind (pool below)
      const v = await findVisual(queries, used, opts);
      if (!v) {
        if (variant + 1 < variants.length) { variant++; opts = { ...opts, visual: variants[variant] }; queries = [...new Set([variants[variant], `${story.topic} ${variants[variant]}`, ...queries])]; report.push(`${tag}: nothing for "${sc.visual}", retrying as "${variants[variant]}"`); continue; }
        report.push(`${tag}: none for "${sc.visual}"`);
        return null;
      }
      const look = await checkVisual(v.preview, { sentence: sc.text, visual: sc.visual, vehicle: kind === "machine" ? "machine" : kind, hook: sc.kind === "hook" });
      if (!look.ok) { report.push(`${tag}: rejected ${v.id} by vision (match ${look.match}, striking ${look.striking}, ${look.problem}: ${look.seen})`); continue; }
      const ext = v.type === "video" ? (/\.webm(\?|$)/i.test(v.url) ? "webm" : "mp4") : "jpg";
      const rel = `clips/story-${i}${suffix}.${ext}`;
      try {
        await download(v.url, `public/${rel}`, v.type === "image" ? 30_000 : 0, minLuma);
      } catch (e) {
        if (!v.fallbackUrl || e.message === "too dark") { report.push(`${tag}: ${v.source} download failed (${e.message}), trying next`); continue; }
        await download(v.fallbackUrl, `public/${rel}`, 5_000, minLuma);
      }
      if (v.credit) credits.add(v.credit);
      report.push(`${tag}: ${v.type} from ${v.source} (scene ${v.scene?.toFixed?.(2)}, topic ${v.about?.toFixed?.(2)}, vision ${look.skipped ? `skipped: ${look.why}` : `${look.match}/${look.striking} ${look.model}`}) for "${sc.visual}" <- ${String(v.hay ?? "").slice(0, 60)}`);
      return { rel, type: v.type };
    } catch (e) {
      report.push(`${tag}: failed for "${sc.visual}" (${e.message})`);
    }
  }
  return null;
}
const KIND_QUERY = { car: "car", motorcycle: "motorcycle", train: "train", aircraft: "airplane", ship: "ship", machine: "construction machine", truck: "truck" };

/**
 * VISION-FIRST footage for one scene (the main path). Up to three rounds of searching Pexels + Pixabay (the full description,
 * a shortened one, then generic footage of the vehicle kind); every round collects a broad pool of videos and Gemini compares
 * their preview frames in ONE request. The best acceptable clip becomes the scene's main shot and the runner-up its second shot,
 * so the second shot costs no extra request. Rejected candidates are never offered again. Returns { rel, type, rel2? } or null.
 * If Gemini is unavailable the pool order is used unchecked (the brightness test still applies), exactly like before.
 */
async function acquireByVision(sc, i) {
  const hook = sc.kind === "hook";
  const minLuma = hook ? HOOK_MIN_LUMA : 65;
  const ctx = { sentence: sc.text, visual: sc.visual, vehicle: kind === "machine" ? "machine" : kind, hook };
  const words = sc.visual.split(/\s+/);
  const generic = [...fallbackQueries].sort(() => Math.random() - 0.5).slice(0, 2);
  const rounds = [
    { qs: [sc.visual, `${story.topic} ${sc.visual}`], visual: sc.visual },
    { qs: [words.slice(0, 3).join(" "), `${KIND_QUERY[kind] ?? "car"} ${words.slice(-2).join(" ")}`], visual: words.slice(0, 3).join(" ") },
    // last round: no clip shows the exact thing, so generic footage of this vehicle kind is rated as a GENERAL shot for the topic
    { qs: [...generic, `${KIND_QUERY[kind] ?? "car"} ${story.topic}`], visual: "", lenient: true },
  ];
  for (const [r, round] of rounds.entries()) {
    const pool = await candidatePool(round.qs, used, { pexelsKey: KEY, pixabayKey: PIXABAY, extraBlock, visual: round.visual, limit: 8, photos: r === rounds.length - 1 && !hook, commons: r < 2 });
    if (!pool.length) { report.push(`${sc.kind}: round ${r + 1} found no candidates for "${round.qs[0]}"`); continue; }
    const pick = await pickBest(pool, { ...ctx, lenient: Boolean(round.lenient), topic: story.topic });
    for (const x of pick.rejected) { used.add(x.c.id); report.push(`${sc.kind}: rejected ${x.c.id} (match ${x.match}, striking ${x.striking}, ${x.problem}: ${x.seen})`); }
    if (pick.skipped) report.push(`${sc.kind}: vision skipped (${pick.why}), using the search order`);
    const got = [];
    // without a vision verdict only the well-labelled libraries are trusted (Wikimedia titles say little about what is on screen)
    const candidates = pick.skipped ? pick.ranked.filter((x) => ["Pexels", "Pixabay"].includes(x.c.source)) : pick.ranked;
    for (const item of candidates) {
      if (got.length >= 2) break;
      const c = item.c;
      used.add(c.id);
      if (got.length && c.type !== "video") continue;              // the second shot must be a video
      const rel = `clips/story-${i}${got.length ? "b" : ""}.${c.type === "video" ? "mp4" : "jpg"}`;
      try {
        try { await download(c.url, `public/${rel}`, c.type === "image" ? 30_000 : 0, got.length ? 65 : minLuma); }
        catch (e) { if (!c.fallbackUrl || e.message === "too dark") throw e; await download(c.fallbackUrl, `public/${rel}`, 5_000, minLuma); }
      } catch (e) { report.push(`${sc.kind}: ${c.source} ${c.id} download failed (${e.message})`); continue; }
      if (c.credit) credits.add(c.credit);
      got.push({ rel, type: c.type, item });
      report.push(`${sc.kind}${got.length > 1 ? "/2" : ""}: ${c.type} ${c.id} from ${c.source} (vision ${item.match ?? "-"}/${item.striking ?? "-"}, ${item.seen ?? "unchecked"}) round ${r + 1} for "${sc.visual}"`);
      if (c.type !== "video") break;                                // a photo scene has no second shot
    }
    if (got.length) return { rel: got[0].rel, type: got[0].type, rel2: got[1]?.rel };
  }
  return null;
}

for (let i = 0; i < scenes.length; i++) {
  const sc = scenes[i];
  if (sc.kind === "cta") { // the CTA reuses the hook's visual so the Short loops
    sc.clip = scenes[0].clip; sc.image = scenes[0].image;
    continue;
  }
  const got = (await acquireByVision(sc, i)) ?? (await acquire(sc, i, "", { videoOnly: sc.kind === "hook", minLuma: sc.kind === "hook" ? HOOK_MIN_LUMA : 65, attempts: 4 }));
  if (got) { if (got.type === "video") sc.clip = got.rel; else sc.image = got.rel; if (got.rel2) sc.clip2 = got.rel2; }
}

// scenes that found nothing: search the generic pool of this kind of vehicle (still never an off-topic clip)
for (let i = 0; i < scenes.length; i++) {
  const sc = scenes[i];
  if (sc.kind === "cta" || sc.clip || sc.image) continue;
  for (const q of [...fallbackQueries].sort(() => Math.random() - 0.5)) {
    try {
      const v = await findVisual([q], used, { pexelsKey: KEY, pixabayKey: PIXABAY, topic: "", visual: q, context, categoryWords, strict: true, extraBlock, videoOnly: sc.kind === "hook" });
      if (!v) continue;
      const rel = `clips/story-${i}.${v.type === "video" ? "mp4" : "jpg"}`;
      await download(v.url, `public/${rel}`, v.type === "image" ? 30_000 : 0, sc.kind === "hook" ? HOOK_MIN_LUMA : 65);
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
  accent: "#ff7a1a", lang: story.lang ?? "tr", ctaLabel: story.lang === "en" ? "COMMENT YOUR ANSWER 👇" : "CEVABINI YORUMA YAZ 👇", subLabel: story.lang === "en" ? "FOLLOW 🔔" : "TAKİP ET 🔔", likeLabel: story.lang === "en" ? "👍 LIKE" : "👍 BEĞEN",   // works on YouTube and Instagram brand: "CANLI GARAJ",
}));
console.log(report.map((r) => "  " + r).join("\n"));
console.log(`story visuals: ${scenes.filter((x) => x.clip || x.image).length}/${scenes.length}${KEY ? "" : " (no PEXELS_API_KEY)"}`);
