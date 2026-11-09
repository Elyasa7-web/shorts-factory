// "Canlı Garaj" Shorts, step 1: pick a vehicle topic, read its Wikipedia article(s), and have Gemini turn ONLY
// that material into a ~50 s Turkish script told by a friendly garage master. A second Gemini pass audits the
// script for claims the source does not support; unsupported claims mean one repair attempt, then the topic is
// dropped and another one is tried.
//
// usage: node scripts/story-script.mjs [--fixture] [--topic "Clutch"]   -> data/story.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fetchSource } from "./sources/wiki.mjs";
import { PARTS, SCENARIOS, anglesFor } from "./sources/garage-topics.mjs";

const HISTORY = "data/history.json";
const OUT = "data/story.json";
const SCHEDULE = "data/schedule.json";

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
3. HOOK (the first sentence, at most 9 words, it is spoken and shown in the first 2 seconds): promise a concrete SPECTACLE or CONSEQUENCE the viewer feels in their own car or bike: a superlative ("dünyanın en ...", "ne kadar hızlı/büyük ...?"), a mistake and its price ("... koyarsan ne olur?"), or a danger. Proven on this channel (60-90 % of viewers watched to the end): "Çift katlı otobüs virajda neden devrilmez?", "Hava yastığı ne kadar hızlı şişer?", "Benzinli araca dizel koyarsan ne olur?", "Dev kepçeli ekskavatör bir günde ne kadar kazar?". Flops (about 30 % watched): "Motosikletler yollarda neden otomobiller kadar yaygın?", "Motosiklette neden bisiklet pedalı olur?", "Dişli oranı nedir?", "SUV aslında nedir?". NEVER open with a definition, popularity, history or market statistic ("yaygın", "nedir", "tarihçesi"). Never promise something the script does not deliver.
4. Then EXACTLY 4 beats (the whole video must run about 30-35 seconds: viewers who reach the end are the ones the algorithm rewards, so cut everything that is not essential). BEAT 1 is the most important one: it must be SHORT (8-12 words) and must IMMEDIATELY deliver the most surprising concrete fact or the first half of the answer to the hook, because most viewers decide to leave in the first 5-10 seconds. No definitions, no background, no "X, ... olan bir parçadır" in beat 1. The other three beats are 10-18 words. Each beat gives one new idea. Every beat is one or two COMPLETE sentences that make sense on their own and end with ".", "?" or "!". NEVER cut a sentence off between beats: no trailing comma, no "...", no "…", and no beat ending on "ve", "ama", "çünkü", "ancak" or "fakat" (each beat is read aloud as its own separate clip). The "open loop" is made by an intriguing complete sentence or a short question, for example "Peki bu mandal kırılırsa ne olur?". Build to the answer.
5. PAYOFF (at most 18 words): the useful takeaway, what a driver or rider should know.
6. CTA (at most 10 words): a question the viewer can answer in the comments with ONE word, because short answers are what people actually type: make them CHOOSE between two things ("... mı, ... mı?"), CONFESS ("Sen hiç ... yaptın mı?") or GUESS a number. Never "ne düşünüyorsun?" or "yorumlara yaz".
7. Spoken numbers and units: plain numbers may be digits, but write units in words ("kilometre", "derece", "bar", "devir") and never use abbreviations such as km/s, °C, rpm, hp.
8. For the hook, every beat and the payoff give "visual": 3-5 ENGLISH words for a stock-footage search that returns REAL FILMED footage of that exact moment. ALWAYS name the vehicle or part in it ("car steering wheel turning", "mechanic checking car engine", "motorcycle chain close up", "truck driving highway", "car brake disc spinning"). Never abstract ideas, diagrams, money, cartoons or people's names. Never a brand. Every scene must have a DIFFERENT visual, and each visual must show EXACTLY what THAT scene's sentence is about (the part, the action or the situation named in the sentence, not just "car"): a sentence about the handbrake lever gets "car handbrake lever pulled", a sentence about a worn clutch disc gets "worn clutch disc close up", a sentence about the car rolling downhill gets "car rolling downhill street". Prefer common, easy-to-find footage (cars driving, wheels, engines, mechanics, dashboards, roads) over rare close-ups of exotic parts.
9. "title": Turkish, at most 60 characters, no emoji, truthful, same promise as the hook: use "... Neden ...?", "... Ne Olur?", "... Ne Kadar Hızlı/Büyük/Güçlü ...?" with a CONCRETE object and a surprising consequence. NEVER "... Nasıl Çalışır ve ...", "... Hakkında Bilmeniz Gereken ...", "... Nedir ve Ne İşe Yarar", "... Aslında Nedir?", "... Tarihi", "... Neden Kadar Yaygın".
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
  if (w(s.hook?.text) < 3 || w(s.hook.text) > 11) problems.push("hook must be 3-11 words");
  if (!Array.isArray(s.beats) || s.beats.length !== 4) problems.push("need exactly 4 beats");
  else s.beats.forEach((b, i) => { if (w(b.text) < 6 || w(b.text) > 22) problems.push(`beat ${i + 1} must be 6-22 words`); });
  if (w(s.payoff?.text) < 4 || w(s.payoff.text) > 20) problems.push("payoff must be 4-20 words");
  // every scene is voiced as its own clip, so it must be a finished sentence (a dangling "ve…" is heard as a stutter)
  [s.hook, ...(s.beats ?? []), s.payoff].forEach((v, i) => {
    const t = (v?.text ?? "").trim();
    if (!/[.?!]["”']?$/.test(t) || /(\.\.\.|…)/.test(t) || /(^|\s)(ve|ama|çünkü|ancak|fakat|ya da|veya|ki)[.?!]$/i.test(t)) problems.push(`scene ${i + 1} must be a COMPLETE sentence ending in . ? or ! (no "…", no trailing ve/çünkü)`);
  });
  if (w(s.cta) < 3 || w(s.cta) > 12) problems.push("cta must be 3-12 words");
  const total = w(s.hook?.text) + (s.beats ?? []).reduce((a, b) => a + w(b.text), 0) + w(s.payoff?.text) + w(s.cta);
  if (total > 115) problems.push(`script too long (${total} words)`);
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
    { text: "Yarım basarak sürmek diski aşındırır. Aşınan debriyaj kayar, devir yükselir ama araç hızlanmaz.", visual: "car dashboard tachometer" },
  ],
  payoff: { text: "Debriyajı yarım basılı tutma, yoksa pahalı bir tamire doğru gidersin.", visual: "car garage workshop" },
  cta: "Sen debriyajı en son ne zaman değiştirdin?",
  tags: ["debriyaj", "şanzıman", "araba", "clutch", "otomobil", "usta"],
};

function loadHistory() {
  if (!existsSync(HISTORY)) return [];
  try { return JSON.parse(readFileSync(HISTORY, "utf8")); } catch { return []; }
}

// Hook styles the script is steered towards (parts only; scenario questions keep their own wording). classifyHook() labels the
// FINISHED hook by its wording, and that label is stored with the video so scripts/analyze.mjs can compare the styles.
const HOOK_STYLES = [
  { id: "consequence", brief: 'a MISTAKE and its price or danger ("... koyarsan ne olur?", "... yaparsan ne olur?")' },
  { id: "spectacle", brief: 'a SUPERLATIVE or spectacle ("dünyanın en ...", "... ne kadar hızlı/büyük/güçlü?")' },
  { id: "why", brief: 'a surprising WHY puzzle the viewer never thought about ("... neden ...?")' },
];
export function classifyHook(text = "") {
  const t = text.toLocaleLowerCase("tr-TR");
  if (/ne olur|olursa|yaparsan|edersen|takarsan|koyarsan|basarsan|çekersen|kullanırsan|gidersen|kapatırsan|unutursan|bırakırsan|kopsa|biterse|patlarsa/.test(t)) return "consequence";
  if (/ne kadar|dünyanın en|en (büyük|hızlı|güçlü|ağır|uzun|pahalı|yüksek)|rekor|kaç (kilometre|ton|metre)/.test(t)) return "spectacle";
  if (/neden|niçin|niye|nasıl/.test(t)) return "why";
  return "other";
}

// ---- what to make next -------------------------------------------------------------------------------------
// ~55 % "what happens if...?" scenarios (they keep viewers longest: 54 % average view vs ~48 % for parts) (the viewer's own questions), the rest parts told from a rotating angle.
export const KIND_SHARE = {};   // all kinds equal: the motorcycle double share of 17 Oct did not pay off (retention 38.7 %, 0.31 subs/1k)
export const KIND_ORDER = (process.env.KIND_ORDER || "car,train,aircraft,machine,ship,motorcycle,truck").split(",");
export function nextTopic(history, forced) {
  const done = new Set(history.map((h) => h.key));
  const all = [
    ...SCENARIOS.map((s) => ({ ...s, key: `garage|q|${s.q}` })),
    ...PARTS.flatMap((p) => anglesFor(p).map((a) => ({ ...p, angle: a, key: `garage|${p.wiki}|${a.id}` }))),
  ];
  if (forced) {
    // a topic is forced by its question text ("Rallide neden co-driver ... vardır?"), its history key or its Wikipedia title
    const want = forced.toLowerCase();
    const f = all.filter((t) => t.key.toLowerCase() === want || t.q?.toLowerCase() === want || String(t.wiki).toLowerCase() === want);
    if (f.length) return pick(f);
  }
  let fresh = all.filter((t) => !done.has(t.key));
  if (!fresh.length) fresh = all; // everything made once: start a new round
  // MINI-SERIES: viewers who liked one video about a part are the best audience for the next one about the same part (the
  // algorithm also keeps showing a channel's related Shorts together). A series is SERIES_LEN videos on the same Wikipedia
  // article, one after the other, each from a new angle; afterwards the article rests and a new series starts.
  const SERIES_LEN = Number(process.env.SERIES_LEN || 3);
  const topicByKey = new Map(all.map((x) => [x.key, x]));
  const recent = history.filter((h) => h.at).map((h) => topicByKey.get(h.key)).filter(Boolean);
  const lastTopic = recent.at(-1);
  let run = 0;
  for (let i = recent.length - 1; lastTopic && i >= 0 && recent[i].wiki === lastTopic.wiki; i--) run++;
  const siblingsOf = (t) => fresh.filter((x) => x.wiki === t.wiki && x.vehicle === t.vehicle && x.key !== t.key);
  if (lastTopic && run < SERIES_LEN) {
    const sib = siblingsOf(lastTopic);
    if (sib.length) return { ...pick(sib), series: { wiki: lastTopic.wiki, part: run + 1, of: SERIES_LEN } };
  }
  if (lastTopic && run >= SERIES_LEN && fresh.some((t) => t.wiki !== lastTopic.wiki)) fresh = fresh.filter((t) => t.wiki !== lastTopic.wiki);
  // 1) which KIND of vehicle: a fair rotation. The kind with the FEWEST videos made so far goes next; ties follow
  //    KIND_ORDER (car, train, aircraft, machine, ship, motorcycle, truck). So the kinds alternate one after the other
  //    and a kind that is behind catches up before the others get a second video.
  const kinds = [...new Set(fresh.map((t) => t.vehicle))];
  const made = {};
  for (const t of all) if (done.has(t.key)) made[t.vehicle] = (made[t.vehicle] ?? 0) + 1;
  const order = (k) => (KIND_ORDER.includes(k) ? KIND_ORDER.indexOf(k) : 99);
  // motorcycle viewers subscribe ~5x more often than car viewers (1.1 vs 0.2 subscribers per 1,000 views): they get a double share
  const score = (k) => (made[k] ?? 0) / (KIND_SHARE[k] ?? 1);
  // never two videos of the same kind in a row (catching up after a gap must not produce a streak)
  const byKey = new Map(all.map((x) => [x.key, x.vehicle]));
  const lastKind = [...history].reverse().map((h) => byKey.get(h.key)).find(Boolean);
  const candidates = kinds.length > 1 ? kinds.filter((k) => k !== lastKind) : kinds;
  const kind = [...candidates].sort((a, b) => score(a) - score(b) || order(a) - order(b))[0];
  const pool = fresh.filter((t) => t.vehicle === kind);
  // 2) a "what happens if...?" question (40 %) or a part told from a fresh angle
  // start a series only where enough fresh angles are left to finish it
  const rich = pool.filter((t) => siblingsOf(t).length >= SERIES_LEN - 1);
  const base = rich.length ? rich : pool;
  const scen = base.filter((t) => t.kind === "scenario");
  const parts = base.filter((t) => t.kind === "part");
  const t = scen.length && (!parts.length || Math.random() < 0.7) ? pick(scen) : pick(parts);
  return siblingsOf(t).length >= SERIES_LEN - 1 ? { ...t, series: { wiki: t.wiki, part: 1, of: SERIES_LEN } } : t;
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

    let brief = t.kind === "scenario"
      ? `VIDEO IDEA: answer this viewer question in Turkish: "${t.q}"`
      : `VIDEO IDEA: tell the viewer about "${t.tr}" (Wikipedia: ${source.title}). Angle: ${t.angle.brief}.`;
    if (t.kind !== "scenario") {
      const style = HOOK_STYLES[history.filter((h) => h.at).length % HOOK_STYLES.length];
      brief += `\nHOOK STYLE for this video: the hook is ${style.brief}.`;
    }
    if (t.series) {
      const schedule = existsSync(SCHEDULE) ? (() => { try { return JSON.parse(readFileSync(SCHEDULE, "utf8")); } catch { return []; } })() : [];
      const earlier = history.filter((h) => h.at).slice(-(t.series.part - 1)).filter(() => t.series.part > 1)
        .map((h) => schedule.find((l) => l.key === h.key)?.title ?? h.key.split("|").pop());
      brief += `\nThis is video ${t.series.part} of ${t.series.of} in a mini-series about the same subject. ${earlier.length
        ? `The earlier videos of the series were: ${earlier.map((x) => `"${x}"`).join(", ")}. Do NOT repeat their hook or facts: reveal something NEW.`
        : "Make it a strong video that stands on its own."} Never say "bölüm" or "part" aloud and never promise content the script does not deliver.`;
    }
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
      series: t.series ? { ...t.series, tr: t.tr ?? source.title } : null, hookStyle: classifyHook(script.hook.text),
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
