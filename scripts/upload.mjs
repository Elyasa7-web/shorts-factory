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

  // Files are ~2 MB, so a single PUT is fine.
  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Length": String(size), "Content-Type": "video/mp4" },
    body: readFileSync(v.file),
  });
  const body = await put.json();
  if (!put.ok) throw new Error(`upload failed ${put.status}: ${JSON.stringify(body)}`);
  return body.id;
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
