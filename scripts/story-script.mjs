// "Canlı Garaj" Shorts, step 1: pick a vehicle topic, read its Wikipedia article(s), and have Gemini turn ONLY
// that material into a ~50 s Turkish script told by a friendly garage master. A second Gemini pass audits the
// script for claims the source does not support; unsupported claims mean one repair attempt, then the topic is
// dropped and another one is tried.
//
// usage: node scripts/story-script.mjs [--fixture] [--topic "Clutch"]   -> data/story.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fetchSource } from "./sources/wiki.mjs";
import { PARTS, SCENARIOS, ANGLES, KIND_WEIGHT } from "./sources/garage-topics.mjs";

const HISTORY = "data/history.json";
const OUT = "data/story.json";

// Gemini model names change often (older ones get retired for new users), so the model list is
// discovered from the API instead of being hard-coded: newest "flash" first, "lite" as a last resort.
let modelCache;
async function textModels() {
  if (process.env.GEMINI_TEXT_MODEL) return [process.env.GEMINI_TEXT_MODEL];
  if (modelCache) return modelCache;
  try {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(30_000),
    });
    const { models = [] } = await res.json();
    const ver = (n) => Number(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    modelCache = models
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace("models/", ""))
      .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n)) // stable text models, no preview/tts/image variants
      .sort((a, b) => ver(b) - ver(a) || (a.includes("lite") ? 1 : 0) - (b.includes("lite") ? 1 : 0))
      .slice(0, 4);
    console.error(`Gemini text models available: ${modelCache.join(", ") || "none found"}`);
  } catch (e) {
    console.error(`model discovery failed (${e.message})`);
  }
  if (!modelCache?.length) modelCache = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];
  return modelCache;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

const SYSTEM = `You write scripts for "Canlı Garaj", a Turkish YouTube Shorts channel that explains how CARS and MOTORCYCLES (every type, their parts, systems and the odd "what happens if...?" questions) really work, and now and then other vehicles. Stay strictly on the vehicle of the topic: a car video never mentions trains, aircraft or ships, and the other way round. The narrator is a friendly, knowledgeable garage master (usta) talking to ONE viewer.

OUTPUT LANGUAGE: Turkish, natural SPOKEN Turkish (the text is read aloud by a voice and shown as captions). Short sentences, concrete, no filler, no "biliyor muydun", no "bu videoda", no "hadi başlayalım". Address the viewer informally ("sen"). Use the everyday workshop vocabulary Turkish drivers know (debriyaj, şanzıman, balata, amortisör, triger, enjektör, turbo...).

Rules, all mandatory:
1. Facts come ONLY from the SOURCE TEXT. You may add simple, logical consequences that follow directly from the mechanics the source describes (for example: if the source says a gear has no synchronizer, you may explain that engaging it while moving grinds the gear teeth). Never invent numbers, percentages, names, dates, records, prices, model names or causes that the source does not support. If the source does not say it, leave it out.
2. Never criticise or praise a brand. Brand names only when the source itself uses them for a fact.
3. HOOK (the first sentence, at most 12 words): a concrete question, scenario or surprising claim about the topic that makes the viewer need the answer. Never promise something the script does not deliver.
4. Then EXACTLY 5 beats of 12-22 words. Each beat gives one new idea. Every beat is one or two COMPLETE sentences that make sense on their own and end with ".", "?" or "!". NEVER cut a sentence off between beats: no trailing comma, no "...", no "…", and no beat ending on "ve", "ama", "çünkü", "ancak" or "fakat" (each beat is read aloud as its own separate clip). The "open loop" is made by an intriguing complete sentence or a short question, for example "Peki bu mandal kırılırsa ne olur?". Build to the answer.
5. PAYOFF (at most 22 words): the useful takeaway, what a driver or rider should know.
6. CTA (at most 14 words): an easy, debatable question that makes the viewer want to answer in the comments ("Sen ... ?").
7. Spoken numbers and units: plain numbers may be digits, but write units in words ("kilometre", "derece", "bar", "devir") and never use abbreviations such as km/s, °C, rpm, hp.
8. For the hook, every beat and the payoff give "visual": 3-5 ENGLISH words for a stock-footage search that returns REAL FILMED footage of that exact moment. ALWAYS name the vehicle or part in it ("car steering wheel turning", "mechanic checking car engine", "motorcycle chain close up", "truck driving highway", "car brake disc spinning"). Never abstract ideas, diagrams, money, cartoons or people's names. Never a brand. Every scene must have a DIFFERENT visual, and each visual must show EXACTLY what THAT scene's sentence is about (the part, the action or the situation named in the sentence, not just "car"): a sentence about the handbrake lever gets "car handbrake lever pulled", a sentence about a worn clutch disc gets "worn clutch disc close up", a sentence about the car rolling downhill gets "car rolling downhill street". Prefer common, easy-to-find footage (cars driving, wheels, engines, mechanics, dashboards, roads) over rare close-ups of exotic parts.
9. "title": Turkish, at most 70 characters, curiosity-driven but truthful, contains the topic, no emoji.
10. "tags": 6-10 short keywords, mixing Turkish and English.
11. Safety: never encourage dangerous driving, stunts, speeding, tampering with safety or emission systems, or risky do-it-yourself repair. When a failure can be dangerous, tell the viewer to go to a service ("servise git").`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    hook: { type: "OBJECT", properties: { text: { type: "STRING" }, visual: { type: "STRING" } }, required: ["text", "visual"] },
    beats: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { text: { type: "STRING" }, visual: { type: "STRING" } }, required: ["text", "visual"] },
    },
    payoff: { type: "OBJECT", properties: { text: { type: "STRING" }, visual: { type: "STRING" } }, required: ["text", "visual"] },
    cta: { type: "STRING" },
    tags: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["title", "hook", "beats", "payoff", "cta", "tags"],
};

async function gemini(prompt, schema, system = SYSTEM, temperature = 0.7) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  let lastErr;
  // Demand spikes (503) hit every model at once and pass within a minute or two: after a full
  // sweep over the models, wait and sweep again before giving up on the story.
  for (let round = 0; round < 4; round++) {
    if (round > 0) {
      if (!/HTTP (429|5\d\d)/.test(lastErr?.message ?? "")) break;
      console.error(`all models busy, waiting 30s (round ${round + 1}/4)`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
    for (const model of await textModels()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const t0 = Date.now();
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature, responseMimeType: "application/json", responseSchema: schema },
            }),
            signal: AbortSignal.timeout(60_000),
          });
          if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const data = await res.json();
          const out = JSON.parse(data.candidates[0].content.parts[0].text);
          console.error(`gemini ${model} ok in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
          if (modelCache?.[0] !== model && modelCache?.includes(model)) modelCache = [model, ...modelCache.filter((m) => m !== model)]; // stick with what works
          return out;
        } catch (e) {
          lastErr = e;
          console.error(`gemini ${model} attempt ${attempt + 1} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${e.message.slice(0, 160)}`);
          if (/HTTP (404|429|5\d\d)/.test(e.message)) break; // overloaded or retired: the next model is a better bet than a retry
          await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        }
      }
    }
  }
  throw lastErr;
}

function validate(s) {
  const problems = [];
  const w = (t) => words(t ?? "");
  if (w(s.hook?.text) < 3 || w(s.hook.text) > 14) problems.push("hook must be 3-14 words");
  if (!Array.isArray(s.beats) || s.beats.length !== 5) problems.push("need exactly 5 beats");
  else s.beats.forEach((b, i) => { if (w(b.text) < 8 || w(b.text) > 26) problems.push(`beat ${i + 1} must be 8-26 words`); });
  if (w(s.payoff?.text) < 4 || w(s.payoff.text) > 25) problems.push("payoff must be 4-25 words");
  // every scene is voiced as its own clip, so it must be a finished sentence (a dangling "ve…" is heard as a stutter)
  [s.hook, ...(s.beats ?? []), s.payoff].forEach((v, i) => {
    const t = (v?.text ?? "").trim();
    if (!/[.?!]["”']?$/.test(t) || /(\.\.\.|…)/.test(t) || /(^|\s)(ve|ama|çünkü|ancak|fakat|ya da|veya|ki)[.?!]$/i.test(t)) problems.push(`scene ${i + 1} must be a COMPLETE sentence ending in . ? or ! (no "…", no trailing ve/çünkü)`);
  });
  if (w(s.cta) < 3 || w(s.cta) > 16) problems.push("cta must be 3-16 words");
  const total = w(s.hook?.text) + (s.beats ?? []).reduce((a, b) => a + w(b.text), 0) + w(s.payoff?.text) + w(s.cta);
  if (total > 150) problems.push(`script too long (${total} words)`);
  if (!s.title || s.title.length > 95) problems.push("title missing or too long");
  for (const v of [s.hook, ...(s.beats ?? []), s.payoff]) if (!v?.visual || /[^\x00-\x7f]/.test(v.visual)) problems.push("every visual must be 2-5 plain English words");
  return problems;
}

const FIXTURE = {
  title: "Debriyaj Nasıl Çalışır? Motoru Tekerlekten Ayıran Parça",
  hook: { text: "Debriyaj olmasa araç dururken motor da dururdu.", visual: "car clutch pedal" },
  beats: [
    { text: "Motor sürekli döner, tekerlekler ise durmak zorunda. İkisini birbirine bağlayıp ayıran parça debriyajdır.", visual: "engine bay close up" },
    { text: "Pedala basınca debriyaj diski volandan ayrılır. Motorun gücü şanzımana gitmez ve vites rahatça değişir.", visual: "manual gearbox gears" },
    { text: "Pedalı bırakınca yaylar diski volana bastırır. Sürtünme sayesinde güç yavaş yavaş tekerleklere aktarılır.", visual: "car driving road" },
    { text: "Diskin üzerindeki sürtünme malzemesi zamanla aşınır. Yarım basarak sürmek bu aşınmayı hızlandırır.", visual: "mechanic car repair" },
    { text: "Aşınan debriyaj kayar. Gaza basarsın, devir yükselir ama araç aynı hızla gitmez.", visual: "car dashboard tachometer" },
  ],
  payoff: { text: "Debriyajı yarım basılı tutma, yoksa pahalı bir tamire doğru gidersin.", visual: "car garage workshop" },
  cta: "Sen debriyajı en son ne zaman değiştirdin?",
  tags: ["debriyaj", "şanzıman", "araba", "clutch", "otomobil", "usta"],
};

function loadHistory() {
  if (!existsSync(HISTORY)) return [];
  try { return JSON.parse(readFileSync(HISTORY, "utf8")); } catch { return []; }
}

// ---- what to make next -------------------------------------------------------------------------------------
// ~40 % "what happens if...?" scenarios (the viewer's own questions), the rest parts told from a rotating angle.
function nextTopic(history, forced) {
  const done = new Set(history.map((h) => h.key));
  const all = [
    ...SCENARIOS.map((s) => ({ ...s, key: `garage|q|${s.q}` })),
    ...PARTS.flatMap((p) => ANGLES.map((a) => ({ ...p, angle: a, key: `garage|${p.wiki}|${a.id}` }))),
  ];
  if (forced) {
    const f = all.filter((t) => t.wiki.toLowerCase() === forced.toLowerCase());
    if (f.length) return pick(f);
  }
  let fresh = all.filter((t) => !done.has(t.key));
  if (!fresh.length) fresh = all; // everything made once: start a new round
  // 1) which KIND of vehicle (cars first, then motorcycles, a little of everything else)
  const kinds = [...new Set(fresh.map((t) => t.vehicle))];
  let roll = Math.random() * kinds.reduce((a, k) => a + (KIND_WEIGHT[k] ?? 1), 0);
  const kind = kinds.find((k) => (roll -= KIND_WEIGHT[k] ?? 1) < 0) ?? kinds[0];
  const pool = fresh.filter((t) => t.vehicle === kind);
  // 2) a "what happens if...?" question (40 %) or a part told from a fresh angle
  const scen = pool.filter((t) => t.kind === "scenario");
  const parts = pool.filter((t) => t.kind === "part");
  return scen.length && (!parts.length || Math.random() < 0.4) ? pick(scen) : pick(parts);
}

async function loadSource(t) {
  const main = await fetchSource(t.wiki, t.kind === "scenario" ? 2800 : 3800);
  let text = `[${main.title}]\n${main.text}`;
  const urls = [main.url];
  for (const extra of t.extra ?? []) {
    try {
      const e = await fetchSource(extra, 1500);
      text += `\n\n[${e.title}]\n${e.text}`;
      urls.push(e.url);
    } catch { /* an optional extra article is not worth failing the video */ }
  }
  return { title: main.title, text, url: main.url, urls };
}

const AUDIT_SYSTEM = `You are a strict automotive fact-checker. Only the SOURCE TEXT and plain, well-established vehicle mechanics count as evidence.
Flag a claim ONLY if it (a) states a specific number, name, date, record, price or model that is not in the source, (b) contradicts the source or well-established mechanics, (c) invents a cause or consequence that does not follow from the mechanics in the source, or (d) encourages dangerous driving, tampering with safety/emission systems or risky DIY repair.
Do NOT flag rhetorical phrasing, paraphrases, or simple logical consequences of what the source describes. Write each flagged claim in English, briefly.`;

export async function generateStory({ fixture = false, topic } = {}) {
  if (fixture) {
    return {
      topic: "Clutch", key: "garage|fixture", category: "aktarma", lang: "tr",
      source: { title: "Clutch", url: "https://en.wikipedia.org/wiki/Clutch" }, script: FIXTURE,
    };
  }
  const history = loadHistory();

  for (let attempt = 0; attempt < 5; attempt++) {
    const t = nextTopic(history, topic);
    let source;
    try { source = await loadSource(t); } catch (e) { console.error(`source failed (${t.wiki}): ${e.message}`); history.push({ key: t.key }); continue; }

    const brief = t.kind === "scenario"
      ? `VIDEO IDEA: answer this viewer question in Turkish: "${t.q}"`
      : `VIDEO IDEA: tell the viewer about "${t.tr}" (Wikipedia: ${source.title}). Angle: ${t.angle.brief}.`;
    const base = `SOURCE TEXT (Wikipedia):\n"""\n${source.text}\n"""\n\n${brief}\nWrite the Short script now.`;
    let script = await gemini(base, SCHEMA);
    let problems = validate(script);
    if (problems.length) {
      script = await gemini(`${base}\n\nYour previous attempt had these problems, fix them: ${problems.join("; ")}.`, SCHEMA);
      problems = validate(script);
      if (problems.length) { console.error(`script rejected (${t.wiki}): ${problems.join("; ")}`); history.push({ key: t.key }); continue; }
    }

    // Audit pass: every claim must be supported by the source text or follow from its mechanics.
    const narration = (s) => [s.hook.text, ...s.beats.map((b) => b.text), s.payoff.text].join("\n");
    const auditSchema = { type: "OBJECT", properties: { unsupported: { type: "ARRAY", items: { type: "STRING" } } }, required: ["unsupported"] };
    const audit = await gemini(
      `SOURCE TEXT:\n"""\n${source.text}\n"""\n\nSCRIPT (Turkish):\n"""\n${narration(script)}\n"""\n\nList the claims that must be flagged. If none, return an empty list.`,
      auditSchema, AUDIT_SYSTEM, 0
    );
    if (audit.unsupported?.length) {
      console.error(`audit found unsupported claims (${t.wiki}): ${audit.unsupported.join(" | ")}`);
      script = await gemini(`${base}\n\nRewrite the script and REMOVE or correct these unsupported claims: ${audit.unsupported.join(" | ")}\nStay close to what the source says. No exaggeration; state plainly what the source supports.`, SCHEMA);
      if (validate(script).length) { history.push({ key: t.key }); continue; }
      const again = await gemini(
        `SOURCE TEXT:\n"""\n${source.text}\n"""\n\nSCRIPT (Turkish):\n"""\n${narration(script)}\n"""\n\nList the claims that must be flagged.`,
        auditSchema, AUDIT_SYSTEM, 0
      );
      if (again.unsupported?.length) { console.error(`still unsupported (${t.wiki}), trying another topic`); history.push({ key: t.key }); continue; }
    }
    return {
      topic: source.title, key: t.key, category: t.category, vehicle: t.vehicle, lang: "tr",
      source: { title: source.title, url: source.url, urls: source.urls }, script,
    };
  }
  throw new Error("could not produce a verified script");
}

if (process.argv[1]?.endsWith("story-script.mjs")) {
  const args = process.argv.slice(2);
  const story = await generateStory({ fixture: args.includes("--fixture"), topic: args.includes("--topic") ? args[args.indexOf("--topic") + 1] : undefined });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(story, null, 2));
  console.log(`story: ${story.topic} -> ${story.script.title}`);
}
