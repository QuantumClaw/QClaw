# AGEX Hub on Railway: QClaw says "offline" but Railway says "Online"

If your AGEX Hub is deployed on Railway (e.g. custom domain `hub.agexhq.com`) and shows **Online** in the Railway dashboard, but QuantumClaw still reports **AGEX Hub offline**, the failure is between QClaw and your Hub — not Railway itself.

## What QClaw does at startup

1. Resolves the Hub URL: `config.agex.hubUrl` or `AGEX_HUB_URL` or default `https://hub.agexhq.com`.
2. Calls **`GET ${hubUrl}/health`** with a 5s timeout.
3. If that request fails (error, timeout, or non‑2xx response), QClaw treats the Hub as offline and uses local secrets.

So "offline" means: **the health check to your Hub URL failed.**

## Checklist

### 1. Confirm the URL QClaw uses

Run:

```bash
qclaw diagnose
```

Check the AGEX Hub line. It should show the URL (e.g. `https://hub.agexhq.com`). If you use a different Railway domain, set it:

```bash
export AGEX_HUB_URL=https://your-app.railway.app
# or
qclaw config set agex.hubUrl "https://your-app.railway.app"
```

### 2. Test the health endpoint from the same machine as QClaw

From the machine where you run `qclaw start`:

```bash
curl -s -o /dev/null -w "%{http_code}" https://hub.agexhq.com/health
```

- **200** (or 2xx): Health endpoint is reachable; the issue may be timeout or the next steps (AID, SDK).
- **404**: Your AGEX Hub app does not expose `GET /health`. Add a route that returns 200 (e.g. `{ "ok": true }`).
- **403 / 503**: Often Cloudflare (see below).
- **Timeout or connection error**: Network, firewall, or DNS from that machine to Railway/Cloudflare.

### 3. Cloudflare in front of Railway

Your screenshot shows "Cloudflare proxy detected" for `hub.agexhq.com`. Cloudflare can cause the health check to fail even when the origin (Railway) is up:

- **Bot / challenge pages**: If Cloudflare returns an HTML challenge or "blocked" page, the response may be 403/503 or non‑JSON, and QClaw will treat it as failure.
- **Firewall rules**: A rule that blocks server-to-server or certain User-Agents can block QClaw’s `fetch()`.
- **SSL / proxy**: Misconfiguration can cause timeouts or connection errors.

**What to do:**

- In Cloudflare, temporarily allow or whitelist traffic to `hub.agexhq.com` for the path `/health` (or disable "Under Attack" / strict bot protection for that host if you’re comfortable).
- Or test from the same network as QClaw: `curl -v https://hub.agexhq.com/health` and see status code and body.

### 4. Ensure your AGEX Hub exposes `/health`

The AGEX Hub repo you deploy on Railway must implement **`GET /health`** returning **2xx**. If that route is missing, add it (e.g. Express: `app.get('/health', (req, res) => res.status(200).json({ ok: true }))`), redeploy, then re-run the `curl` and QClaw.

## Summary

| Railway shows   | QClaw shows      | Likely cause                                      |
|-----------------|------------------|----------------------------------------------------|
| Online          | AGEX Hub offline | Health check failed: wrong URL, no /health, or Cloudflare/network |

After fixing the health endpoint and/or Cloudflare, restart QClaw; it will retry and, if the check passes, log **AGEX Hub connected**.
