// Picks the next "Top 5" topic and writes data/current.json (props + YouTube metadata).
// usage: node scripts/generate-topic.mjs [outFile]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { worldbank } from "./sources/worldbank.mjs";
import { wikidata, CATEGORIES, COUNTRIES } from "./sources/wikidata.mjs";

const HISTORY = "data/history.json";
const BANK = "data/topic-bank.json";
const RECENT_WINDOW = 250; // don't repeat a ranking within this many uploads
const WORLDBANK_SHARE = 0.95; // Wikidata has only 5 audited world records

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const OUTROS = ["Where does YOUR country rank?", "Is YOUR country on this list?", "Did #1 surprise you?", "Which one shocked you the most?"];
const ACCENTS = ["#ffcc00", "#00e0ff", "#ff4d8d", "#7CFF6B", "#ff8a3d"];

function loadHistory() {
  if (!existsSync(HISTORY)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY, "utf8"));
  } catch {
    return [];
  }
}

async function candidate() {
  if (Math.random() < WORLDBANK_SHARE) {
    const regions = [null, ...(await worldbank.regions())];
    return worldbank.build({
      indicator: pick(worldbank.indicators),
      dir: pick(["DESC", "ASC"]),
      region: pick(regions),
    });
  }
  const cat = pick(CATEGORIES);
  const scopeType = pick(cat.scopes);
  return wikidata.build({
    cat,
    scopeType,
    scopeQid: scopeType === "country" ? pick(Object.keys(COUNTRIES)) : null,
  });
}

function hashtags(title, extra) {
  const skip = new Set(["countries", "highest", "largest", "world", "people", "person", "which", "their"]);
  const words = title.toLowerCase().replace(/[^a-z ]/g, "").split(" ")
    .filter((w) => w.length > 5 && !skip.has(w));
  return [...new Set(["shorts", "top5", "facts", ...extra, ...words.slice(0, 3)])];
}

function finalize(topic, history) {
  history.push({ key: topic.key, at: new Date().toISOString() });
  mkdirSync(dirname(HISTORY), { recursive: true });
  writeFileSync(HISTORY, JSON.stringify(history.slice(-2000), null, 1));

  const tags = hashtags(topic.title, topic.tags);
  return {
    key: topic.key,
    title: topic.title,
    description: [
      topic.title,
      "",
      ...topic.items.map((it, i) => `${i + 1}. ${it.label}: ${it.value.toLocaleString("en-US")} ${it.unit}`),
      "",
      "Where does YOUR country rank? Tell us in the comments!",
      "",
      `Data: ${topic.source}`,
      "",
      tags.map((t) => `#${t}`).join(" "),
    ].join("\n"),
    tags,
    props: {
      hook: topic.title,
      emoji: topic.emoji ?? "🌍",
      accent: pick(ACCENTS),
      secondsPerItem: 6,
      teaser: topic.teaser ?? "Can you guess #1?",
      outro: pick(OUTROS),
      items: topic.items,
    },
  };
}

// Offline fallback: a snapshot of every valid topic (built by scripts/build-bank.mjs).
// Picks the least-recently-used entry, so even a long API outage cannot stall uploads.
function fromBank(history) {
  if (!existsSync(BANK)) throw new Error("No live topic and no topic bank available");
  const bank = JSON.parse(readFileSync(BANK, "utf8"));
  const lastUsed = new Map(history.map((h) => [h.key, Date.parse(h.at)]));
  bank.sort((a, b) => (lastUsed.get(a.key) ?? 0) - (lastUsed.get(b.key) ?? 0));
  console.error("Using topic bank (live sources unavailable or exhausted)");
  return bank[0];
}

export async function generateTopic({ attempts = 30 } = {}) {
  const history = loadHistory();
  const recent = new Set(history.slice(-RECENT_WINDOW).map((h) => h.key));

  for (let i = 0; i < attempts; i++) {
    let topic;
    try {
      topic = await candidate();
    } catch (e) {
      console.error(`candidate failed: ${e.message}`);
      continue;
    }
    if (topic && !recent.has(topic.key)) return finalize(topic, history);
  }
  return finalize(fromBank(history), history);
}

if (process.argv[1]?.endsWith("generate-topic.mjs")) {
  const out = process.argv[2] ?? "data/current.json";
  const topic = await generateTopic();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(topic, null, 2));
  console.log(JSON.stringify(topic, null, 2));
}
