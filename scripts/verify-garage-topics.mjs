// Checks every Wikipedia title used by the garage topic bank: it must exist, not be a disambiguation page,
// and be long enough to ground a script. usage: node scripts/verify-garage-topics.mjs
import { PARTS, SCENARIOS } from "./sources/garage-topics.mjs";

const titles = new Set();
for (const p of PARTS) titles.add(p.wiki);
for (const s of SCENARIOS) { titles.add(s.wiki); s.extra.forEach((t) => titles.add(t)); }
const EXTRA_ONLY = new Set(SCENARIOS.flatMap((s) => s.extra));

const list = [...titles];
const bad = [];
const MIN_BYTES = 5000;
for (let i = 0; i < list.length; i += 40) {
  const batch = list.slice(i, i + 40);
  const url = "https://en.wikipedia.org/w/api.php?" + new URLSearchParams({
    action: "query", prop: "info|pageprops", ppprop: "disambiguation", redirects: "1", titles: batch.join("|"), format: "json", formatversion: "2",
  });
  await new Promise((r) => setTimeout(r, 1500));
  const res = await fetch(url, { headers: { "User-Agent": "shorts-factory/1.0 (personal educational project)" } });
  const txt = await res.text();
  let j; try { j = JSON.parse(txt); } catch { console.log("rate limited, waiting 20s"); await new Promise((r) => setTimeout(r, 20000)); i -= 40; continue; }
  const norm = new Map((j.query?.normalized ?? []).map((n) => [n.from, n.to]));
  const redir = new Map((j.query?.redirects ?? []).map((r) => [r.from, r.to]));
  const byTitle = new Map((j.query?.pages ?? []).map((p) => [p.title, p]));
  for (const t of batch) {
    const resolved = redir.get(norm.get(t) ?? t) ?? norm.get(t) ?? t;
    const page = byTitle.get(resolved);
    if (!page || page.missing) bad.push(`${t}  (missing)`);
    else if (page.pageprops && "disambiguation" in page.pageprops) bad.push(`${t}  (disambiguation page)`);
    else if ((page.length ?? 0) < (EXTRA_ONLY.has(t) ? 2000 : MIN_BYTES)) bad.push(`${t}  (only ${page.length} bytes)`);
  }
}
console.log(`${list.length} titles checked, ${bad.length} problems`);
for (const b of bad) console.log("  BAD:", b);
