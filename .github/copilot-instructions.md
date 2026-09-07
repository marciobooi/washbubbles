# AI Coding Agent Instructions — WashBubbles

This file is the source of truth for any AI coding assistant (GitHub Copilot,
Claude, or otherwise) working in this repository. Prefer what's written here
over generic training-data assumptions about "how a project like this
usually works" — several things here are specific to this codebase and easy
to get wrong by guessing.

## What this project is

A laundromat/vending POS system with three deployable pieces:

- **`backend/`** — Node/Express + MongoDB API, deployed to a cloud server
  (Hetzner). Multi-tenant. Also hosts a WebSocket hardware-agent endpoint.
- **`src/`** — React/Vite web app, serves both the customer-facing kiosk UI
  (`/`) and the admin dashboard (`/admin`). Same build, different routes.
- **`pos-client/`** — the real kiosk: an Electron app that runs fully
  offline-first (local SQLite via `sql.js`, an embedded hardware agent, a
  background sync engine). This is the current, primary kiosk architecture —
  see `ARCHITECTURE.md`.
- **`virtual-serial-server/`** — a ccTalk hardware emulator for testing
  coin/bill acceptors and hoppers without real devices (see below).

`backend/src/hardwareAgent.js` + `backend/src/agentServer.js` are an older,
secondary "standalone agent" architecture (agent connects to the cloud
backend directly instead of running embedded in Electron). Both
implementations now speak the same protocol; the embedded one in
`pos-client/` is what actually ships.

## Real docs — read these, not this file, for details

- `ARCHITECTURE.md` — system diagram and data flow.
- `backend/src/HARDWARE_AGENT_README.md` — hardware agent protocol and setup.
- `backend/README.md`, `pos-client/README.txt`, `virtual-serial-server/README.md`.

## Local dev

```bash
npm install                 # root deps (frontend); postinstall also installs backend/
cd backend && npm install   # if postinstall didn't run
npm run dev                 # frontend (vite) + backend concurrently
npm --prefix backend run seed   # creates admin/kiosk users + a default tenant
```

Or the full stack in Docker (mirrors the real deployment topology — nginx
reverse-proxying `/api` and `/ws` to the backend, same origin):

```bash
cp docker/env.example .env.docker   # fill in JWT_SECRET / KIOSK_API_KEY
docker compose --env-file .env.docker up --build
```

Backend tests: `cd backend && npm test` — needs a real reachable MongoDB
(`MONGODB_TEST_URL`, defaults to `mongodb://localhost:27017/washstore_test`).
Not `mongodb-memory-server` — deliberately removed, its downloaded binary is
unreliable across architectures/CI.

## Things that are easy to get wrong here

- **The hardware protocol is ccTalk, not MDB and not plain text.** Coin/bill
  acceptors and the hopper communicate via ccTalk (binary, framed,
  poll-based — the host must poll for events, a device never pushes data
  unsolicited). See `pos-client/electron/hardware-agent.cjs`'s `CcTalkLink`
  class. `virtual-serial-server` emulates real ccTalk and is the right tool
  to test against (via a `socat`-created PTY pair on macOS/Linux, or
  com0com on Windows) — don't assume its README's older com0com-only
  instructions are the only way to run it; `USE_MOCK=false` with explicit
  `--ports`/`--mapping` args works against any real serial path.
- **Currency values are never hardcoded in the hardware agent.** Coin/bill
  acceptors report a raw device type code (e.g. `'0x03'`); the actual euro
  value comes from the admin-configurable `coinEqTable`/`billEqTable`
  settings (`Setting` model, edited via the admin dashboard's "Coin & Bill
  Machine" section, synced to each kiosk's local SQLite). Same pattern for
  the hopper's coin denomination and its max-dispense-per-transaction safety
  limit (`hopperCoinValue`, `hopperMaxDispenseCoins`) — these are business
  values an operator should be able to change without editing any kiosk's
  local files, not constants to bake into code.
- **The admin dashboard's peripheral records are inventory metadata, not
  live config.** `AdminPeripherals.jsx` / the `Peripheral` Mongo model let an
  admin record what hardware exists at a site, but a kiosk's actual serial
  port wiring comes entirely from the local, per-kiosk
  `pos-client/config.json` file (loaded by `main.cjs`'s
  `loadHardwareConfig()`). These two are not synced to each other.
- **Never commit real secrets.** `backend/config.json` and
  `pos-client/config.json` hold the real hardware-agent API key and are
  gitignored — edit them locally from the `.example` templates, never
  un-ignore them. Same for `.env.docker` (real secrets) vs
  `docker/env.example` (template).
- **`JWT_SECRET` has no fallback on purpose.** `backend/src/index.js` exits
  at startup if it's unset. Don't reintroduce a default value.
- **Money math**: everything is in whole euros (this project is euro-only —
  don't add currency-selection code speculatively). Round with
  `Math.round(x * 100) / 100`, matching the existing `roundMoney()` helpers,
  to avoid floating-point drift.
- **Offline-first data safety in `pos-client`**: a sale is written to local
  SQLite inside a transaction and force-flushed to disk *before* the
  machine is even activated (`pos-engine.cjs`'s `processSale()`) — this is
  intentional ordering, don't reorder it. Sync to the cloud backend happens
  later, from a durable outbound queue, and is allowed to fail/retry
  without losing the local record.
- **Watch for "finished-looking but dead" code.** This codebase has more
  than one instance of a fully-written handler function that references
  state which was never declared, or that no JSX ever calls — it looks
  complete on a skim but throws or silently does nothing if actually
  triggered. When touching a file, check that what you're editing is
  actually wired up (called from somewhere, references only variables that
  actually exist) rather than assuming existing code in the file works.

## Testing changes

There is no dedicated frontend test suite. For frontend/hardware changes,
prefer an actual runtime check over reading the code and assuming it works:
run the dev server or Docker stack and click through the flow, or (for
hardware protocol changes) run `virtual-serial-server` against a real
`socat` PTY pair and exercise the agent code directly with a small Node
script — don't trust a protocol implementation until it's been exercised
against `virtual-serial-server` or real hardware.
