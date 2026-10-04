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

// words match when equal after dropping a plural "s", or when one is a long prefix of the other ("wave"/"waves");
// short prefixes ("sea" vs "season") no longer count
const stem = (w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const sameWord = (a, b) => {
  a = stem(a); b = stem(b);
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 5 && l.startsWith(s) && s.length >= 0.8 * l.length;
};
export const tokenize = tokens;
export function relevance(query, text) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return 0;
  const t = [...new Set(tokens(text))];
  return q.filter((w) => t.some((x) => sameWord(w, x))).length / q.length;
}

async function getJson(url, headers = {}) {
  // Wikimedia / Smithsonian answer 429 when asked too fast: wait and retry instead of losing the whole source
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(25_000) });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }
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
      out.push({ id: `pv${v.id}`, type: "video", url: f.link, score: relevance(query, slug), hay: slug, source: "Pexels", portrait: f.height >= f.width });
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
    score: relevance(query, `${ph.alt ?? ""} ${(ph.url ?? "").split("/photo/")[1] ?? ""}`), hay: `${ph.alt ?? ""} ${(ph.url ?? "").split("/photo/")[1] ?? ""}`, portrait: ph.height >= ph.width,
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
      score: relevance(query, `${d.title ?? ""} ${(d.keywords ?? []).join(" ")} ${d.description ?? ""}`.slice(0, 600)), hay: `${d.title ?? ""} ${(d.keywords ?? []).join(" ")}`,
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
      score: relevance(query, pg.title.replace(/^File:/, "")), hay: pg.title.replace(/^File:/, ""), portrait: ii.height >= ii.width,
      credit: `${artist}, ${lic}, via Wikimedia Commons`,
    });
  }
  return out;
}

// ---- Wikimedia Commons VIDEOS (real documentary / nature clips; same license filter) ----
export async function commonsVideos(query) {
  const p = new URLSearchParams({
    action: "query", generator: "search", gsrnamespace: "6", gsrsearch: `${query} filetype:video`, gsrlimit: "12",
    prop: "videoinfo", viprop: "url|size|mime|extmetadata|derivatives|duration", format: "json", formatversion: "2",
  });
  const j = await getJson(`https://commons.wikimedia.org/w/api.php?${p}`);
  const out = [];
  for (const pg of j.query?.pages ?? []) {
    const vi = pg.videoinfo?.[0];
    if (!vi || (vi.duration ?? 0) < 4) continue;
    const lic = vi.extmetadata?.LicenseShortName?.value ?? "";
    if (!OK_LICENSE.test(lic.replace(/_/g, " "))) continue;
    // transcoded WebM versions are small and decode everywhere; pick the one closest to 720p
    const webm = (vi.derivatives ?? []).filter((d) => /webm/.test(d.type) && d.width >= 400 && d.width <= 1300);
    const best = webm.sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720))[0]
      ?? (/webm|mp4/.test(vi.mime ?? "") && vi.width <= 1300 ? { src: vi.url, width: vi.width, height: vi.height } : null);
    if (!best?.src) continue;
    const artist = (vi.extmetadata?.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim() || "Wikimedia Commons";
    const title = pg.title.replace(/^File:/, "");
    out.push({
      id: `wv${pg.pageid}`, type: "video", url: best.src, source: "Wikimedia Commons", score: relevance(query, title), hay: title,
      portrait: (best.height ?? 0) >= (best.width ?? 1), credit: `${artist}, ${lic}, via Wikimedia Commons`, seconds: vi.duration,
    });
  }
  return out;
}

// ---- Openverse: one search over Flickr, museums, nature archives... (CC0 / public domain / CC BY only) ----
export async function openverseImages(query) {
  const p = new URLSearchParams({ q: query, license: "cc0,pdm,by", page_size: "20", mature: "false", category: "photograph" });
  const j = await getJson(`https://api.openverse.org/v1/images/?${p}`);
  return (j.results ?? []).filter((x) => (x.width ?? 0) >= 800 && x.url).map((x) => {
    const tags = (x.tags ?? []).map((t) => t.name).join(" ");
    return {
      id: `ov${x.id}`, type: "image", url: x.url, fallbackUrl: x.thumbnail, source: "Openverse", portrait: x.height >= x.width,
      score: relevance(query, `${x.title ?? ""} ${tags}`), hay: `${x.title ?? ""} ${tags}`,
      credit: x.license === "cc0" || x.license === "pdm" ? null : (x.attribution || `${x.creator ?? "Unknown"}, CC BY, via ${x.source}`),
    };
  });
}

// ---- Pixabay (optional: set PIXABAY_API_KEY; license needs no attribution) ----
export async function pixabayVideos(query, key) {
  if (!key) return [];
  const j = await getJson(`https://pixabay.com/api/videos/?${new URLSearchParams({ key, q: query, per_page: "15", safesearch: "true" })}`);
  return (j.hits ?? []).filter((h) => h.duration >= 4).map((h) => {
    const f = h.videos?.medium?.url ? h.videos.medium : h.videos?.small;
    return f?.url ? {
      id: `pxv${h.id}`, type: "video", url: f.url, source: "Pixabay", score: relevance(query, h.tags), hay: h.tags,
      portrait: f.height >= f.width,
    } : null;
  }).filter(Boolean);
}
export async function pixabayPhotos(query, key) {
  if (!key) return [];
  const j = await getJson(`https://pixabay.com/api/?${new URLSearchParams({ key, q: query, image_type: "photo", orientation: "vertical", per_page: "15", safesearch: "true" })}`);
  return (j.hits ?? []).map((h) => ({
    id: `pxp${h.id}`, type: "image", url: h.largeImageURL, fallbackUrl: h.webformatURL, source: "Pixabay",
    score: relevance(query, h.tags), hay: h.tags, portrait: h.imageHeight >= h.imageWidth,
  }));
}

// ---- NASA video library (public domain; space topics) ----
export async function nasaVideos(query) {
  const j = await getJson(`https://images-api.nasa.gov/search?${new URLSearchParams({ q: query, media_type: "video" })}`);
  const top = (j.collection?.items ?? []).slice(0, 12)
    .map((it) => ({ it, d: it.data?.[0] ?? {} }))
    .map((x) => ({ ...x, score: relevance(query, `${x.d.title ?? ""} ${(x.d.keywords ?? []).join(" ")}`) }))
    .filter((x) => x.score >= 0.34).sort((a, b) => b.score - a.score).slice(0, 3);
  const out = [];
  for (const { it, d, score } of top) {
    try {
      const files = await getJson(it.href);
      const mp4 = files.filter((u) => /\.mp4$/i.test(u) && !/orig|preview/i.test(u));
      const url = mp4.find((u) => /medium/.test(u)) ?? mp4.find((u) => /mobile/.test(u)) ?? mp4[0];
      if (url) out.push({ id: `nasav${d.nasa_id}`, type: "video", url, source: "NASA", score, hay: `${d.title ?? ""} ${(d.keywords ?? []).join(" ")}`, portrait: false, credit: "NASA (public domain)" });
    } catch { /* skip this item */ }
  }
  return out;
}

// ---- topic-exact media: files that are KNOWN to show the topic (no namesake problem) ----
// "Octopus" the animal vs "Octopus fungus", "Mars" vs the candy bar: these sources are never ambiguous.
async function commonsFileInfo(titles, exactFromArticle = true) {
  const out = [];
  for (let i = 0; i < titles.length; i += 20) {
    const q = new URLSearchParams({
      action: "query", titles: titles.slice(i, i + 20).join("|"), prop: "videoinfo|imageinfo", viprop: "url|size|mime|extmetadata|derivatives|duration",
      iiprop: "url|size|mime|extmetadata", iiurlwidth: "1600", format: "json", formatversion: "2",
    });
    const r = await getJson(`https://commons.wikimedia.org/w/api.php?${q}`);
    for (const pg of r.query?.pages ?? []) {
      const vi = pg.videoinfo?.[0];
      const ii = pg.imageinfo?.[0];
      const info = vi ?? ii;
      if (!info) continue;
      const lic = info.extmetadata?.LicenseShortName?.value ?? "";
      if (!OK_LICENSE.test(lic.replace(/_/g, " "))) continue;
      const artist = (info.extmetadata?.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim() || "Wikimedia Commons";
      const title = pg.title.replace(/^File:/, "");
      const credit = `${artist}, ${lic}, via Wikimedia Commons`;
      if (vi && /^(video|application\/ogg)/.test(vi.mime ?? "") && (vi.duration ?? 0) >= 4) {
        const webm = (vi.derivatives ?? []).filter((d) => /webm/.test(d.type) && d.width >= 400 && d.width <= 1300);
        const best = webm.sort((a, b) => Math.abs(a.width - 720) - Math.abs(b.width - 720))[0];
        if (best?.src) out.push({ id: `wa${pg.pageid}`, type: "video", url: best.src, source: "Wikimedia (topic)", exact: exactFromArticle, hay: title, portrait: best.height >= best.width, credit });
      } else if (ii && /^image\/(jpeg|png)/.test(ii.mime ?? "") && ii.width >= 900 && ii.height >= 600) {
        out.push({ id: `wa${pg.pageid}`, type: "image", url: ii.thumburl ?? ii.url, source: "Wikimedia (topic)", exact: exactFromArticle, hay: title, portrait: ii.height >= ii.width, credit });
      }
    }
  }
  return out;
}

const FILE_OK = (t) => /\.(jpe?g|png|webm|ogv|ogg)$/i.test(t) && !/(icon|logo|flag|symbol|map|commons-|wiki|edit|question|ambox|portal|stub|disambig|diagram|chart|svg|range|distribution)/i.test(t);

// every image/video embedded in the topic's Wikipedia article
export async function wikiArticleMedia(topic) {
  const p = new URLSearchParams({ action: "query", titles: topic, prop: "images", imlimit: "80", format: "json", formatversion: "2", redirects: "1" });
  const j = await getJson(`https://en.wikipedia.org/w/api.php?${p}`);
  const files = (j.query?.pages?.[0]?.images ?? []).map((x) => x.title).filter(FILE_OK);
  return commonsFileInfo(files);
}

// the topic's own Wikimedia Commons category (found through Wikidata property P373): often dozens of curated files
export async function commonsCategoryMedia(topic) {
  const p = new URLSearchParams({ action: "query", titles: topic, prop: "pageprops", ppprop: "wikibase_item", format: "json", formatversion: "2", redirects: "1" });
  const j = await getJson(`https://en.wikipedia.org/w/api.php?${p}`);
  const qid = j.query?.pages?.[0]?.pageprops?.wikibase_item;
  if (!qid) return [];
  const c = await getJson(`https://www.wikidata.org/w/api.php?${new URLSearchParams({ action: "wbgetclaims", entity: qid, property: "P373", format: "json" })}`);
  const cat = c.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
  if (!cat) return [];
  const m = await getJson(`https://commons.wikimedia.org/w/api.php?${new URLSearchParams({
    action: "query", list: "categorymembers", cmtitle: `Category:${cat}`, cmtype: "file", cmlimit: "80", format: "json", formatversion: "2",
  })}`);
  return commonsFileInfo((m.query?.categorymembers ?? []).map((x) => x.title).filter(FILE_OK), false);
}

// ---- Smithsonian Open Access (CC0 museum + nature collections; DEMO_KEY works but is rate limited) ----
export async function smithsonianImages(query) {
  const key = process.env.SMITHSONIAN_API_KEY || "DEMO_KEY";
  const p = new URLSearchParams({ q: `${query} AND online_media_type:"Images" AND media_usage:"CC0"`, rows: "20", api_key: key });
  const j = await getJson(`https://api.si.edu/openaccess/api/v1.0/search?${p}`);
  const out = [];
  for (const row of j.response?.rows ?? []) {
    const media = row.content?.descriptiveNonRepeating?.online_media?.media?.find((m) => m.type === "Images" && m.content);
    if (!media) continue;
    const title = row.title ?? row.content?.descriptiveNonRepeating?.title?.content ?? "";
    const tags = JSON.stringify(row.content?.indexedStructured?.object_type ?? []) + " " + JSON.stringify(row.content?.freetext?.topic?.map((t) => t.content) ?? []);
    out.push({
      id: `si${row.id}`, type: "image", url: media.content, source: "Smithsonian", portrait: false,
      score: relevance(query, title), hay: `${title} ${tags}`, credit: `${row.content?.descriptiveNonRepeating?.data_source ?? "Smithsonian"}, CC0, Smithsonian Open Access`,
    });
  }
  return out;
}

const SPACE = /\b(space|galaxy|planet|star|moon|sun|solar|black hole|nebula|comet|asteroid|mars|venus|saturn|jupiter|pluto|astronaut|rocket|orbit|telescope|cosmic|universe|eclipse|aurora)\b/i;

// words that tell us a candidate is about the SAME THING as the topic (not a namesake)
const VEHICLE = "car automobile vehicle engine automotive mechanic garage workshop transmission gearbox diesel petrol gasoline exhaust suspension steering truck motorcycle bike tire tyre brake wheel";
const CRAFT = "aircraft airplane jet helicopter train locomotive railway ship boat submarine vessel bicycle tram tractor excavator crane bulldozer forklift";
// A candidate whose own title/tags contain one of these is never used: people (faces, politics, celebrities),
// and the classic namesakes of vehicle words (clutch = bag / dinosaur eggs, mouse, bat...).
export const BLOCK_WORDS = new Set((
  "president king queen minister politician senator trump biden obama putin celebrity actor actress singer model fashion bride wedding portrait " +
  "dinosaur egg eggs nest fossil bag handbag purse dress football soccer baseball basketball wrestling boxing concert band guitar " +
  "nude naked sexy bikini lingerie cat dog horse cow pig sheep " +
  "dollar money cash coin finance business clipart cartoon vector illustration icon logo emoji sticker drawing sketch"
).split(" "));

export const CATEGORY_CONTEXT = {
  // Canlı Garaj topics
  motor: VEHICLE, "otomobil-turleri": VEHICLE, aktarma: VEHICLE, "fren-suspansiyon": VEHICLE, "elektrik-guvenlik": VEHICLE, elektrikli: `${VEHICLE} electric battery charging hybrid`,
  motosiklet: `${VEHICLE} rider helmet scooter moped`, "agir-vasita": `${VEHICLE} ${CRAFT} heavy construction`, "diger-arac": `${CRAFT} engine vehicle racing`,
  senaryo: `${VEHICLE} ${CRAFT}`,
  // older channel categories (kept so the media layer still works for any topic)
  space: "space astronomy planet star galaxy nasa telescope universe cosmos orbit solar lunar nebula spacecraft rocket astronaut",
  animals: "animal wildlife wild species ocean sea marine underwater aquarium sealife zoo fish bird insect mammal reptile reef jungle savanna creature",
  body: "human anatomy medical biology body brain cell health scan microscope organ tissue",
  history: "ancient history historical ruins archaeology monument temple museum site heritage medieval unesco excavation",
  earth: "landscape mountain ocean aerial volcano desert glacier weather storm earth geology waterfall canyon forest",
  science: "science physics laboratory experiment chemistry technology atom particle research energy quantum",
  mysteries: "mystery ancient ocean ship ruins aerial fog strange legend expedition",
};

/**
 * Best visual for a scene. EVERY query x EVERY library is searched, plus the topic's own Wikipedia
 * article media; all candidates go into one pool and are ranked together.
 *   scene match  : how well the candidate's title/tags fit the scene's own description
 *   topic match  : the candidate is about the topic AND shares context words with the story
 *                  (an "Octopus fungus" photo is rejected for the animal story)
 *   article media: embedded in the topic's Wikipedia article, so always the right subject
 * `used` = ids already shown (or that failed to download) in this video.
 */
export async function findVisual(queries, used, { pexelsKey, pixabayKey, spaceTopic, topic = "", visual = "", context = new Set(), categoryWords = new Set(), article = [], strict = false, extraBlock = [] }) {
  // `article` = topic-exact media (Wikipedia article + Commons category), searched once per story
  const safe = async (fn) => { try { return await fn(); } catch { return []; } };
  const jobs = [];
  for (const q of queries) {
    jobs.push(
      safe(() => pexelsVideos(q, pexelsKey)), safe(() => pexelsPhotos(q, pexelsKey)),
      safe(() => pixabayVideos(q, pixabayKey)), safe(() => pixabayPhotos(q, pixabayKey)),
      safe(() => commonsVideos(q)), safe(() => commonsImages(q)), safe(() => openverseImages(q)), safe(() => smithsonianImages(q)),
    );
    if (spaceTopic || SPACE.test(q)) jobs.push(safe(() => nasaImages(q)), safe(() => nasaVideos(q)));
  }
  const seen = new Set();
  const cands = [...(await Promise.all(jobs)).flat(), ...article].filter((c) => {
    if (used.has(c.id) || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
  const topicWords = [...new Set(tokens(topic))];
  const isTopicWord = (w) => topicWords.some((t) => sameWord(t, w));   // "clutches" is still the topic word "clutch"
  // same-sense test: the candidate shares a real vehicle word with the story. In strict mode (vehicle channel)
  // only category words count, because generic scene words ("road", "floor") match namesakes too.
  const ctxHit = (hay) => {
    const t = tokens(hay).filter((w) => !isTopicWord(w));
    if (t.some((w) => [...categoryWords].some((c) => sameWord(c, w)))) return true;
    if (strict) return false;
    return new Set(t.filter((w) => [...context].some((c) => sameWord(c, w)))).size >= 2;
  };
  const extra = new Set(extraBlock);
  const blocked = (hay) => tokens(hay).some((w) => BLOCK_WORDS.has(w) || extra.has(w));
  // Pexels / Pixabay / NASA label their media carefully; Openverse, Commons search and Smithsonian tags are noisy
  const TRUSTED = new Set(["Pexels", "Pixabay", "NASA"]);
  const ranked = cands
    .map((c) => {
      const scene = visual ? relevance(visual, c.hay) : 0;
      const about = relevance(topic, c.hay);
      const sameSense = ctxHit(c.hay);
      const trusted = TRUSTED.has(c.source);
      // What the scene says is on screen matters most; being about the topic is a bonus. A moving clip beats a still,
      // a portrait frame fits the phone. Noisy libraries must ALSO pass the vehicle-context test.
      const rank = 1.0 * scene + (sameSense ? 0.35 * about : 0) + (c.type === "video" ? 0.15 : 0) + (c.portrait ? 0.08 : 0) + (c.exact && sameSense ? 0.1 : 0);
      const ok = !blocked(c.hay) && scene >= 0.34 && (trusted || sameSense);
      return { ...c, scene, about, rank, ok };
    })
    .filter((c) => c.ok)
    .sort((a, b) => b.rank - a.rank);
  if (!ranked.length) return null;
  used.add(ranked[0].id);
  return { ...ranked[0], score: ranked[0].rank, poolSize: cands.length };
}
