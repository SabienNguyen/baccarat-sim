# Deploying to baccarat-sim.com

The site lives at **https://baccarat-sim.com/** (GitHub Pages, custom domain) and
the multiplayer table service at **wss://table.baccarat-sim.com/ws** (the Fly app
`baccarat-sim`; its `baccarat-sim.fly.dev` hostname keeps working alongside).
The domain was bought at [Spaceship](https://www.spaceship.com) on 2026-09-09.

| | Production (this doc) | Alternative — one small VPS |
|---|---|---|
| Cost | domain only (~$12/year) | domain + ~$5/month |
| Hosts | GitHub Pages + Fly | one box, everything |
| Config | Actions variable `VITE_WS_URL` | none — same origin |
| Rooms survive idle | depends on Fly `min_machines_running` | ✅ |

The apex is canonical. `www.` only redirects; nothing links to it.

---

## Cutover runbook

Do these in order. Each step depends on the one before it.

### 1. DNS at Spaceship

Spaceship → Domain → **Advanced DNS**. Delete any parking records it created,
then add:

| Type | Host | Value | TTL |
|---|---|---|---|
| A | `@` | `185.199.108.153` | auto |
| A | `@` | `185.199.109.153` | auto |
| A | `@` | `185.199.110.153` | auto |
| A | `@` | `185.199.111.153` | auto |
| AAAA | `@` | `2606:50c0:8000::153` | auto |
| AAAA | `@` | `2606:50c0:8001::153` | auto |
| AAAA | `@` | `2606:50c0:8002::153` | auto |
| AAAA | `@` | `2606:50c0:8003::153` | auto |
| CNAME | `www` | `sabiennguyen.github.io` | auto |
| CNAME | `table` | `baccarat-sim.fly.dev` | auto |

> The A/AAAA addresses are GitHub's, from *"Managing a custom domain for your
> GitHub Pages site"*. They are long-standing, but confirm them against that page
> before pasting — they are GitHub's to change.

Wait for propagation before going on (usually minutes, up to an hour):

```sh
dig +short baccarat-sim.com A          # the four 185.199.x.153 addresses
dig +short baccarat-sim.com AAAA       # the four 2606:50c0:800x::153 addresses
dig +short www.baccarat-sim.com CNAME  # sabiennguyen.github.io.
dig +short table.baccarat-sim.com CNAME # baccarat-sim.fly.dev.
```

### 2. GitHub Pages custom domain

`web/public/CNAME` contains exactly `baccarat-sim.com` and Vite copies
`public/` into `dist`, so every deploy ships it — Pages reads that file, and it
is what makes `www.baccarat-sim.com` redirect to the apex automatically.

Then repository → **Settings → Pages → Custom domain** → `baccarat-sim.com` →
Save. Pages runs a DNS check and provisions a certificate; once the check is
green (a few minutes after DNS resolves), tick **Enforce HTTPS**.

> If the checkbox is greyed out, the certificate isn't issued yet. Wait, reload
> the settings page; don't remove and re-add the domain, that restarts the clock.

### 3. Fly certificate for the table subdomain

```sh
flyctl certs add table.baccarat-sim.com -a baccarat-sim
flyctl certs check table.baccarat-sim.com -a baccarat-sim   # repeat until "Issued"
```

The `table` CNAME from step 1 is all Fly needs for validation: it sees the
hostname resolve to the app and issues a Let's Encrypt certificate. If `check`
reports the DNS is not configured, the CNAME hasn't propagated yet.

Confirm the socket endpoint answers on the new hostname before pointing the
site at it:

```sh
curl -sS https://table.baccarat-sim.com/health
```

### 4. Point the site at the tables

Repository → Settings → Secrets and variables → Actions → **Variables** →
`VITE_WS_URL` (edit, or New repository variable):

```
VITE_WS_URL = wss://table.baccarat-sim.com/ws
```

The value must be the full socket URL **including the `/ws` path** — the client
(`web/src/multiplayer/protocol.ts`, `socketUrl()`) uses it verbatim and appends
nothing. Left unset, the client falls back to `/ws` on its own origin, which on
Pages is nothing: multiplayer would show its offline screen while single player
carried on.

A variable change does not trigger a build on its own. Re-run the deploy:
**Actions → Build & Deploy → Run workflow** (on `main`), or push to `main`.

### 5. Verify

```sh
curl -sI https://baccarat-sim.com/ | head -1            # HTTP/2 200
curl -sI http://baccarat-sim.com/ | grep -i location    # → https://baccarat-sim.com/
curl -sI https://www.baccarat-sim.com/ | grep -i location  # → https://baccarat-sim.com/
curl -s  https://baccarat-sim.com/CNAME                 # baccarat-sim.com
curl -s  https://baccarat-sim.com/robots.txt | grep Sitemap  # https://baccarat-sim.com/sitemap.xml
curl -sS https://table.baccarat-sim.com/health          # room and connection gauges
```

Then open the site, start a live table, and watch the browser console: a failed
socket shows up as the offline screen rather than an error, so the console is
where the real reason is. The bundle should be opening
`wss://table.baccarat-sim.com/ws` — if it still opens `wss://baccarat-sim.com/ws`
(its own origin), the variable wasn't in the build; check step 4.

Finally, in Google Search Console, add `baccarat-sim.com` as a Domain property and
submit `https://baccarat-sim.com/sitemap.xml`. The old `github.io` property can
be left to expire; GitHub serves a 301 from it once the custom domain is set.

---

## Where the URL lives in the repo

The site URL is hard-coded in the canonical tags, `og:url`, JSON-LD, `sitemap.xml`,
`robots.txt`, the share card fallback, both READMEs, `docs/`, and the crate
metadata. The generated content pages (`web/public/{how-to-play,glossary,...}`)
take it from `SITE` in `web/scripts/build-content.mjs`. If the domain ever
changes again, do it in one commit:

```sh
grep -rn "baccarat-sim.com" --exclude-dir=node_modules --exclude-dir=dist .
```

and change `web/public/CNAME` in the same commit, so canonical tags never
advertise a host that isn't live.

---

## Alternative — one VPS (~$5/month)

If Fly's idle stop (`min_machines_running = 0` in `fly.toml`) ever costs real
players their rooms, the cheapest fix is one always-on box serving site and
socket together. **Hetzner CX22** (~€4) or a **$6 DigitalOcean droplet** — any
1 vCPU / 2 GB Ubuntu box is plenty; the table service is a single Rust binary
holding rooms in memory.

### DNS

Replace the Pages records with:

| Type | Host | Value |
|---|---|---|
| A | `@` | the server's IPv4 |
| CNAME | `www` | `baccarat-sim.com` |

Drop the `table` CNAME too — on this route the socket is same-origin.

### On the box

```sh
curl -fsSL https://get.docker.com | sh
git clone https://github.com/SabienNguyen/baccarat-sim.git
cd baccarat-sim
docker build -t baccarat .
docker run -d --restart=always -p 127.0.0.1:8788:8788 -e PORT=8788 baccarat
```

Binding to `127.0.0.1` keeps the service off the public internet — only Caddy
reaches it.

### TLS

```sh
apt install -y caddy
# copy the Caddyfile from this repo to /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy obtains and renews the certificate itself.

**Unset `VITE_WS_URL` on this route** (delete the Actions variable and redeploy,
or stop using Pages altogether — the server serves `web/dist` itself via
`SPA_DIR`). One host serves the pages and the socket, so the client's
same-origin default is already correct, and a value that can't drift is better
than one that can.

### Render instead of Fly

`render.yaml` is a ready blueprint for Render's free tier (no card, WebSockets
supported, ~50s cold start after 15 min idle). Point
[a new Blueprint](https://dashboard.render.com/blueprint/new) at this repository,
then swap the `table` CNAME to the `onrender.com` hostname it gives you. Nothing
else changes: the client still reads `wss://table.baccarat-sim.com/ws`.
