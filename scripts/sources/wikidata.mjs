// Wikidata (CC0): physical-world records, WORLD scope only.
// Country scope was audited and REMOVED: Wikidata is incomplete per country
// (US mountains lack Denali, US cities lack Los Angeles, US skyscrapers lack Central Park Tower). Only categories whose coverage was
// verified by scripts/audit.mjs are listed. Continent scope was REMOVED because
// Wikidata's continent tagging is incomplete (e.g. Kilimanjaro missing for Africa).
const ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "shorts-factory/1.0 (personal educational project)";
const MIN_SITELINKS = 15; // only well-known entities -> far fewer data errors

export const COUNTRIES = {
  Q30: "the United States", Q148: "China", Q668: "India", Q155: "Brazil",
  Q159: "Russia", Q17: "Japan", Q183: "Germany", Q142: "France",
  Q145: "the United Kingdom", Q38: "Italy", Q29: "Spain", Q16: "Canada",
  Q408: "Australia", Q96: "Mexico", Q43: "Turkey", Q252: "Indonesia",
  Q1033: "Nigeria", Q79: "Egypt", Q414: "Argentina", Q258: "South Africa",
  Q843: "Pakistan", Q794: "Iran", Q851: "Saudi Arabia", Q36: "Poland",
  Q212: "Ukraine", Q55: "the Netherlands", Q34: "Sweden", Q20: "Norway",
  Q41: "Greece", Q869: "Thailand", Q881: "Vietnam", Q928: "the Philippines",
  Q739: "Colombia", Q419: "Peru", Q298: "Chile", Q114: "Kenya",
  Q115: "Ethiopia", Q1028: "Morocco", Q884: "South Korea", Q39: "Switzerland",
};

// prop: P2044 elevation, P2043 length, P2046 area, P2048 height, P1082 population
// scale converts Wikidata's SI value (metres, m^2) to the displayed unit.
// min/max = plausibility window; built = completed structures only.
export const CATEGORIES = [
  { id: "mountains", emoji: "⛰️", cls: ["Q8502"], prop: "P2044", unit: "m", scale: 1, dir: "DESC", min: 100, max: 8900,
    noun: "Highest Mountains", scopes: ["world"] },
  { id: "rivers", emoji: "🌊", cls: ["Q4022"], prop: "P2043", unit: "km", scale: 1e-3, dir: "DESC", min: 50, max: 7000,
    noun: "Longest Rivers", scopes: ["world"] },
  { id: "lakes", emoji: "💧", cls: ["Q23397"], prop: "P2046", unit: "km²", scale: 1e-6, dir: "DESC", min: 10, max: 400000,
    noun: "Largest Lakes", scopes: ["world"] },
  { id: "islands", emoji: "🏝️", cls: ["Q23442"], prop: "P2046", unit: "km²", scale: 1e-6, dir: "DESC", min: 10, max: 2200000,
    noun: "Largest Islands", scopes: ["world"] },
  { id: "skyscrapers", emoji: "🏢", cls: ["Q11303"], prop: "P2048", unit: "m", scale: 1, dir: "DESC", min: 100, max: 830, built: true,
    noun: "Tallest Skyscrapers", scopes: ["world"] },
];

const EXCLUDE = new Set(["Lake Michigan–Huron"]); // double-counts Michigan + Huron
const RENAME = { "People's Republic of China": "China", "Russian Federation": "Russia" };

export function buildQuery(cat, scopeType, scopeQid) {
  const cls = cat.cls.map((c) => `wd:${c}`).join(" ");
  let scope = scopeType === "country" ? `?item wdt:P17 wd:${scopeQid}.` : "";
  // Completed structures only: a proposal has no inception date.
  if (cat.built) scope += ` ?item wdt:P571 ?inc. FILTER(YEAR(?inc) <= 2026)`;
  const value = cat.unitless ? `ps:${cat.prop}` : `psn:${cat.prop}/wikibase:quantityAmount`;
  // BestRank = only the currently valid statement(s); the P585 filter drops stale
  // point-in-time values. MAX() collapses duplicates so one bad outlier cannot win.
  return `
SELECT ?itemLabel ?v WHERE {
  {
    SELECT ?item (MAX(?val) AS ?v) WHERE {
      VALUES ?cls { ${cls} }
      ?item wdt:P31 ?cls.
      ?item p:${cat.prop} ?st.
      ?st a wikibase:BestRank. ?st ${value} ?val.
      OPTIONAL { ?st pq:P585 ?when. }
      FILTER(!BOUND(?when) || YEAR(?when) >= 2010)
      ${scope}
      ?item wikibase:sitelinks ?sl. FILTER(?sl >= ${MIN_SITELINKS})
    } GROUP BY ?item
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} ORDER BY ${cat.dir}(?v) LIMIT 40`;
}

async function sparqlOnce(query) {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  return (await res.json()).results.bindings;
}

export async function sparql(query, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      return await sparqlOnce(query);
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
}

export function rowsToItems(cat, rows) {
  const seen = new Set();
  const items = [];
  for (const r of rows) {
    const label = r.itemLabel?.value;
    if (!label || /^Q\d+$/.test(label) || seen.has(label) || EXCLUDE.has(label)) continue;
    const value = Number(r.v.value) * cat.scale;
    if (!Number.isFinite(value) || value < cat.min || value > cat.max) continue;
    seen.add(label);
    items.push({ label: RENAME[label] ?? label, value: niceRound(value), unit: cat.unit });
    if (items.length === 5) break;
  }
  return items;
}

function niceRound(n) {
  if (n >= 100) return Math.round(n);
  if (n >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

export const wikidata = {
  name: "wikidata",
  async build({ cat, scopeType, scopeQid }) {
    const items = rowsToItems(cat, await sparql(buildQuery(cat, scopeType, scopeQid)));
    if (items.length < 5) return null;
    const where = scopeType === "country" ? ` in ${COUNTRIES[scopeQid]}` : " in the World";
    return {
      key: `wd|${cat.id}|${cat.dir}|${scopeQid ?? "world"}`,
      title: `Top 5 ${cat.noun}${where}`,
      items,
      emoji: cat.emoji,
      source: "Wikidata (CC0)",
      tags: ["geography", "world records", "facts"],
    };
  },
};
