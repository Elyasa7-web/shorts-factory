// One-time, run LOCALLY: turns your Google OAuth client into a long-lived refresh token.
//   $env:YT_CLIENT_ID="..."; $env:YT_CLIENT_SECRET="..."; node scripts/auth.mjs
// The token is printed to this terminal only. Put it in GitHub -> Settings -> Secrets yourself.
import http from "node:http";

const { YT_CLIENT_ID, YT_CLIENT_SECRET } = process.env;
if (!YT_CLIENT_ID || !YT_CLIENT_SECRET) {
  console.error("Set YT_CLIENT_ID and YT_CLIENT_SECRET first.");
  process.exit(1);
}
const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}`;
const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: YT_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload",
    access_type: "offline",
    prompt: "consent",
  });

console.log("\nOpen this URL in your browser and approve:\n\n" + authUrl + "\n");

http.createServer(async (req, res) => {
  const code = new URL(req.url, redirect).searchParams.get("code");
  if (!code) { res.end("waiting..."); return; }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: YT_CLIENT_ID, client_secret: YT_CLIENT_SECRET,
      redirect_uri: redirect, grant_type: "authorization_code",
    }),
  });
  const j = await r.json();
  res.end(j.refresh_token ? "Done. You can close this tab." : "Failed, see terminal.");
  console.log(j.refresh_token ? `\nYT_REFRESH_TOKEN=${j.refresh_token}\n` : j);
  process.exit(0);
}).listen(PORT);
