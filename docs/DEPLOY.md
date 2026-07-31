# Putting this on your own domain

Two routes. Pick by whether you mind cold starts more than you mind $5 a month.

|  | Route A — free tier | Route B — one small VPS |
|---|---|---|
| Cost | **$12/year** (domain only) | **~$12/year + ~$5/month** |
| Hosts | GitHub Pages + Render | one box, everything |
| Cold start | ~50s after 15 min idle | none |
| Rooms survive idle | ❌ sleeping wipes every table | ✅ |
| You maintain | nothing | OS updates, the box |
| Config | set `VITE_WS_URL` | none — same origin |

**Start with A.** It costs a domain and nothing else, and you can move to B later
without touching code. Go to B the day real players are at tables, because that
is when losing every room to an idle timeout stops being acceptable.

---

## Step 0 — buy the domain (both routes)

[Cloudflare Registrar](https://dash.cloudflare.com) → Domain Registration. It
sells at wholesale with no markup and no cheap-first-year trick, and WHOIS
privacy is included. A `.com` is about **$10–12/year**.

Avoid anything that could be mistaken for **Baccarat S.A.**, the French crystal
house that owns the trademark and `baccarat.com`. A descriptive compound —
`baccaratsimulator.com` — is safe because it plainly describes the card game.
A near-miss of the mark is what gets a domain taken off you.

---

## Route A — GitHub Pages + Render (free)

### A1. Deploy the table service

[Render → New Blueprint](https://dashboard.render.com/blueprint/new), point it at
this repository. It reads `render.yaml`, builds the existing `Dockerfile`, and
gives you `https://baccarat-table-service.onrender.com`.

Nothing in `server/` changes: it already binds `0.0.0.0:$PORT`, which is all any
container host asks for.

### A2. DNS at Cloudflare

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `@` | `185.199.108.153` | **DNS only** |
| A | `@` | `185.199.109.153` | **DNS only** |
| A | `@` | `185.199.110.153` | **DNS only** |
| A | `@` | `185.199.111.153` | **DNS only** |
| CNAME | `www` | `sabiennguyen.github.io` | **DNS only** |
| CNAME | `tables` | `baccarat-table-service.onrender.com` | **DNS only** |

> ⚠️ **Grey cloud, not orange.** Cloudflare's proxy stops GitHub issuing the TLS
> certificate and you get a redirect loop. Turn the proxy on later, if you want
> it, once the certificate exists — and use SSL mode *Full (strict)*.

> Confirm those four IPs against GitHub's *"Managing a custom domain for your
> GitHub Pages site"* docs before pasting. They are long-standing, but they are
> GitHub's to change, not mine.

The `tables` CNAME is worth the extra minute: players never see an
`onrender.com` URL, and moving hosts later is one DNS edit instead of a rebuild.

### A3. Point the site at the tables

Repository → Settings → Secrets and variables → Actions → **Variables** → New:

```
VITE_WS_URL = wss://tables.baccaratsimulator.com/ws
```

The deploy workflow passes it into the build. Without it the client falls back to
`/ws` on its own origin, which on Pages is nothing — so multiplayer would show
its offline screen while single player carried on working.

### A4. Turn on the custom domain

Add `web/public/CNAME` containing exactly your domain (no scheme, no slash) —
`web/public/` is copied into `dist`, so it ships with the deploy.

Then Settings → Pages → Custom domain → enter it → wait for the certificate →
tick **Enforce HTTPS**.

---

## Route B — one VPS (~$5/month)

Cheapest sensible boxes: **Hetzner CX22** (~€4) or a **$6 DigitalOcean droplet**.
Any 1 vCPU / 2 GB Ubuntu box is plenty — the table service is a single Rust
binary holding rooms in memory.

### B1. DNS

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `@` | your server's IPv4 | DNS only at first |
| CNAME | `www` | `baccaratsimulator.com` | DNS only at first |

### B2. On the box

```sh
# Docker, then the app
curl -fsSL https://get.docker.com | sh
git clone https://github.com/SabienNguyen/baccarat-sim.git
cd baccarat-sim
docker build -t baccarat .
docker run -d --restart=always -p 127.0.0.1:8788:8788 -e PORT=8788 baccarat
```

Binding to `127.0.0.1` keeps the service off the public internet — only Caddy
reaches it.

### B3. TLS, without thinking about it

```sh
apt install -y caddy
# copy the Caddyfile from this repo to /etc/caddy/Caddyfile, edit the domain
systemctl reload caddy
```

Caddy obtains and renews the certificate itself. No certbot, no cron, no expiry
to forget.

**Set no `VITE_WS_URL` on this route.** One host serves the pages and the socket,
so the client's same-origin default is already correct — and a value that can't
drift is better than one that can.

---

## After either route

The site URL is hard-coded in **51 places across 15 files** — canonical tags,
`og:url`, `sitemap.xml`, `robots.txt`, the share card, both READMEs and the crate
metadata. Change them in the same commit as the DNS switch, so canonical tags
never advertise the old host while the new one is live.

Verify with an actual browser rather than trusting the dashboard:

```sh
curl -I https://baccaratsimulator.com          # 200, and HTTPS not redirecting in a loop
curl -s https://baccaratsimulator.com/health   # route B only: room and connection gauges
```

Then open the site, start a live table, and watch the browser console: a failed
socket shows up as the offline screen rather than an error, so the console is
where the real reason is.
