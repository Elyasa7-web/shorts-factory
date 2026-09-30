// Prints the top 5 for Wikidata category x scope so a human can sanity-check them.
// usage: node scripts/audit.mjs [categoryId] [maxCountries]
import { CATEGORIES, COUNTRIES, buildQuery, sparql, rowsToItems } from "./sources/wikidata.mjs";
const only = process.argv[2];
const maxC = Number(process.argv[3] ?? 6);
for (const cat of CATEGORIES) {
  if (only && cat.id !== only) continue;
  for (const scopeType of cat.scopes) {
    const scopes = scopeType === "world" ? [null] : Object.keys(COUNTRIES).slice(0, maxC);
    for (const q of scopes) {
      let out;
      try { out = rowsToItems(cat, await sparql(buildQuery(cat, scopeType, q))).map((i) => `${i.label}=${i.value}`); }
      catch (e) { out = [`ERR ${e.message}`]; }
      console.log(`${cat.noun} @ ${q ? COUNTRIES[q] : "world"}: ${out.join(" | ") || "-"}`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
