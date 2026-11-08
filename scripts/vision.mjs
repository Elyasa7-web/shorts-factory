// Gemini vision check for stock-footage candidates. The text search ranks clips by their tags, which cannot tell
// "car brake disc" from a dark parking-lot clip tagged "car". This looks at the clip's preview image instead and
// answers: does it show what the sentence is about, and is it a clip worth opening a Short with?
//
// FAIL-OPEN by design: no key, a quota error, a timeout or an unreadable answer all return { ok: true, skipped: true },
// so the video pipeline never breaks because of this check. It also stops calling Gemini after repeated failures.
// Model names rotate (the 2.x ones were retired by Nov 2026 and the newest are often over quota), so the list comes from
// ListModels exactly like story-script.mjs does: the newest stable flash models first, the next one when a model answers 404/429/5xx.
let modelList = null;
async function visionModels() {
  if (process.env.GEMINI_VISION_MODEL) return [process.env.GEMINI_VISION_MODEL];
  if (modelList) return modelList;
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(20_000),
    });
    const { models = [] } = await res.json();
    const ver = (n) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    modelList = models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace("models/", ""))
      .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n))
      .sort((a, b) => ver(b) - ver(a) || (a.includes("lite") ? 1 : 0) - (b.includes("lite") ? 1 : 0))
      .slice(0, 5);
  } catch (e) { console.error(`  vision: model discovery failed (${e.message})`); }
  if (!modelList?.length) modelList = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
  return modelList;
}
const MIN_GAP_MS = 4500;        // the free tier allows roughly 10 requests per minute
const MAX_CALLS = Number(process.env.VISION_MAX_CALLS || 24);
const MAX_FAILURES = 3;         // consecutive infrastructure failures before the check switches itself off
const MIN_MATCH = Number(process.env.VISION_MIN_MATCH || 6);
const BAD = new Set(["text_overlay", "cartoon", "wrong_vehicle", "dark", "people_only", "blurry"]);

const SCHEMA = {
  type: "OBJECT",
  properties: {
    match: { type: "INTEGER" },
    striking: { type: "INTEGER" },
    problem: { type: "STRING" },
    seen: { type: "STRING" },
  },
  required: ["match", "striking", "problem", "seen"],
};

let calls = 0;
let failures = 0;
let lastCall = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = (why) => ({ ok: true, skipped: true, why });

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "User-Agent": "shorts-factory/1.0" } });
  if (!res.ok) throw new Error(`preview HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2_000 || buf.length > 4_000_000) throw new Error(`preview size ${buf.length}`);
  const type = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return { data: buf.toString("base64"), mimeType: /^image\//.test(type) ? type : "image/jpeg" };
}

/**
 * @param {string} previewUrl  thumbnail of the candidate clip or photo
 * @param {{ sentence: string, visual: string, vehicle?: string, hook?: boolean }} ctx
 * @returns {Promise<{ok: boolean, skipped?: boolean, match?: number, striking?: number, problem?: string, seen?: string, why?: string}>}
 */
export async function checkVisual(previewUrl, { sentence, visual, vehicle = "car", hook = false }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || !previewUrl) return pass("no key or preview");
  if (process.env.VISION_OFF) return pass("disabled");
  if (calls >= MAX_CALLS) return pass("call budget used");
  if (failures >= MAX_FAILURES) return pass("switched off after repeated failures");

  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  calls++;

  const prompt = `You pick background footage for a vertical YouTube Short about ${vehicle}s. The narrator says (Turkish): "${sentence}"
We searched stock footage for: "${visual}". The image is the preview frame of one candidate clip.
Answer as JSON:
- match (0-10): how clearly the frame shows what the sentence is about (the named part, action or situation, on the right kind of vehicle). 0 = unrelated or the wrong vehicle, 10 = exactly it.
- striking (0-10): would a thumb-scrolling viewer stop for this frame? Bright, sharp, close, with motion or a clear subject = high. Dark, empty, flat, cluttered = low.${hook ? " This frame opens the video, so be strict." : ""}
- problem: one of none, text_overlay (visible text, logos, watermarks), cartoon (drawing or 3D render), wrong_vehicle (not a ${vehicle}), dark, people_only (a person's face or a crowd with no vehicle subject), blurry.
- seen: at most 8 English words saying what the frame shows.`;

  const image = await fetchImage(previewUrl).catch((e) => { console.error(`  vision: ${e.message}`); return null; });
  if (!image) return pass("preview unavailable");

  let lastError = "";
  for (const model of await visionModels()) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: image }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (!res.ok) { lastError = `${model} HTTP ${res.status}`; if (/^(404|429|5\d\d)$/.test(String(res.status))) continue; throw new Error(lastError); }
      const out = JSON.parse((await res.json()).candidates[0].content.parts[0].text);
      failures = 0;
      const match = Number(out.match), striking = Number(out.striking), problem = String(out.problem || "none");
      if (!Number.isFinite(match) || !Number.isFinite(striking)) return pass("unreadable answer");
      const ok = match >= MIN_MATCH && !BAD.has(problem) && (!hook || striking >= 5);
      return { ok, match, striking, problem, seen: String(out.seen || "").slice(0, 80), model };
    } catch (e) {
      lastError = `${model}: ${String(e.message).slice(0, 80)}`;
    }
  }
  failures++;
  console.error(`  vision: every model failed (${lastError}); the candidate is accepted unchecked`);
  return pass(`all models failed: ${lastError}`);
}

export function visionAvailable() {
  return Boolean(process.env.GEMINI_API_KEY) && !process.env.VISION_OFF && calls < MAX_CALLS && failures < MAX_FAILURES;
}

const PICK_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { index: { type: "INTEGER" }, match: { type: "INTEGER" }, striking: { type: "INTEGER" }, problem: { type: "STRING" }, seen: { type: "STRING" } },
        required: ["index", "match", "striking", "problem", "seen"],
      },
    },
  },
  required: ["items"],
};

/**
 * Looks at the preview frames of several candidates in ONE Gemini request and rates each against the sentence.
 * Returns { skipped, why, ranked, rejected }: `ranked` = the acceptable candidates, best first (each { c, match, striking, problem, seen });
 * `rejected` = the rest with their verdict. When Gemini cannot be used (no key, quota, errors) the answer is { skipped: true } and
 * `ranked` is the unchecked input order, so the caller keeps working exactly as before.
 */
export async function pickBest(cands, { sentence, visual, vehicle = "car", hook = false }) {
  const unchecked = (why) => ({ skipped: true, why, ranked: cands.map((c) => ({ c })), rejected: [] });
  if (!cands.length) return { skipped: false, ranked: [], rejected: [] };
  if (!visionAvailable()) return unchecked("vision unavailable");

  const loaded = (await Promise.all(cands.map((c) => fetchImage(c.preview).then((image) => ({ c, image })).catch(() => null)))).filter(Boolean);
  if (!loaded.length) return unchecked("previews unavailable");

  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  calls++;

  const prompt = `You pick background footage for a vertical YouTube Short about ${vehicle}s. The narrator says (Turkish): "${sentence}"
We searched stock footage for: "${visual}". Below are ${loaded.length} numbered preview frames of candidate clips.
Rate EVERY image (index = its number):
- match (0-10): how clearly the frame shows what the sentence is about (the named part, action or situation, on the right kind of vehicle). 0 = unrelated or the wrong vehicle, 10 = exactly it.
- striking (0-10): would a thumb-scrolling viewer stop for it? Bright, sharp, close, clear subject or motion = high. Dark, empty, flat, cluttered = low.${hook ? " This is the OPENING shot of the video: be strict." : ""}
- problem: one of none, text_overlay (visible text, logos, watermarks), cartoon (drawing, diagram or 3D render), wrong_vehicle (not a ${vehicle}), dark, people_only (a person or crowd with no vehicle subject), blurry.
- seen: at most 8 English words saying what the frame shows.`;
  const parts = [{ text: prompt }];
  loaded.forEach(({ image }, k) => parts.push({ text: `Image ${k + 1}:` }, { inlineData: image }));

  let lastError = "";
  for (const model of await visionModels()) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: PICK_SCHEMA },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) { lastError = `${model} HTTP ${res.status}`; if (/^(404|429|5\d\d)$/.test(String(res.status))) continue; throw new Error(lastError); }
      const { items = [] } = JSON.parse((await res.json()).candidates[0].content.parts[0].text);
      failures = 0;
      const verdicts = new Map(items.map((it) => [Number(it.index), it]));
      const ranked = [], rejected = [];
      loaded.forEach(({ c }, k) => {
        const v = verdicts.get(k + 1);
        if (!v) { rejected.push({ c, match: 0, striking: 0, problem: "unrated", seen: "" }); return; }
        const row = { c, match: Number(v.match) || 0, striking: Number(v.striking) || 0, problem: String(v.problem || "none"), seen: String(v.seen || "").slice(0, 80), model };
        const ok = row.match >= MIN_MATCH && !BAD.has(row.problem) && row.striking >= (hook ? 5 : 3);
        (ok ? ranked : rejected).push(row);
      });
      ranked.sort((a, b) => b.match * 2 + b.striking - (a.match * 2 + a.striking));
      return { skipped: false, ranked, rejected };
    } catch (e) {
      lastError = `${model}: ${String(e.message).slice(0, 80)}`;
    }
  }
  failures++;
  console.error(`  vision: every model failed (${lastError}); candidates are used unchecked`);
  return unchecked(`all models failed: ${lastError}`);
}
