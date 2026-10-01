// One-time, run LOCALLY: turns your downloaded Google OAuth client file into a
// long-lived refresh token. The token is written to .yt-refresh-token.txt (git-ignored)
// and never printed, so it does not end up in terminal logs or chat.
//   node scripts/auth.mjs "C:\path\to\client_secret_....json"
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/auth.mjs <client_secret.json>");
  process.exit(1);
}
const { client_id, client_secret } = JSON.parse(readFileSync(file, "utf8")).installed;
const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}`;
const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id,
    redirect_uri: redirect,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload",
    access_type: "offline",
    prompt: "consent",
    login_hint: process.env.LOGIN_HINT ?? "",
  });

console.log("OPEN THIS URL:\n" + authUrl);

http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get("code");
  if (!code) { res.end("waiting..."); return; }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id, client_secret, redirect_uri: redirect, grant_type: "authorization_code",
    }),
  });
  const j = await r.json();
  if (j.refresh_token) {
    writeFileSync(".yt-refresh-token.txt", j.refresh_token);
    res.end("Done. You can close this tab.");
    console.log("SUCCESS: refresh token saved to .yt-refresh-token.txt");
  } else {
    res.end("Failed, see terminal.");
    console.log("FAILED:", j.error, j.error_description);
  }
  process.exit(0);
}).listen(PORT);
