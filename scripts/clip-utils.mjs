// Small helpers for downloaded stock clips.
import { spawnSync } from "node:child_process";
import { renameSync, rmSync } from "node:fs";

const ff = (args) => spawnSync("ffmpeg", ["-hide_banner", "-nostats", ...args], { encoding: "utf8" });

function seconds(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return parseFloat(r.stdout) || 0;
}

/**
 * Many stock clips fade in from black (a Short would open on 3 s of nothing). If the clip starts black for
 * 0.2-6 s, cut that part off. Returns the number of seconds removed (0 = untouched).
 */
export function trimBlackLead(file) {
  const probe = ff(["-t", "8", "-i", file, "-vf", "blackdetect=d=0.2:pix_th=0.12", "-an", "-f", "null", "-"]);
  const m = /black_start:([\d.]+) black_end:([\d.]+)/.exec(probe.stderr ?? "");
  if (!m || parseFloat(m[1]) > 0.1) return 0;
  const cut = parseFloat(m[2]);
  if (cut < 0.2 || cut > 6) return 0;
  if (seconds(file) - cut < 3.5) return 0;                       // not enough left to be worth it
  const tmp = file.replace(/(\.\w+)$/, ".trim$1");
  const r = ff(["-y", "-loglevel", "error", "-ss", cut.toFixed(2), "-i", file, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", tmp]);
  if (r.status !== 0) { rmSync(tmp, { force: true }); return 0; }
  renameSync(tmp, file);
  return cut;
}
