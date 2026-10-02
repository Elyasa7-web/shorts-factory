// Visual sourcing for Story Shorts. Several free, legally reusable libraries are searched and every
// candidate gets a RELEVANCE SCORE (how many query words its own title/description/URL contains),
// so a scene gets the best match instead of "the first stock clip for a generic word".
//
//   Pexels videos   royalty-free, no attribution needed          (needs PEXELS_API_KEY)
//   Pexels photos   same license, has alt text (good relevance)   (needs PEXELS_API_KEY)
//   NASA library    public domain images (space topics)           (no key)
//   Wikimedia Commons  only Public domain / CC0 / CC BY, credited (no key)
//
// Photos are animated with a slow camera move in the video, so they work as full scenes.
const UA = { "User-Agent": "shorts-factory/1.0 (personal educational project)" };
const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "its", "into", "over", "under", "near"]);

const tokens = (s) =>
  (s ?? "").toLowerCase().replace(/<[^>]+>/g, " ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

export function relevance(query, text) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return 0;
  const t = new Set(tokens(text));
  return q.filter((w) => t.has(w) || [...t].some((x) => x.startsWith(w) || w.startsWith(x))).length / q.length;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- Pexels ----
function pexelsFile(v) {
  const files = v.video_files.filter((f) => f.file_type === "video/mp4" && f.width >= 540 && f.height <= 2600);
  if (!files.length) return null;
  const portrait = files.filter((f) => f.height >= f.width);
  return (portrait.length ? portrait : files).sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
}

export async function pexelsVideos(query, key) {
  if (!key) return [];
  const out = [];
  for (const orientation of ["portrait", undefined]) {
    const p = new URLSearchParams({ query, per_page: "15", size: "medium" });
    if (orientation) p.set("orientation", orientation);
    const { videos = [] } = await getJson(`https://api.pexels.com/videos/search?${p}`, { Authorization: key });
    for (const v of videos) {
      const f = pexelsFile(v);
      if (!f || v.duration < 4) continue;
      // Pexels video URLs carry a descriptive slug: /video/ocean-waves-crashing-on-rocks-1234/
      const slug = (v.url ?? "").split("/video/")[1] ?? "";
      out.push({ id: `pv${v.id}`, type: "video", url: f.link, score: relevance(query, slug), source: "Pexels", portrait: f.height >= f.width });
    }
    if (out.length >= 8) break;
  }
  return out;
}

export async function pexelsPhotos(query, key) {
  if (!key) return [];
  const p = new URLSearchParams({ query, per_page: "15", orientation: "portrait" });
  const { photos = [] } = await getJson(`https://api.pexels.com/v1/search?${p}`, { Authorization: key });
  return photos.map((ph) => ({
    id: `pp${ph.id}`, type: "image", url: ph.src.large2x ?? ph.src.large, source: "Pexels",
    score: relevance(query, `${ph.alt ?? ""} ${(ph.url ?? "").split("/photo/")[1] ?? ""}`), portrait: ph.height >= ph.width,
  }));
}

// ---- NASA Image and Video Library (public domain) ----
export async function nasaImages(query) {
  const p = new URLSearchParams({ q: query, media_type: "image" });
  const j = await getJson(`https://images-api.nasa.gov/search?${p}`);
  return (j.collection?.items ?? []).slice(0, 15).map((it) => {
    const d = it.data?.[0] ?? {};
    const thumb = it.links?.[0]?.href ?? "";
    return {
      id: `nasa${d.nasa_id}`, type: "image", url: thumb.replace("~thumb", "~large"), fallbackUrl: thumb, source: "NASA",
      score: relevance(query, `${d.title ?? ""} ${(d.keywords ?? []).join(" ")} ${d.description ?? ""}`.slice(0, 600)),
      portrait: false, credit: "NASA (public domain)",
    };
  }).filter((c) => c.url);
}

// ---- Wikimedia Commons (only licenses that allow reuse with at most attribution) ----
const OK_LICENSE = /^(public domain|pd|cc0|cc[- ]by(?!-sa)|cc[- ]by [\d.]+)/i;
export async function commonsImages(query) {
  const p = new URLSearchParams({
    action: "query", generator: "search", gsrnamespace: "6", gsrsearch: `${query} filetype:bitmap`, gsrlimit: "15",
    prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "1600", format: "json", formatversion: "2",
  });
  const j = await getJson(`https://commons.wikimedia.org/w/api.php?${p}`);
  const out = [];
  for (const pg of j.query?.pages ?? []) {
    const ii = pg.imageinfo?.[0];
    if (!ii || ii.width < 1000) continue;
    const lic = ii.extmetadata?.LicenseShortName?.value ?? "";
    if (!OK_LICENSE.test(lic.replace(/_/g, " "))) continue;
    const artist = (ii.extmetadata?.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim() || "Wikimedia Commons";
    out.push({
      id: `wc${pg.pageid}`, type: "image", url: ii.thumburl ?? ii.url, source: "Wikimedia Commons",
      score: relevance(query, pg.title.replace(/^File:/, "")), portrait: ii.height >= ii.width,
      credit: `${artist}, ${lic}, via Wikimedia Commons`,
    });
  }
  return out;
}

const SPACE = /\b(space|galaxy|planet|star|moon|sun|solar|black hole|nebula|comet|asteroid|mars|venus|saturn|jupiter|pluto|astronaut|rocket|orbit|telescope|cosmic|universe|eclipse|aurora)\b/i;

/**
 * Best visual for a scene: tries the scene's own query, then the topic. Returns
 * { type: "video"|"image", url, source, credit? } or null.
 * `used` is a Set of ids already shown in this video.
 */
export async function findVisual(queries, used, { pexelsKey, spaceTopic }) {
  const safe = async (fn) => { try { return await fn(); } catch { return []; } };
  for (const q of queries) {
    const pools = await Promise.all([
      safe(() => pexelsVideos(q, pexelsKey)),
      safe(() => pexelsPhotos(q, pexelsKey)),
      safe(() => commonsImages(q)),
      spaceTopic || SPACE.test(q) ? safe(() => nasaImages(q)) : [],
    ]);
    const cands = pools.flat().filter((c) => !used.has(c.id));
    // a moving clip is worth a little more than a still, a portrait frame fits the screen better
    const ranked = cands
      .map((c) => ({ ...c, rank: c.score + (c.type === "video" ? 0.12 : 0) + (c.portrait ? 0.06 : 0) }))
      .filter((c) => c.score >= 0.34)
      .sort((a, b) => b.rank - a.rank);
    if (ranked.length) {
      const best = ranked[0];
      used.add(best.id);
      return best;
    }
  }
  return null;
}
