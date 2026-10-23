// Uploads a video to YouTube (Data API v3, resumable) with title/description/tags
// and a scheduled publish time. Needs env: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN.
// Quota: videos.insert costs 1,600 of the free 10,000 daily units -> max 6 uploads/day.
import { readFileSync, statSync, createReadStream } from "node:fs";

const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN } = process.env;

export async function accessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: YT_CLIENT_ID,
      client_secret: YT_CLIENT_SECRET,
      refresh_token: YT_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`token refresh failed: ${JSON.stringify(json)}`);
  return json.access_token;
}

/**
 * @param {{file:string,title:string,description:string,tags:string[],publishAt?:string}} v
 * @returns {Promise<string>} the new video id
 */
export async function uploadToYouTube(v) {
  if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
    throw new Error("Missing YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN");
  }
  const token = await accessToken();
  const size = statSync(v.file).size;

  const metadata = {
    snippet: {
      title: v.title.slice(0, 100),
      description: v.description.slice(0, 4900),
      tags: v.tags,
      categoryId: "2", // Autos & Vehicles
      defaultLanguage: "tr",
      defaultAudioLanguage: "tr",
    },
    status: {
      // A scheduled video must be uploaded as private; YouTube flips it to public at publishAt.
      privacyStatus: v.publishAt ? "private" : "public",
      ...(v.publishAt ? { publishAt: v.publishAt } : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: false, // real data, synthetic voice only
    },
  };

  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!init.ok) throw new Error(`upload init failed ${init.status}: ${await init.text()}`);
  const location = init.headers.get("location");

  return putVideo(location, v.file, size);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const why = (e) => `${e.message}${e.cause ? ` [${e.cause.code ?? ""} ${e.cause.message ?? e.cause}]` : ""}`;

/**
 * One PUT of the whole file (a resumable session accepts it again if the connection died). Node's fetch reports every
 * dropped connection as the useless "fetch failed" (YouTube may even have answered with an error and closed the
 * socket), so the real cause and the session's own opinion are logged and the upload is retried up to 3 times.
 */
async function putVideo(location, file, size) {
  const body = readFileSync(file);
  for (let attempt = 1; ; attempt++) {
    try {
      const put = await fetch(location, { method: "PUT", headers: { "Content-Length": String(size), "Content-Type": "video/mp4" }, body, signal: AbortSignal.timeout(600_000) });
      const text = await put.text();
      if (!put.ok) throw Object.assign(new Error(`upload failed ${put.status}: ${text.slice(0, 300)}`), { answered: true });
      return JSON.parse(text).id;
    } catch (e) {
      if (e.answered) throw e;                                   // YouTube answered with an error: retrying will not help
      console.error(`upload attempt ${attempt}/3 failed: ${why(e)}`);
      try {                                                      // what does the upload session say about it?
        const s = await fetch(location, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` }, signal: AbortSignal.timeout(30_000) });
        const t = await s.text();
        console.error(`upload session says: HTTP ${s.status} ${t.slice(0, 300)}`);
        if (s.status === 200 || s.status === 201) return JSON.parse(t).id;   // it had actually completed
        if (s.status >= 400 && s.status !== 404) throw Object.assign(new Error(`upload failed ${s.status}: ${t.slice(0, 300)}`), { answered: true });
      } catch (e2) { if (e2.answered) throw e2; }
      if (attempt >= 3) throw new Error(`upload failed after 3 network errors: ${why(e)}`);
      await sleep(5000 * attempt);
    }
  }
}

if (process.argv[1]?.endsWith("upload.mjs")) {
  const topic = JSON.parse(readFileSync("data/current.json", "utf8"));
  const id = await uploadToYouTube({
    file: process.argv[2] ?? "out/final.mp4",
    title: topic.title,
    description: topic.description,
    tags: topic.tags,
    publishAt: process.argv[3],
  });
  console.log(`uploaded: https://youtube.com/shorts/${id}`);
}
