// Instagram Reels pack: every video that goes to YouTube also becomes a GitHub Release "ig-<time>" holding the mp4 and a
// ready caption. The owner opens https://github.com/Elyasa7-web/shorts-factory/releases on the phone, downloads the mp4,
// pastes the caption and posts the Reel (Instagram has no free upload API for personal accounts, so this is the one manual
// tap per video). Old packs are deleted after 10 days so the repository does not fill up.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";

const KIND_TAGS = {
  car: ["#araba", "#otomobil", "#arabasever", "#arabalar"],
  motorcycle: ["#motosiklet", "#motor", "#motorcu", "#motorlife"],
  train: ["#tren", "#demiryolu", "#raylı", "#trenler"],
  aircraft: ["#uçak", "#havacılık", "#pilot", "#aviation"],
  ship: ["#gemi", "#denizcilik", "#denizaltı", "#gemiler"],
  machine: ["#işmakinesi", "#ekskavatör", "#vinç", "#inşaat"],
  truck: ["#tır", "#kamyon", "#otobüs", "#şoför"],
};
// 5 focused hashtags (3 by kind + brand + #reels): the caption carries the search keywords, hashtags help only a little
const COMMON_TAGS = ["#canlıgaraj", "#reels"];
const slugify = (t) => t.toLowerCase().replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "video";

/** Caption for Instagram from the YouTube description ("title \n\n payoff \n\n question \n\n disclaimer \n\n hashtags"). */
export function igCaption({ title, description = "", kind = "car" }) {
  const parts = description.split("\n\n").map((x) => x.trim()).filter(Boolean);
  const payoff = parts[1] ?? "";
  const question = parts[2] ?? "";
  const tags = [...(KIND_TAGS[kind] ?? KIND_TAGS.car).slice(0, 3), ...COMMON_TAGS].join(" ");
  // "sends per reach" is one of the top ranking signals: ask for the DM share explicitly
  const send = "📩 Merak eden bir arkadaşına gönder!";
  return [title, payoff, question, send, "▶️ Her gün yeni video: YouTube'da \"Canlı Garaj\" (@canli-garaj)\n👆 Takip et, kaçırma!", tags].filter(Boolean).join("\n\n");
}

export function packNotes(caption) {
  return [
    "**1)** Aşağıdaki **.mp4** dosyasına dokun, videoyu indir ve telefonuna kaydet.",
    "**2)** Instagram → **+** → **Reel** → videoyu seç.",
    "**3)** Açıklama kutusuna aşağıdaki metni yapıştır (kopyala simgesi sağ üstte):",
    "",
    "```",
    caption,
    "```",
  ].join("\n");
}

export function publishInstagramPack({ title, description, kind, file }, { run = execFileSync, now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);                 // 20261031154530
  const tag = `ig-${stamp}`;
  const caption = igCaption({ title, description, kind });
  mkdirSync("out", { recursive: true });
  const video = `out/${slugify(title)}.mp4`;
  copyFileSync(file, video);
  const captionFile = `out/${slugify(title)}-instagram.txt`;
  writeFileSync(captionFile, caption, "utf8");
  const notesFile = `out/${slugify(title)}-ig-notes.md`;
  writeFileSync(notesFile, packNotes(caption), "utf8");
  run("gh", ["release", "create", tag, video, captionFile, "--title", `📱 ${title}`, "--notes-file", notesFile], { stdio: "inherit" });
  return tag;
}

/** Deletes ig-* releases older than `days`. Never throws. */
export function pruneInstagramPacks({ days = 10, run = execFileSync, now = Date.now() } = {}) {
  try {
    const out = run("gh", ["release", "list", "--limit", "200", "--json", "tagName,createdAt"], { encoding: "utf8" });
    const old = JSON.parse(out).filter((r) => r.tagName.startsWith("ig-") && now - Date.parse(r.createdAt) > days * 86400_000);
    for (const r of old) run("gh", ["release", "delete", r.tagName, "--yes", "--cleanup-tag"], { stdio: "inherit" });
    return old.length;
  } catch (e) { console.error(`::warning::could not prune old Instagram packs: ${String(e.message).slice(0, 120)}`); return 0; }
}
