// Gemini vision check for stock-footage candidates. The text search ranks clips by their tags, which cannot tell
// "car brake disc" from a dark parking-lot clip tagged "car". This looks at the clip's preview image instead and
// answers: does it show what the sentence is about, and is it a clip worth opening a Short with?
//
// FAIL-OPEN by design: no key, a quota error, a timeout or an unreadable answer all return { ok: true, skipped: true },
// so the video pipeline never breaks because of this check. It also stops calling Gemini after repeated failures.
const MODELS = (process.env.GEMINI_VISION_MODEL ? [process.env.GEMINI_VISION_MODEL] : ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]);
const MIN_GAP_MS = 6500;        // the free tier allows roughly 10 requests per minute
const MAX_CALLS = Number(process.env.VISION_MAX_CALLS || 16);
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
let modelIndex = 0;

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

  for (let m = modelIndex; m < MODELS.length; m++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELS[m]}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: image }] }],
          generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (res.status === 404) { modelIndex = m + 1; continue; }                 // retired model: try the next one
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = JSON.parse((await res.json()).candidates[0].content.parts[0].text);
      failures = 0;
      const match = Number(out.match), striking = Number(out.striking), problem = String(out.problem || "none");
      if (!Number.isFinite(match) || !Number.isFinite(striking)) return pass("unreadable answer");
      const ok = match >= MIN_MATCH && !BAD.has(problem) && (!hook || striking >= 5);
      return { ok, match, striking, problem, seen: String(out.seen || "").slice(0, 80) };
    } catch (e) {
      failures++;
      console.error(`  vision: ${MODELS[m]} failed (${String(e.message).slice(0, 80)})`);
      return pass("request failed");
    }
  }
  failures = MAX_FAILURES;
  return pass("no vision model available");
}
