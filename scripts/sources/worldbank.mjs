// World Bank open data: official, current, free, no API key.
// topic space = indicators x direction x region  (hundreds of distinct rankings)
const API = "https://api.worldbank.org/v2";

// Places in the World Bank list that are not sovereign countries. Excluded so
// a "Top 5 Countries" video never contains a territory or a disputed entity.
const NOT_COUNTRIES = new Set([
  "HKG", "MAC", "PRI", "BMU", "GRL", "GUM", "VIR", "ABW", "CUW", "SXM", "CYM",
  "TCA", "VGB", "MAF", "NCL", "PYF", "FRO", "GIB", "IMN", "CHI", "PSE", "XKX",
  "ASM", "MNP",
]);

const RENAME = {
  "Russian Federation": "Russia",
  "Turkiye": "Türkiye",
  "Korea, Rep.": "South Korea",
  "Korea, Dem. People's Rep.": "North Korea",
  "Egypt, Arab Rep.": "Egypt",
  "Iran, Islamic Rep.": "Iran",
  "Venezuela, RB": "Venezuela",
  "Yemen, Rep.": "Yemen",
  "Syrian Arab Republic": "Syria",
  "Lao PDR": "Laos",
  "Kyrgyz Republic": "Kyrgyzstan",
  "Slovak Republic": "Slovakia",
  "Czechia": "Czech Republic",
  "Congo, Dem. Rep.": "DR Congo",
  "Congo, Rep.": "Republic of the Congo",
  "Gambia, The": "Gambia",
  "Bahamas, The": "Bahamas",
  "Micronesia, Fed. Sts.": "Micronesia",
  "St. Lucia": "Saint Lucia",
  "St. Kitts and Nevis": "Saint Kitts and Nevis",
  "St. Vincent and the Grenadines": "Saint Vincent and the Grenadines",
  "Brunei Darussalam": "Brunei",
  "Cabo Verde": "Cape Verde",
  "Viet Nam": "Vietnam",
  "Naoero": "Nauru",
  "Somalia, Fed. Rep.": "Somalia",
  "Cote d'Ivoire": "Ivory Coast",
};

// kind: "total" (size matters), "ratio" (distorted by micro-states -> need minPop)
const INDICATORS = [
  { id: "SP.POP.TOTL", emoji: "👥", kind: "total", unit: "people", hi: "Most People", lo: "Fewest People" },
  { id: "NY.GDP.MKTP.CD", emoji: "💰", kind: "total", unit: "$ billion", scale: 1e-9, hi: "Biggest Economy (GDP)", lo: "Smallest Economy (GDP)" },
  { id: "NY.GDP.PCAP.CD", emoji: "💵", kind: "ratio", unit: "$ per person", hi: "Highest GDP Per Person", lo: "Lowest GDP Per Person" },
  { id: "SP.DYN.LE00.IN", emoji: "❤️", kind: "ratio", unit: "years", hi: "Highest Life Expectancy", lo: "Lowest Life Expectancy" },
  { id: "EN.POP.DNST", emoji: "🏙️", kind: "total", unit: "people/km²", hi: "Most Crowded Land", lo: "Emptiest Land" },
  { id: "AG.LND.FRST.ZS", emoji: "🌳", kind: "ratio", unit: "% forest", hi: "Most Forest Cover", lo: "Least Forest Cover" },
  { id: "IT.NET.USER.ZS", emoji: "🌐", kind: "ratio", unit: "% online", hi: "Most People Online", lo: "Fewest People Online" },
  { id: "SP.URB.TOTL.IN.ZS", emoji: "🏢", kind: "ratio", unit: "% urban", hi: "Most Urban Population", lo: "Most Rural Population" },
  { id: "SP.DYN.TFRT.IN", emoji: "👶", kind: "ratio", unit: "births per woman", hi: "Most Babies Per Woman", lo: "Fewest Babies Per Woman" },
  { id: "AG.LND.TOTL.K2", emoji: "🗺️", kind: "total", unit: "km²", hi: "Most Land Area", lo: "Least Land Area" },
  { id: "SP.POP.GROW", emoji: "📈", kind: "ratio", unit: "% per year", hi: "Fastest Growing Population", lo: null },
  { id: "SH.XPD.CHEX.GD.ZS", emoji: "🏥", kind: "ratio", unit: "% of GDP", hi: "Highest Health Spending", lo: "Lowest Health Spending" },
  { id: "SP.DYN.IMRT.IN", emoji: "🍼", kind: "ratio", unit: "deaths per 1,000 births", hi: "Highest Infant Mortality", lo: "Lowest Infant Mortality" },
  { id: "MS.MIL.XPND.GD.ZS", emoji: "🛡️", kind: "ratio", unit: "% of GDP", hi: "Highest Military Spending", lo: "Lowest Military Spending" },
  { id: "SP.POP.65UP.TO.ZS", emoji: "👴", kind: "ratio", unit: "% aged 65+", hi: "Biggest Share of Seniors (65+)", lo: "Smallest Share of Seniors (65+)" },
  { id: "IT.CEL.SETS.P2", emoji: "📱", kind: "ratio", unit: "phones per 100", hi: "Most Phone Subscriptions Per Person", lo: "Fewest Phone Subscriptions Per Person" },
  { id: "NY.GDP.MKTP.KD.ZG", emoji: "🚀", kind: "ratio", unit: "% growth", hi: "Fastest Growing Economy", lo: null },
  { id: "NE.EXP.GNFS.ZS", emoji: "🚢", kind: "ratio", unit: "% of GDP", hi: "Most Export-Driven Economy", lo: "Least Export-Driven Economy" },
  { id: "AG.LND.ARBL.ZS", emoji: "🌾", kind: "ratio", unit: "% arable land", hi: "Most Arable Land", lo: "Least Arable Land" },
];

const MIN_POP_FOR_RATIOS = 1_000_000;
const MAX_STALE_YEARS = 2; // drop countries whose latest figure is older than this vs. the newest

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`World Bank ${res.status} for ${url}`);
  return res.json();
}

const recentCache = new Map();
async function mostRecent(indicatorId) {
  if (!recentCache.has(indicatorId)) {
    const data = await getJson(
      `${API}/country/all/indicator/${indicatorId}?format=json&mrnev=1&per_page=400`
    );
    recentCache.set(indicatorId, (data[1] ?? []).filter((x) => x.value != null));
  }
  return recentCache.get(indicatorId);
}

let countryCache;
async function getCountries() {
  if (!countryCache) {
    const data = await getJson(`${API}/country?format=json&per_page=400`);
    countryCache = new Map(
      data[1]
        .filter((c) => c.region.value !== "Aggregates" && !NOT_COUNTRIES.has(c.id))
        .map((c) => [c.id, { name: RENAME[c.name] ?? c.name, region: c.region.value.trim(), iso2: c.iso2Code }])
    );
  }
  return countryCache;
}

export const worldbank = {
  name: "worldbank",
  async regions() {
    return [...new Set([...(await getCountries()).values()].map((c) => c.region))];
  },
  indicators: INDICATORS,

  // Returns { key, title, items, source } or null if this combination is unusable.
  async build({ indicator, dir, region }) {
    if (!(dir === "DESC" ? indicator.hi : indicator.lo)) return null;
    const countries = await getCountries();
    let rows = (await mostRecent(indicator.id)).filter((r) => countries.has(r.countryiso3code));

    if (indicator.kind === "ratio") {
      const pops = new Map((await mostRecent("SP.POP.TOTL")).map((r) => [r.countryiso3code, r.value]));
      rows = rows.filter((r) => (pops.get(r.countryiso3code) ?? 0) >= MIN_POP_FOR_RATIOS);
    }
    if (region) rows = rows.filter((r) => countries.get(r.countryiso3code).region === region);

    const newest = Math.max(...rows.map((r) => Number(r.date)));
    rows = rows.filter((r) => newest - Number(r.date) <= MAX_STALE_YEARS);
    rows.sort((a, b) => (dir === "DESC" ? b.value - a.value : a.value - b.value));

    const top = rows.slice(0, 5);
    if (top.length < 5) return null;

    const scale = indicator.scale ?? 1;
    const items = top.map((r) => ({
      label: countries.get(r.countryiso3code).name,
      value: niceRound(r.value * scale),
      unit: indicator.unit,
      iso2: countries.get(r.countryiso3code).iso2, // used to fetch the flag image
    }));
    // A chart where every bar is identical (or all zero) is not a ranking.
    if (new Set(items.map((i) => i.value)).size < 4 || items.every((i) => i.value <= 0)) return null;

    const phrase = dir === "DESC" ? indicator.hi : indicator.lo;
    if (!phrase) return null;
    const where = region ? ` in ${region}` : " in the World";
    return {
      key: `wb|${indicator.id}|${dir}|${region ?? "world"}`,
      title: `Top 5 Countries With The ${phrase}${where}`,
      items,
      emoji: indicator.emoji,
      source: `World Bank Open Data (latest available, ${newest})`,
      tags: ["countries", "geography", "world", "statistics"],
    };
  },
};

function niceRound(n) {
  const a = Math.abs(n);
  if (a >= 1000) return Math.round(n);
  if (a >= 100) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}
