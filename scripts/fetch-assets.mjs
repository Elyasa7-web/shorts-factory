// Downloads the visual assets for every ranked item into public/ and records them in props.json:
//  - flag image    (flagcdn.com, free)                   -> public/flags/xx.png
//  - stock footage (Pexels, free API key, royalty-free)  -> public/clips/<slug>.mp4
// Missing assets never fail the build: the video falls back to the flag / emoji backdrop.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const propsPath = process.argv[2] ?? "data/props.json";
const props = JSON.parse(readFileSync(propsPath, "utf8"));
const PEXELS_KEY = process.env.PEXELS_API_KEY;
mkdirSync("public/flags", { recursive: true });
mkdirSync("public/clips", { recursive: true });

const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function download(url, file, timeout = 60_000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// Prefer a portrait file close to 1080x1920 but not huge (keeps downloads and renders fast).
function bestFile(video) {
  const files = video.video_files.filter((f) => f.file_type === "video/mp4" && f.width >= 540 && f.height <= 2600);
  if (!files.length) return null;
  const portrait = files.filter((f) => f.height >= f.width);
  const pool = portrait.length ? portrait : files;
  return pool.sort((a, b) => Math.abs(a.height - 1920) - Math.abs(b.height - 1920))[0];
}

async function findClip(label, isCountry) {
  const queries = isCountry
    ? [`${label} city`, `${label} landscape`, `${label} travel`, label]
    : [label, `${label} aerial`];
  for (const q of queries) {
    for (const orientation of ["portrait", undefined]) {
      const params = new URLSearchParams({ query: q, per_page: "12", size: "medium" });
      if (orientation) params.set("orientation", orientation);
      const res = await fetch(`https://api.pexels.com/videos/search?${params}`, {
        headers: { Authorization: PEXELS_KEY },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Pexels ${res.status}`);
      const { videos = [] } = await res.json();
      // Random pick among the top hits so repeated topics do not always show the same clip.
      const pool = videos.filter((v) => v.duration >= 5 && bestFile(v));
      if (pool.length) return bestFile(pool[Math.floor(Math.random() * Math.min(pool.length, 4))]);
    }
  }
  return null;
}

let flags = 0;
let clips = 0;
for (const item of props.items) {
  if (item.iso2) {
    const code = item.iso2.toLowerCase();
    const file = `public/flags/${code}.png`;
    try {
      if (!existsSync(file)) await download(`https://flagcdn.com/w640/${code}.png`, file, 20_000);
      item.flag = `flags/${code}.png`;
      flags++;
    } catch (e) {
      console.error(`flag ${code} unavailable (${e.message})`);
    }
  }
  if (PEXELS_KEY) {
    try {
      const f = await findClip(item.label, Boolean(item.iso2));
      if (f) {
        const rel = `clips/${slug(item.label)}.mp4`;
        await download(f.link, `public/${rel}`, 90_000);
        item.clip = rel;
        clips++;
      } else {
        console.error(`no stock clip found for ${item.label}`);
      }
    } catch (e) {
      console.error(`clip for ${item.label} failed (${e.message})`);
    }
  }
}
writeFileSync(propsPath, JSON.stringify(props));
console.log(
  `assets: flags ${flags}/${props.items.length}, clips ${clips}/${props.items.length}${PEXELS_KEY ? "" : " (no PEXELS_API_KEY)"}`
);
