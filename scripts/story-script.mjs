// Story Shorts, step 1: pick an evergreen topic, read its Wikipedia article, and have Gemini
// turn ONLY the facts in that article into a curiosity-driven 35-40 s script. A second Gemini
// pass audits the script for claims that are not in the source; any unsupported claim means
// one repair attempt, then the story is rejected (the pipeline falls back to a ranking video).
//
// usage: node scripts/story-script.mjs [--fixture] [--topic "Octopus"]   -> data/story.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { STORY_TOPICS, fetchSource } from "./sources/wiki.mjs";

const HISTORY = "data/history.json";
const OUT = "data/story.json";
const RECENT = 120; // do not repeat a topic within this many uploads
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

const SYSTEM = `You write scripts for a YouTube Shorts channel that tells surprising TRUE stories.
Rules, all mandatory:
1. Use ONLY facts that are written in the SOURCE TEXT. Never add numbers, names, dates, causes or claims from memory. If the source does not say it, do not say it.
2. Voice: a sharp, curious narrator talking to one person. Short sentences. Concrete details and specific numbers from the source. No filler, no "did you know", no "in this video", no "let's dive in".
3. Open with a hook of at most 12 words that creates a curiosity gap about something the source really supports (a surprising number, a contradiction, a "how is that even possible"). Never promise something the script does not deliver.
4. Then exactly 4 beats of 14-20 words. Each beat reveals one new fact; every beat except the last ends on a small open loop that pulls the viewer to the next beat.
5. Then a payoff of at most 16 words: the most surprising or meaningful conclusion, still from the source.
6. End with a call to action of at most 12 words that asks a debatable question the viewer will want to answer in the comments.
7. For the hook, every beat and the payoff give "visual": 2-4 words describing generic stock footage that can actually be filmed (e.g. "deep ocean water", "night sky stars", "ancient stone ruins"). Never a person's name or a brand.
8. title: at most 70 characters, curiosity-driven but truthful, contains the topic.
9. Never mention living people, political parties, religions in a negative way, or anything graphic.`;

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
  for (const model of await textModels()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: { temperature, responseMimeType: "application/json", responseSchema: schema },
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const data = await res.json();
        return JSON.parse(data.candidates[0].content.parts[0].text);
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

function validate(s) {
  const problems = [];
  const w = (t) => words(t ?? "");
  if (w(s.hook?.text) < 4 || w(s.hook.text) > 15) problems.push("hook must be 4-15 words");
  if (!Array.isArray(s.beats) || s.beats.length !== 4) problems.push("need exactly 4 beats");
  else s.beats.forEach((b, i) => { if (w(b.text) < 10 || w(b.text) > 26) problems.push(`beat ${i + 1} must be 10-26 words`); });
  if (w(s.payoff?.text) < 4 || w(s.payoff.text) > 22) problems.push("payoff must be 4-22 words");
  if (w(s.cta) < 3 || w(s.cta) > 16) problems.push("cta must be 3-16 words");
  const total = w(s.hook?.text) + (s.beats ?? []).reduce((a, b) => a + w(b.text), 0) + w(s.payoff?.text) + w(s.cta);
  if (total > 125) problems.push(`script too long (${total} words)`);
  if (!s.title || s.title.length > 95) problems.push("title missing or too long");
  return problems;
}

const FIXTURE = {
  title: "The Octopus Has Three Hearts, And That's Not The Strangest Part",
  hook: { text: "This animal has three hearts and blue blood.", visual: "octopus underwater" },
  beats: [
    { text: "Two hearts pump blood through its gills. A third one sends it around the rest of the body.", visual: "deep ocean water" },
    { text: "And when the octopus swims, that main heart actually stops beating. So it prefers crawling.", visual: "coral reef" },
    { text: "Its blood is blue because it carries oxygen with copper instead of iron.", visual: "blue ocean waves" },
    { text: "It is also a master of disguise, changing colour and texture to vanish into the seabed.", visual: "sea floor rocks" },
  ],
  payoff: { text: "Nature built an entire alien body plan, right here on Earth.", visual: "ocean sunlight" },
  cta: "Which animal should we explore next?",
  tags: ["octopus", "ocean", "animals", "science", "facts", "nature"],
};

function loadHistory() {
  if (!existsSync(HISTORY)) return [];
  try { return JSON.parse(readFileSync(HISTORY, "utf8")); } catch { return []; }
}

export async function generateStory({ fixture = false, topic } = {}) {
  if (fixture) return { topic: "Octopus", category: "animals", source: { title: "Octopus", url: "https://en.wikipedia.org/wiki/Octopus" }, script: FIXTURE };

  const history = loadHistory();
  const recent = new Set(history.slice(-RECENT).map((h) => h.key));
  const pool = topic
    ? STORY_TOPICS.filter((t) => t.title.toLowerCase() === topic.toLowerCase())
    : STORY_TOPICS.filter((t) => !recent.has(`story|${t.title}`));
  if (!pool.length) throw new Error("no story topic available");

  for (let attempt = 0; attempt < 4; attempt++) {
    const t = pick(pool);
    let source;
    try { source = await fetchSource(t.title); } catch (e) { console.error(`source failed (${t.title}): ${e.message}`); continue; }

    const base = `SOURCE TEXT (Wikipedia: ${source.title}):\n"""\n${source.text}\n"""\n\nWrite the Short script about "${source.title}".`;
    let script = await gemini(base, SCHEMA);
    let problems = validate(script);
    if (problems.length) {
      script = await gemini(`${base}\n\nYour previous attempt had these problems, fix them: ${problems.join("; ")}.`, SCHEMA);
      problems = validate(script);
      if (problems.length) { console.error(`script rejected (${t.title}): ${problems.join("; ")}`); continue; }
    }

    // Audit pass: every claim must be supported by the source text.
    const narration = [script.hook.text, ...script.beats.map((b) => b.text), script.payoff.text].join("\n");
    const audit = await gemini(
      `SOURCE TEXT:\n"""\n${source.text}\n"""\n\nSCRIPT:\n"""\n${narration}\n"""\n\nList every factual claim in the SCRIPT that is NOT directly supported by the SOURCE TEXT (wrong numbers, invented causes, extra details). If everything is supported, return an empty list.`,
      { type: "OBJECT", properties: { unsupported: { type: "ARRAY", items: { type: "STRING" } } }, required: ["unsupported"] },
      "You are a strict fact-checker. Only the SOURCE TEXT counts as evidence.",
      0
    );
    if (audit.unsupported?.length) {
      console.error(`audit found unsupported claims (${t.title}): ${audit.unsupported.join(" | ")}`);
      script = await gemini(`${base}\n\nRewrite the script and REMOVE or correct these unsupported claims: ${audit.unsupported.join(" | ")}`, SCHEMA);
      if (validate(script).length) continue;
      const again = await gemini(
        `SOURCE TEXT:\n"""\n${source.text}\n"""\n\nSCRIPT:\n"""\n${[script.hook.text, ...script.beats.map((b) => b.text), script.payoff.text].join("\\n")}\n"""\n\nList unsupported claims.`,
        { type: "OBJECT", properties: { unsupported: { type: "ARRAY", items: { type: "STRING" } } }, required: ["unsupported"] },
        "You are a strict fact-checker. Only the SOURCE TEXT counts as evidence.",
        0
      );
      if (again.unsupported?.length) { console.error(`still unsupported (${t.title}), rejecting`); continue; }
    }
    return { topic: t.title, category: t.category, source: { title: source.title, url: source.url }, script };
  }
  throw new Error("could not produce a verified story");
}

if (process.argv[1]?.endsWith("story-script.mjs")) {
  const args = process.argv.slice(2);
  const story = await generateStory({ fixture: args.includes("--fixture"), topic: args.includes("--topic") ? args[args.indexOf("--topic") + 1] : undefined });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(story, null, 2));
  console.log(`story: ${story.topic} -> ${story.script.title}`);
}
