# Go-live tests — what is done, what is left

Shop PC `a8-max` (Windows 11), controller `192.168.2.201:16852` on the PC's **"Ethernet"** port
(`192.168.2.190/24`, no gateway), central server Hetzner (`freshbubbles.pt`).
Tick a box only after it was *seen working at the machine*, not when the code merely passes tests.
Written 2026-10-09. Related: `docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md` §9, §11, §14.

## 0. Before anything: put the latest code on the PC

Done 2026-10-10 (PC on, SSH over Tailscale): everything tracked in git copied to `C:\washbubbles`, dependencies installed, screen rebuilt, backend restarted.

- [x] Latest code on the PC (all 274 tracked files; the PC matches commit `116e07c` or later)
- [x] Screen rebuilt with the kiosk key, backend restarted by the boot task
- [x] Backend log shows `Low-level controller connected` and `[Downlink] in step with central`
- [ ] **Hopper has coins in it**: note how many and of which values (owner to check at the machine)
- [x] Press F5 on the kiosk (or restart Edge) so it runs the new screen  **DONE: the screen now reloads itself when idle after every update**

## 0a. Operating rule: only one PC at a time

The old PC is the live shop until we migrate. **The two PCs are never switched on at the same time** (owner's rule): the new PC is
switched on only when the admin is at the shop or at a quiet time, and then the old PC is off. That is what keeps the controller
(which probably takes one client only) and the hardware address (`192.168.2.190`, the same on both PCs) free of clashes.

- [x] Badge and countdown vanish by themselves after the refund (owner 2026-10-10, after the websocket reconnect fix 6dfa1fc)
- [ ] Keep to the rule: new PC on ⇒ old PC off. If it ever has to be otherwise, unplug the new PC's `Ethernet` (controller side) cable first
- [ ] To switch the shop back to the old PC: switch the new PC off (or set `LOWLEVEL_ENABLED=false` and restart its backend), then start the old PC

## 1. Already proven ✔ (do not redo, only re-check if something changes)

- [x] SSH to the PC over Tailscale; backend starts at boot; app + MongoDB installed
- [x] Hetzner → PC: machines, prices, interfaces, peripherals, settings pulled; PC → Hetzner: sales/cards up
- [x] All 6 peripherals report `ok`; the central admin shows the live status
- [x] Coins read and credited: €0.10=`4`, €0.20=`5`, €0.50=`6`, €1=`7`, €2=`8` (`Coin accepted` in the log)
- [x] Credit badge shows on the kiosk for coins
- [x] Admin Start from Hetzner reaches the shop PC within seconds (pipeline proven with a refused start)

## 2. Bills — unfinished from before

- [x] **€10 bill is credited**: put the note in again (it was swallowed uncredited while being read); log must say  **DONE 2026-10-19: `bill-inserted 10` -> `Bill accepted: 10.00`, credit +10 (several times)**
      `Bill accepted: €10.00` and the badge goes up by €10. The table (`billEqTable`: `"10"`→10) was saved but this
      was never confirmed
- [x] **€5 bill** (code `5`, credited and refunded as coins, 2026-10-10): insert one, read the code from the log (`bill-inserted`), add it to `billEqTable` in Hetzner, insert again
- [x] **€20 bill** (code `20`, credited and refunded as 20 EUR in coins, 2026-10-10): same
- [ ] €50 note: **the shop does not accept it** (owner 2026-10-10), so it has no code in the table. Still to test: insert one and check the acceptor itself spits it back instead of stacking it (a stacked unmapped note = customer loses EUR 50 with no credit; fix is on the acceptor, disable the 50 channel)
- [ ] **The bill acceptor is an ICT XBA-32DNMEU6 (owner-confirmed): it keeps every note, it can never give one back.** So a customer's cash credit
      is always repaid in coins, and the **hopper must always hold enough coins** for the bills it lets in (a €20 note can mean €20 in coins).
      Decide: when the hopper stock is low, stop accepting the big notes (the acceptor can be told to refuse a denomination), or warn the operator earlier
      **Idea from the owner:** with the hopper low, a big note is only worth accepting when a machine is already chosen, because then only
      `note + credit − price` has to come back in coins (with nothing chosen, the whole note might). Two things are missing before this can be built:
      (1) a way to **refuse a note before it goes in** (nothing in our code or the docs: the controller's list of messages has no "inhibit"; test/ask
      the vendor, because a stacked note cannot be refused afterwards), and (2) a **live count of the coins in the hopper** (today only the operator's
      day-close count; the app tracks stock only for hoppers it drives itself). Without (1) the guard can only warn on screen and alert the operator
- [ ] Wrong/foreign note: acceptor rejects it and the kiosk shows the message (`peripheral:rejected`), nothing credited
- [ ] Bill acceptor jam / stacker full: message shown, peripheral turns red in the central admin
- [x] The fallback table on a PC that never was online now holds `"5"`, `"10"`, `"20"` (was only `"10"`); decide if more codes should be built in

## 3. Refund of unspent cash (new, never run on hardware)

- [x] Insert one coin, touch nothing: after **2:00** the hopper pays it back; toast "Crédito devolvido"; badge disappears;
      log `[Refund] … paid back (idle)`; audit entry `cash.refund`  — **seen 2026-10-10**: €1 coin (code 7) → 2 min → `get-change 100` → `no-change 0` → refund paid, audit `cash.refund`; the owner saw the timer and the money come back
- [x] Countdown "devolução em m:ss" is visible and counts down  — seen 2026-10-10 (owner)
- [x] Touching the screen restarts the countdown (keepalive); a coin/bill restarts it too — touch confirmed by owner 2026-10-10
- [ ] Reload the page (F5) with credit inside: the badge comes back with the right amount and the right countdown
- [ ] **Short payout**: with an empty/low hopper the part that cannot be paid stays as credit, the screen says to
      contact the counter, audit `cash.refund.short` shows the amount owed
- [ ] A customer with a card loaded is **not** refunded in coins (the card flow takes the unspent cash)
- [ ] Refund works with **no internet** (unplug `Ethernet 3`, then repeat the first test)
- [ ] Admin forced refund: `POST /api/middleware/client/refund`
- [ ] Refund time: change it in the admin (Periféricos → "Devolução automática do crédito"); within ~5 min the PC uses it
      (check the countdown length on the kiosk); `0` turns the refund off; 3601 or `abc` are refused by the server
- [ ] A coin/bill code changed in Hetzner is applied on the PC after the next pull, **without a restart**

## 4. Change from the hopper (never tested)

- [x] Buy something cheaper than the cash inserted: change is paid out, exact amount, coins in the tray  **DONE 2026-10-19: 35 EUR credit, 2 EUR dryer, `get-change 3300` -> 33 EUR really dropped (and 4 x 1 EUR coins paid 2 dryers with no change due)**
- [ ] Change when the hopper cannot cover it: the shortfall is reported to the customer and logged (no silent loss)  **FOUND 2026-10-19: a jammed hopper answered `hopper-status 400` + `no-change 0`; it was read as paid (6 EUR owed, nothing dropped). FIXED (a hopper fault = nothing paid, change stays as credit + operator audit `cash.change.owed`, unit test); not yet seen again at the machine**
- [ ] `hopperCoinValue`/`hopperMaxDispenseCoins` are right for the coins actually loaded
- [ ] Hopper stock counter (`hopperConfig.currentCount`) goes down after payouts and survives a restart/pull  **N/A for now: the stock per coin stays a manual count (13.5b/13.5c)**

- [x] **Which coins does the controller pay?** (owner 2026-10-10: mixed coins, exact total, accepted as fine; biggest-first not controllable from the app) (2026-10-10 owner, EUR 10 refund: total exact, but the mix of coins was random, not biggest-first; the controller chooses, ask the vendor for a per-coin / priority option) In the shop the app only sends the total to the controller (`get-change`, in cents) and the
      controller chooses the coins, so "biggest coins first" has to be seen at the machine. For each of €0.30, €1.70, €3.80, €5.00 and €9.90:
      insert that much cash, use the operator refund (`POST /api/middleware/client/refund`), and write down which coins fell. The backend log
      prints `biggest coins first would be …` for each request: compare the two. If the controller does not pay biggest-first, find out
      (vendor / its configuration) whether it can be told, because the app cannot choose coins by itself in this mode
- [ ] **Bills are never returned**: every payout, including the automatic 2-minute refund of a bill's credit, must come out as coins only. Check that a €10 bill's
      credit comes back as coins, and what happens when the hopper has too few coins (the shortfall must stay as credit, with the amount owed in the audit log)
- [ ] **Decide what happens to change that cannot be paid** (hopper empty): today it stays as credit on the kiosk and the operator is told. Option: offer it as
      credit on a card. Decide with the owner
- [ ] The controller can send a **`per-notification`** message (a peripheral `type`, a `code` and a `msg`). Our app does not handle it yet (it only logs
      "Unhandled package"). With the PC on, see which codes really arrive (jam, empty, ...) and then turn them into alerts and an admin message

## 5. A real paid machine start

First settle the wiring (see §9), then:

- [x] Pick a machine that is wired, empty and safe to run; pay the **exact** amount in cash (no change involved)  **DONE 2026-10-19: Lavar 1 (10.50), Secar 7/8/9/11**
- [x] Log shows `activate-machine sent via controller: interface <addr>, channel <n>` and the washer really starts  **DONE: `activate-machine` code 200 + `machine-started`; the machine signal turns busy**
- [ ] Machine turns "Ocupado" on the kiosk and in the central admin, and frees itself when the cycle ends  **PARTLY: Ocupado on the kiosk and in the central seen (Lavar 1). Frees itself at the end of the cycle: not confirmed yet**
- [x] **Pulse timing**: `tOn=5 / tOff=1` is an unverified unit. If nothing starts, the pulse is probably too short  **DONE: machines start; 5 impulses in one command = 75 min, so `tOn=5 / tOff=1` is fine**
- [x] Pay with more cash than the price: machine starts **and** change is paid (§4)  **DONE 2026-10-19: machine started and 33 EUR of change paid**
- [ ] Pay with card balance; pay with part cash + part card
- [x] A dryer: the time bought = impulses × 15 min (`tImp`); polarity `low` machines read busy/free correctly  **DONE: 5 x 15 min = 75 min exactly (Secar 7). Polarity of the low machines: only observed, not systematically checked**
- [x] Two machines in one cart start both  **DONE 2026-10-19: Secar 8 + 9 in one payment (and later again)**

## 5b. What do the machines actually tell the app? (find missing or unused signals)

Today the app really uses almost nothing beyond **busy / free** (plus a fault flag) per machine. Before go-live, record what the
controller and the machines send, so nothing useful is thrown away and nothing is wrongly assumed. Keep `LOWLEVEL_TRACE=true`.

**The machines** (told by the owner, 2026-10-09): all are made by **Krebe** (Krebe-Tippo, Maribor, Slovenia), but different models and years,
for example **SKS-16-G (2015)** and **SKS-17-G (2014)**. No public manual was found for these models, so the signal list has to
come from the machines and the controller themselves, or from the maker or the Portuguese distributor.

- [ ] **Write down the model and year of each of the 9 machines** (name plate on each) and enter brand + model in the admin
      (Máquinas), so the differences between models can be matched with the differences in their signals
- [ ] **The dryers are gas-fired** (confirmed by the owner). Safety signals matter most: ignition failure, overheating and airflow faults
      should raise an alert (email/WhatsApp) and take the dryer out of service in the admin. Find out which signal, if any, says this
- [ ] Compare the real signals with `docs/KREBE-SKS-17G-UNVERIFIED.md` (an AI-written list of error codes, states and registers for the SKS-17 G:
      **unverified**, only a list of things to look for; keep what is seen, throw away what is not)
- [ ] **Ask Krebe-Tippo or the distributor** for the technical manual / interface description of each model (what the coin or
      pulse input expects, and what status signals the machine outputs). Older and newer models may signal differently
- [ ] **Full-cycle recording, one machine of each kind** (a washer and a dryer): start it and keep the trace from start to finish.
      Save the raw log lines into `docs/` (what happened at the machine, with the time, next to each controller message)
- [ ] **List every message type (`op`) the controller sends** over a full day and count them. Any `op` the app does not handle
      is a candidate for a missing feature (the backend should log unknown ones; check that it does)
- [ ] **`status_int` bit strings**: each interface answers with 8 bits (for example `00000010`), but the app only reads the last two  **PARTLY 2026-10-19: opening the door of Secar 7 and 11 changes NO bit. Start / finish / power cut not tried**
      (the two channels). Switch things at the machine (open the door, start, finish, cut power to the interface) and see which of
      the **other bits** change. They may carry door open, door locked, fault or "cycle finished"
- [ ] The app already decodes `fault`, `occupied`, `doorLocked`, `doorClosed` per machine (visible in the log as
      `Machine … status update`): confirm that each of these four really follows the machine, and for which machines
- [ ] `machine-started`, `door-opened` and `machine-issue` events: trigger each one on purpose and check what the app does with it
- [ ] **Interface offline** (`active:"0"`): unplug one interface and check the machine turns "fault" in the app, in the kiosk and in the
      central admin, and the operator is alerted
- [ ] Does any machine report a **remaining time**, a **program**, a **cycle counter** or an **error code**? If yes: show it in the
      admin/kiosk; if not, say so here, so we stop looking
- [x] Polarity per machine (`activation` high/low): confirm busy and free are not swapped on any machine (lavar 1 and lavar 5 read busy at rest)  **DONE: Lavar 1 verified; Lavar 4 and 5 are really running (owner), nothing swapped**
- [ ] Write down which signals we **do not use yet** and decide, one by one: show to the customer, show to the operator, alert on, ignore
- [ ] Ask the vendor for the full list of machine and interface messages (also the open questions in `docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md` §11)

## 6. Admin Start / End from the central admin

- [ ] Hetzner admin → Operações → **Iniciar** on a wired, empty machine: it starts within ~5 s without payment;
      the admin shows "Pedido enviado ao posto", then "Ocupado" once the shop confirms
- [ ] Same from the PC's own admin (`http://localhost:3000`): starts at once
- [x] **Parar** frees the machine in the system (the controller has no stop command: a running cycle finishes by itself)  **CONFIRMED 2026-10-19 (owner): the machine keeps its paid cycles; the admin now warns before Parar**
- [ ] Start on an unwired / already running machine is refused with a readable reason
- [ ] A command sent while the PC is offline is **not** run hours later (older than 2 min = expired)

## 7. Receipt printer (never tested)

- [ ] Print a receipt from the kiosk after a sale (`print-receipt`): paper comes out, readable, correct total  **BLOCKED 2026-10-19: the printer is really broken (owner); disabled in the admin. Test after the repair**
- [ ] Out-of-paper / printer fault: shown as a peripheral problem, the sale is not blocked
- [ ] Email receipt (needs the mailbox password, see §12)

## 8. Cards (RFID reader and dispenser — never tested)

- [x] Present a card: it is read (`card-inserted`), balance shown (owner 2026-10-10, after the kiosk got `rfid:card_detected`)
- [x] Recharge a card with cash; balance written to the card **and** to the database, and synced to Hetzner — chip write seen: `write-card` 1470 -> `201 ok`, card 14.70, Hetzner 14.70 (2026-10-10; the first attempt lost the EUR 10 to a stale save, fixed in fa4dc70, credited by hand with audit `card.manual_credit`)
- [x] Buy a new card: the dispenser releases one, it is written (`write-card` 201) and activated  **DONE 2026-10-19: dispenser released it, `write-card` 201, activated with 5.00 (three times)**
- [ ] Card removed mid-way: no double credit, unspent cash goes onto the card
- [ ] Blocked / `pending_write` card: the right message
- [ ] `get-version` gets no reply from the controller (known); check it does not matter

## 9. Machine wiring — decide and fix in Hetzner (source of truth)

- [x] **Lavar 1**: PC has INT 6 (addr 16) port 1, Hetzner has **nothing**. Decide the true wiring and set it in Hetzner  **DONE: now Int 1 / port 2 on both and verified with a real cycle**
- [ ] **Lavar 2**: INT 6 port 2 on both — confirm it is physically right
- [ ] Walk every machine (1–9): the interface + port in the admin is the washer/dryer you are standing at
- [x] **Lavar 1 and Lavar 5 read busy** from the controller although nobody uses them: real, or wrong polarity  **DONE: not a fault (4 and 5 were running; Lavar 1 reads free at rest and busy while running)**
      (`activation` high/low)? Fix before real customers
- [ ] The pull cannot *remove* a field: clearing a machine's interface in Hetzner does not clear it on the PC
      (needs `$unset` support in `services/downlink.js`)

## 10. Offline day (the shop must work with no internet)

- [ ] Unplug the internet (`Ethernet 3`): coins/bills are credited, a machine can be bought and starts, change is paid
- [ ] Sales and card changes queue (`SyncOutbox`) and **all arrive in Hetzner, once each**, after reconnecting
- [ ] A fresh PC offline on day one still recognises coins (fallback codes, §2) and loads machines/prices stored locally
- [ ] Central admin shows the shop as stale/offline sensibly while it is disconnected

## 11. Reboot and power cut

- [x] Restart the PC: it logs in by itself, backend up before login, Edge opens full-screen kiosk, Tailscale/SSH back  **DONE 2026-10-20 23:42: signed in by itself in 11 s (no password), backend up before login, Edge full-screen kiosk, SSH back**
- [ ] Power cut with credit inside: after power returns the credit is back (≤30 min) and is refunded after 2 min
- [x] Backend crash: `run-backend.bat` restarts it, the kiosk page recovers by itself  **DONE: `run-backend.bat` restarted it every time it was stopped on 2026-10-19/20; the kiosk page recovered**
- [ ] Windows Update must not reboot the PC in opening hours (set active hours / policy)

## 12. Loose ends

- [ ] **Passwords**: admin/kiosk passwords were printed in a chat during setup — rotate them and the kiosk API key  **STILL OPEN, and a new one: the password of the operator `tatiana` was typed in a chat on 2026-10-20 (she should change it at first sign-in: Alterar palavra-passe)**
- [ ] Email: set `MAIL_PASS` for `marcacoes@freshbubbles.pt` in `backend\.env` / `.env.docker`; send a real receipt and a password reset  **PARTLY 2026-10-19: the PC has the MAIL_* settings (copied from Hetzner) and the log now prints the mail server answer. Still to confirm: a receipt really arrives, and a password-reset mail**
- [ ] Windows auto-login has no password: confirm that is acceptable (physical access = full access)  **UPDATE 2026-10-20: auto-login now uses the account password stored by Windows (netplwiz); the account is a Microsoft account, so a password change breaks it until netplwiz is redone**
- [ ] TeamViewer is installed on the PC: keep or remove; Tailscale is the way in
- [ ] Old PC is switched off; decide when to wipe it. Keep its config backup until all machines are verified
- [ ] Backups: MongoDB on the PC (daily dump) and Hetzner
- [ ] Screen sizes: the kiosk page is 2×2 cards and bigger rows; check on the real screen, adjust if too big/small.
      The dryer list (9 machines) scrolls — check it is comfortable on touch
- [ ] Known flaky tests (not caused by the shop work): "Day close … double-book two closes racing" (~1 in 16) and some
      40 ms-timer uplink tests; fix the races when there is time

## 13. To test when the shop PC is next online (list made 2026-10-12)

The shop PC was switched off because the shop is working. Everything below is built and deployed to Hetzner; the PC needs
the latest code first (copy the files, build the screen, restart ONLY the backend: the process whose command line has
`src\index.js`, never every node process). The new payment window (13.5) is in the repo but not on the PC yet.

### 13.0a ONE-TIME: make the shop PC a real git checkout, so everything stays in sync with one `git pull`
Until now the PC has been updated by copying files by hand, so it may have drifted from the repo in places nobody listed.
Do this once, with the owner present, before the first pull of 13.0:
- [x] Back up first: copy `C:\washbubbles` to `C:\washbubbles-backup-<date>` (code only; `backend\.env`, `backend\data\`, `logs\` must be kept as they are)  **DONE 2026-10-19: C:\washbubbles-backup-20261019**
- [x] Check whether it already is a checkout: `git rev-parse --is-inside-work-tree` and `git remote -v` (expected remote: `https://github.com/marciobooi/washbubbles.git`, branch `main`)  **DONE: it was NOT (hand-copied)**
- [x] If it is NOT: `git init`, `git remote add origin https://github.com/marciobooi/washbubbles.git`, `git fetch origin`, then `git reset --hard origin/main`  **DONE via a git bundle, then the SSH deploy key**
      (`reset --hard` only touches tracked files: `.env`, `.env.*`, `node_modules/`, `dist/`, `logs/`, `backend\data\` are ignored or untracked and stay)
- [x] `git config core.autocrlf true` on the PC (Windows line endings) and `git config pull.ff only` (a pull must never create a merge commit on the PC)  **DONE**
- [x] The repo is on GitHub: if it is private, the PC needs a read-only credential (deploy key or fine-grained token); store it in Windows Credential Manager, never in the repo  **DONE: read-only SSH deploy key `shop-pc-a8-max` (core.sshCommand in the repo config); Hetzner has its own**
- [x] Compare what the PC had with the repo before the reset: `git diff --stat` on the hand-copied files; anything that differs and is not in the repo is a local edit to keep or discard (ask before discarding)  **DONE: 65 files differed, none was a local edit (all older repo versions)**
- [x] `npm install` in `backend\` and in the root only if `package.json` / `package-lock.json` changed in the pull  **DONE (the updater does it when a package file changes)**
- [x] Afterwards: `git status` is clean, `git log --oneline -1` equals the repo's latest, and an update is always: `git pull`, build the screen, restart only the backend if backend files changed  **DONE**
- [x] Do the same on the Hetzner server check: `/opt/washbubbles` is already a checkout (deploys use `git pull`); confirm its commit equals the PC's  **DONE: it pulls main by itself every minute (cron) with rollback**
- [x] Write the final update procedure into this file (one short block) so it is the single place to look  **DONE: see "Shop PC updates itself" at the end of this file**

### 13.0 THEN: bring the code up to date (git pull)
Last code copied to the PC was the dryer "one command, n impulses" change (`efc088c`). Everything after it is in the repo
but NOT on the PC yet; it is all screen (frontend) work, so **no backend restart is needed**:
- new payment window (`b83d130` ... `127ce73`: single column, 68% width, scales to the screen), `Modal.jsx`, `CartContext.jsx` export, dev-only `/dev/cart` preview
- docs / checklist updates

Steps (on the PC, PowerShell, in `C:\washbubbles`):
- [x] Check it is a git checkout: `git rev-parse --is-inside-work-tree` (if it is NOT: the files have been copied by hand so far; either `git init` + `git remote add origin <repo>` + `git fetch` + `git reset --hard origin/main`, or keep copying the changed files)  **DONE**
- [x] `git status` is clean (hand-copied files may show as modified: that is fine, the pull makes them match; `.env` and `logs\` are untracked and must stay)  **DONE**
- [x] `git pull origin main` (branch `main`); note the commit now on the PC: `git log --oneline -1` should be the latest of the repo  **DONE: now automatic (task WashBubbles Update, every minute)**
- [x] Build the screen with the kiosk key from `backend\.env` (`VITE_KIOSK_API_KEY` = the `KIOSK_API_KEY` line), then press **F5** on the kiosk  **DONE: automatic; the screen reloads itself when idle**
- [x] Backend: restart ONLY if backend files changed in the pull (`git diff --stat <old>..HEAD -- backend`); restart = stop the node process whose command line has `src\index.js`, never every node process (the bridge is also node)  **DONE: automatic, only src\index.js**
- [x] Confirm: health 200, bridge + backend both running, `status_per` lists six, a coin credits; then do 13.1 onwards  **DONE 2026-10-19/20 (three reboots)**

### 13.1 Money and the controller
- [x] After the PC boots: bridge task running (`WashBubbles Bridge`), backend connected through it, `status_per` lists the six peripherals in order  **DONE 2026-10-20: bridge 23:42:50, backend 23:42:56, status_per lists the six**
- [ ] Bill acceptor light on after a **backend restart** (the bridge keeps the session): verified once on 2026-10-11, repeat
- [ ] **PC reboot**: bridge and backend come back by themselves; the operator alert "controller session new" arrives; re-seat the acceptor cable and note the light  **PARTLY 2026-10-20: bridge + backend came back by themselves and the NEW automatic re-init of the six peripherals fired (the acceptor no longer needs a cable re-seat). Not yet seen: the operator alert e-mail "controller session new" (its trigger was fixed the same day)**
- [ ] Coins 0.10 / 0.20 / 0.50 / 1 / 2 and notes 5 / 10 / 20 credit; the 50 note is spat out (the acceptor must never stack it)  **PARTLY 2026-10-19: notes 5/10/20 and coins 0.10, 0.20, 1, 2 credit. Still open: the 0.50 coin and the 50 note being spat out (no 50 note at hand)**
- [ ] Refund after 2 minutes pays the exact total; the badge and countdown disappear by themselves (no F5)  **NOT CLEAN: the idle refund paid 35 EUR twice on 2026-10-19 (a screen time-out left the credit); fixed (the server zeroes the credit as the change starts). Repeat**
- [ ] Controller session lost (pull the controller network cable 10 s): alert "Controlador desligado", then recovery without a restart

### 13.2 Dryers: blocks of 15 minutes
- [x] Insert 4.00 EUR for **2 blocks** on a free dryer (Secar 7, 8 or 9): the log shows ONE `activate-machine ... impulses 2`; the dryer shows 30 min  **DONE 2026-10-19 (owner) and 5 blocks = ONE `activate-machine impulses 5`, 75 min exactly**
- [x] 3 blocks (6.00) gives 45 min; the 8-block limit (16.00) is accepted  **DONE (owner): 2/3 blocks and the 8-block limit OK**
- [x] If a 2-block purchase gives only 15 min: pulses too close together (interface tOn 5 / tOff 1 never verified); try `DRYER_IMPULSE_MODE=staggered`  **NOT NEEDED: the all-at-once mode works**
- [x] Cash already inserted, then choose a dryer: the cart does **not** pay by itself; the cycles can be changed; "Confirmar e iniciar" pays  **DONE (owner)**
- [ ] Change the cycles after confirming: it asks again
- [ ] Pay a dryer with the **card** (card price, 0.20 cheaper per block): same confirm step, card debited once, chip rewritten
- [ ] Secar 10: the signal line on interface 15 channel 2 is dead; after a paid start it stays "Ocupado" for n x 15 min (time block) and then frees itself
- [x] Not enough money inserted: nothing starts, the credit stays; controller offline at payment: nothing charged, readable message  **DONE (owner): nothing starts, the credit stays. Controller-offline case not run**
- [x] Door open / machine signals while a dryer runs (open the door): note the `machine-*` events and the 8 status bits  **DONE 2026-10-19: NO signal for the door (Secar 7 and 11); the dryer stops by itself and needs its own button**

### 13.3 Washers
- [x] Paid start of a washer with exact cash; Ocupado on the kiosk **and** in the central admin within seconds  **DONE 2026-10-19: Lavar 1, 10.50 EUR, Ocupado in the central within a minute**
- [ ] A washer is held for its price-row duration (60 min if none is set) when its signal never shows it running
- [x] Lavar 1: interface Int 1 / port 2, polarity high (occupied = signal on) verified with a paid 10.50 EUR wash on 2026-10-19: `activate-machine` 200, `machine-started`, held 45 min, central shows `working`
- [x] Lavar 6: really out of order (owner, 2026-10-19): nothing to configure, skip until it is repaired

### 13.4 Cards
- [ ] Buy a card WITHOUT inserting money: the Pay button stays disabled; pressing nothing charges nothing
- [x] **Buy a card** (cost 10, credit 5): the coins inserted are consumed (no leftover), the card is dispensed, presented at the reader it is written automatically and becomes active, 5.00 on screen; the card keeps the chip's own id  **DONE 2026-10-19: card released, written and activated with 5.00, the chip's own id; consent now stored (privacyConsentAt)**
- [x] The same card read again: 5.00, name/email/phone present in the central admin, no second empty card  **DONE: 5.00 and the data are in the central. FOUND AND FIXED: a second (old-code) card appeared in the central; it is now renamed, not duplicated**
- [x] **Recharge** 10 in cash with the card in the reader: balance +10 on screen, chip rewritten, Hetzner updated, one sale with the card code  **DONE 2026-10-19 (20 EUR): balance 5 -> 25 on the chip and in the database, one recharge sale with the card code**
- [ ] Take the card out: after about 3 s the card window closes and the kiosk is back on the home screen
- [ ] Card present + cash credit at once, pay a washer: card price used, no phantom credit moved onto the card
- [ ] **Card in -> loading -> window** (2026-10-12): put a card in on the home screen: the bubble panel "A ler o cartão…" appears at once, then the "My card" window opens already filled (balance, history). Check it does not just flash (if the read is instant, add a ~300 ms minimum)
- [ ] **Card out while loading**: pull the card out while the panel is still showing: no card window opens afterwards and the kiosk is on the home screen
- [ ] **Card out with the window open**: it closes about 3 s after removal (bouncing removed/inserted on the reader must NOT close it); Buy-card flow is not closed by this
- [ ] New "My card" window at 70% height: top-up -/+ in steps of 5 from the server minimum, "Avançar para pagamento" adds the recharge and opens the payment window; history shows machine names (needs the Hetzner backend, deployed 2026-10-12) and pages 5 at a time

### 13.5 Kiosk screens
- [ ] **New payment window** (design of 2026-10-12): header with machine number, quick choices, stepper, dark total, inserted / remaining / progress; check at touch size on the real screen
      The kiosk screen is PORTRAIT (about 1080x1920, see the photo of 2026-10-12). The window is one centred column, 68% of the screen width, centre at 53% of the height (same footprint as the old cart in the photo). Measured on a 1080x1920 viewport: dryer 48% of the height (52% with the confirm button), mixed cart 58%, washer 37%; it never scrolls and scales itself down only if a cart is taller than the screen. Check on the real screen: text readable, touch targets comfortable, nothing cut off
- [ ] Toasts top middle under the header, large, gone after 5 s, "Ver carrinho" big enough for a finger
- [ ] On-screen keyboard opens on every text field (promo code, card code, staff PIN, admin login) and types; numeric pad for PIN/amount
- [ ] Language dropdown opens on top of the machine list; all four languages
- [ ] Help tutorial step 5: discount text 0.50 wash / 0.20 dry, no `<em>` text, progress button translated
- [ ] Touch calibration holds after a reboot
- [ ] "Fora de servico" / Avariada from the admin reaches the kiosk in about 5 s and blocks the sale; Reparada returns it

### 13.5b Hopper, change coins and the new cash close (list added 2026-10-12)
- [ ] **Which coins does the change use?** Give change on purpose in a case that needs a 2 EUR coin (e.g. pay a 0.50 EUR item with a 5 EUR note and see what drops). Yesterday a try at paying 2 EUR coins as change did not happen: find out whether the hopper simply has no 2 EUR coins/hopper for that value, or whether the change plan never asks for them. Note exactly what drops for 4.50, 3.00, 1.50 change.
- [ ] **Hopper stock per coin is manual on purpose**: the system knows every coin that ENTERS (acceptor ledger) but only the EUR amount of the change that leaves, not which coins. To track it automatically one of two things must be true: (a) the controller reports which coins it dispensed per payout, or (b) one single-denomination hopper per coin value, each with its own Peripheral (`hopperConfig.coinValue`). Check on the real hardware what the controller reports after a payout and decide.
- [ ] **Hopper tab (kiosk + admin)**: count the coins by hand, set the target per coin, see "a repor"; the stock is no longer pre-filled.
- [ ] **Reforço** (coins brought from outside, e.g. the 1 EUR ran out): from the admin tab and from the kiosk with the staff PIN. Check: hopper stock for that coin value goes up, a "Reforço do hopper" entry appears in the history as float (not a sale), expected cash of the session goes up by the same amount; a coin value with no hopper configured is reported but still booked as float.
- [ ] **Fecho**: "Para o banco" defaults to everything counted minus the coins that refill the hopper to target; lowering it keeps the smallest note(s) (e.g. one 5 EUR) in the till; only 5/10/20 notes are offered; "Retirar da caixa" lists N x coin and the notes; confirm the close and see the history entry; after it, the accepted ledger starts from zero.
- [ ] **Books follow the cash**: a card sold for 10 with 5 credit shows 10 in cash sales/till, nothing more when the 5 is spent later (that day only shows in "Consumo de cartões", information); a top-up counts once, when the cash enters; a cash refund reduces the till.

### Result 2026-10-19 (evening): change and notes
- Notes 5 / 10 / 20 credit (the 50 note not tested: none at hand). Coins 1 and 2 credit.
- 33 EUR of change from a 35 EUR credit: `get-change 3300` -> `no-change 0` and 33 EUR really dropped, so **`no-change` = the part NOT paid (0 = all paid)**, as the code assumes. Both dryers in one payment, the home screen after payment, the credit zeroed as the change starts: verified.
- The empty-hopper command answered `no-change 16640` for a 9999 EUR request: still odd (see 13.5c).

- Dryers (Secar 7): 10 EUR = ONE `activate-machine impulses 5`, controller 200, the machine held until exactly 75 min later; the all-at-once mode works, no need for `DRYER_IMPULSE_MODE=staggered`. Tested and fine: not enough money (nothing starts, credit stays), cash first then choose a machine (the cart does not pay by itself), cycle changes, 2 machines in one purchase.
- **Door open on a running dryer (Secar 7 and Secar 11): NO change at all** in `status_int` (interfaces 16 and 15 stay `00000001`), no `machine-*` event, backend keeps `doorClosed: true`. The dryer door is not on a signal we read; the system only knows paid time. Ask the installer / Krebe whether the door has an output.
- 8-block limit (16 EUR) on a dryer: accepted, and the screen does not allow more than 8 (owner, 2026-10-19). With this, 13.2 is done except the dryer paid by card.
- Secar 7 and Secar 11 never show `occupied: true` from the signal while running (held by the paid time).
- Opening the door stops the dryer by itself and it only runs again after pressing the button on the machine (owner, 2026-10-19). The system cannot see this: the paid time keeps counting, so a customer who pauses loses those minutes on our clock (the machine can still be running when the screen shows it free, or the reverse). Needs the door signal (13.7).


### Result 2026-10-19/20: what else was proven (and found) today
- **Starts by itself after a reboot (2026-10-20 23:42):** the Windows session opens without a password (netplwiz re-entered; before, `0xC000006D` failures), `start-kiosk.bat` opens the screen, the bridge and the backend start as SYSTEM before any login, the peripherals are re-initialised automatically on a new controller session. A task `WashBubbles Kiosk Watch` reopens the screen if the browser is not running. Still the owner's: BIOS "Restore on AC Power Loss = Power On" (the GEEKOM A8 may not offer it; otherwise a smart plug / UPS).
- **Hopper:** a coin jam (0.05) gave `hopper-status 400`; the code treats a hopper fault before `no-change` as nothing paid. "Esvaziar hopper" (central admin -> the shop) and "Limpar cartão no leitor" (experimental: wiping a chip works, the reader still reports new:false, so a wiped chip counts as blank).
- **Cards from China:** DESFire, not read by this reader (no `card-inserted`). Buy MIFARE Classic 1K 13.56 MHz after reading a working card with an NFC app; ask Kitsec for the sector key.
- **Kiosk:** home screen after every purchase; no automatic payment (always "Confirmar e iniciar"); a card already in the reader is recognised (payment window, My card window); card icon with the last 4 digits in the header; free recharge amount (any value from the shop minimum, 0.10 steps, held buttons speed up); holder name/NIF/phone/email shown (partly hidden) and "Editar dados"; receipt popup keeps its place while typing, pre-filled with the card's e-mail, a real "Não, obrigado" button; server errors translated; no browser translate bubble.
- **E-mail:** the PC now has the MAIL_* settings; the receipt finds its sale (the cash payment sends its batchId); the template uses the shop's logo, name and contact from the admin. To check: the receipt really arrives (log line "accepted by the mail server").
- **Admin:** OPERATOR role (user `tatiana`, central server): only Operações, only Iniciar / Parar; every other route answers 403; "Parar" warns that paid cycles stay inside the machine. Role menu with "Alterar palavra-passe" / "Sair" for every user (minimum 8 characters). The create / edit card window works again.

### RULE (2026-10-20): no money in, no card credit
- **Found:** two recharges of 10 EUR were credited with NOTHING paid (a recharge in the cart, paid "with the card" that was in the reader; `/gateways/card/pay` added the recharge lines to the balance with no cash check). 20 EUR of free credit: card `-1173654100` (+10, 4.50 left) and `-91859025` (+10, spent on a machine). The balances were zeroed and the two sales voided (audit `card.manual_debit`, `metadata.voided`).
- **Rules now enforced on the SERVER (tests in `noFreeCredit.test.js`):** (1) card pay refuses any recharge line; (2) a top-up (`/gateways/cards/:code/topup`) and `/pos/recharge` need the cash really in the session and spend it; (3) `/gateways/cash/pay` cannot claim more cash than the session holds. The screen never pays a recharge by card either.
- **TESTED 2026-10-20 (owner, real screen): a recharge can no longer be paid with the card balance.** The owner decided the extra alert e-mail and the daily balance check are not needed.
- [ ] Still to run: a real cash recharge after the fix (the balance rises only after the money, the sale is booked as cash)
- ~~**Still to build (ideas):**~~ (dropped by the owner) a daily check that every card balance = cash recharges + new-card credit - card payments, with an operator alert on any difference; an alert when a recharge sale is not cash.

### To test next (new, not yet run on the real screen)
- [ ] Free recharge: type 3,30 in My card, pay 3.30 in coins, balance +3.30
- [ ] Pay a washer with the card (card already in the reader): the button "Confirmar e iniciar", card debited once, the home screen after
- [ ] Receipt e-mail arrives with the shop's logo (inbox and spam)
- [ ] Tatiana signs in on a phone: only Operações; Iniciar and Parar reach the shop in seconds; she changes her password
- [ ] Edit the holder data on the kiosk (consent box) and see it in the admin
- [ ] Reboot with the PC left alone: no password prompt, the screen opens, the acceptor works

### 13.5c LOW PRIORITY, later (2026-10-19)
- [ ] Hopper jam of 2026-10-19 was a 0.05 EUR coin jam (`hopper-status 400`); the code now treats a hopper fault before `no-change` as nothing paid. Skipped for now: count the coins of the Esvaziar-hopper test. The controller answered `no-change 16640` (166.40 EUR): if the container holds about that, `no-change` is the amount PAID, and `dispenseChangeViaGateway` + `emptyHopper` must be changed to read it so; until then do not trust the "saíram X EUR" figure of the button (it may have booked 9832.60).
- [ ] Refill the hopper with 2 EUR, 1 EUR and 0.50 EUR coins and count them in the Hopper e reforço menu; then the change test (3 EUR for a 2 EUR machine, 6 EUR for a 2 EUR machine) and note what drops.

### 13.6 Admin / central
- [x] A machine's occupied/free in the central admin follows the shop (5 s)  **DONE 2026-10-19 (Lavar 1)**
- [ ] A price / machine / setting change reaches the shop in seconds (sync_now); edited straight in the database, within 30 s
- [ ] Offline / Avariar buttons keep the machine's interface, port, weight and polarity (partial update)

### 13.7 Needs information, not just a test
- [ ] **Printer**: the controller lists it with error -1 (not answering). Need its real baud rate / port from Kitsec or the installer, then ONE correct complete `config_per` list (memory: reference-controller-config-per) with the owner present  **UPDATE 2026-10-19: the printer is really broken (owner); it is switched off in the admin (Desativada). Test again after the repair**
- [ ] `per-notification` messages from the controller: log which occur and decide what the app does
- [x] Lavar 1 / Lavar 5 busy-at-rest readings: confirm polarity per machine with a real cycle  **DONE: Lavar 1 verified with a real cycle; Lavar 4 and 5 working = correct (owner)**
- [ ] Model and year of each of the 9 machines into the admin; manuals from Krebe / ICT

## How to run a test with me

Tell me "doing test X". I read the controller trace live (`LOWLEVEL_TRACE=true` is on) and say what happened, one step at a
time. When a code is unknown I read it and save it in Hetzner's tables; I never guess a coin or bill value.


### Note 2026-10-10: acceptor light went off / note not pulled in
Owner changed a USB connection and the acceptor worked again (EUR 10 credited and refunded). The log shows the controller link dropping and reconnecting around then; a loose USB link is the likely cause. Watch for it coming back.

### Note 2026-10-10 (evening): bill acceptor and card reader going silent
Both went dead with the controller still reporting `status 0 / active 1`; unplugging and replugging the USB woke them. Tried, in order: acceptor moved from a blue (USB 3.0) port to a black (USB 2.0) port; Windows power saving off on the PC (USB selective suspend, adapter power management, Green Ethernet); controller keep-alive `has-card` now every 30 s regardless of other traffic (our status polling used to suppress it). After these the owner reported a run working fine. NOT proven which one fixed it. If it returns: note which device, the time, the acceptor LED pattern (dark or N blinks) and whether the cash box is seated; then suspect the acceptor power supply / controller USB hub.

### Note 2026-10-10: card reader flapping
With a card sitting in the reader the controller reports `card-removed` / `card-inserted` every few seconds. This is what exposed the stale-save bug. Same family as the bill acceptor going silent; ask the installer/vendor. Also open: a recharge made while the card is in must refresh the session copy (the save is now delta-based, so nothing is lost, but the screen balance can lag until the card is re-read).

### Note 2026-10-10 (night): the peripherals are on RJ45 cables, not USB
Owner finding: the bill acceptor, coin acceptor and the other peripherals connect to the controller with RJ45 (network-style) cables, not USB. The "unplug and replug" that wakes the acceptor / reader is therefore a connector or cable contact. Check, in order: both ends reseated and clicked, a known-good short cable for the acceptor, no kinks/pinches, away from mains. The earlier steps (USB port change, Windows USB power saving, keep-alive) were aimed at the wrong thing and are harmless but were not the cause. Keep a note of WHICH cable wakes it each time.

### Note 2026-10-11: hardware bridge (bill acceptor survives backend restarts)
- The controller switches the bill acceptor off when the connected program goes away; only a power reset revives it. A separate program (`WashBubbles Bridge`, `backend/src/hardwareBridge.js`) now owns the one controller connection; the backend talks to it on 127.0.0.1:16853.
- Verified on the shop PC: backend restarted, light stayed on, notes accepted. Alerts to the operator: controller session new (<5 min) or lost.
- Still true: a PC reboot or power cut ends the controller session; re-seat the acceptor cable afterwards.
- Restart ONLY the backend (`src\index.js`), never every node process.
- Controller peripheral list: see memory `reference-controller-config-per` (replace semantics, `ccTalk` spelling, six entries in order). Printer still reports error -1 (real settings unknown).
- Open: printer settings (baud/address), dryer 2-block paid test, Secar 10 signal wiring, Lavar 1/6 interface+port.

### Pending deploy to the shop PC (as of 2026-10-12, PC offline)
- Commit "kiosk: new payment window ..." (CartModal, Modal, CartContext export, dev-only /dev/cart preview): NOT on the PC yet.
  To deploy: copy `src/components/CartModal.jsx`, `src/components/ui/Modal.jsx`, `src/context/CartContext.jsx`, `src/pages/DevCartPreview.jsx`, `src/App.jsx`, build the screen on the PC, press F5 on the kiosk. No backend restart needed.
- Preview without the PC: `npm run dev`, open `http://localhost:5173/dev/cart` (fake cart + simulated coins, dev builds only).

### Note 2026-10-12: payment window = the design's own sizes, scaled; translations
- The window now uses the design's exact classes (528 px layout, light weights) and is scaled as a whole to the modal width (68% of the screen, centred at 53%) and down if the screen is too short. Measured on a 1080x1920 viewport with LIVE Hetzner data: dryer 70% of the height, washer 52%.
- It is translated (pt / en / fr / de, `src/locales/*/cart.json`, namespace `cart`), plural-aware ("1 ciclo", "2 ciclos"). Verified by switching languages in a local screen pointed at the live server.
- The kiosk machine list (`GET /pos/machines`) now also returns `number`, `tImp`, `outOfService`, `serviceStatus`; the kiosk promo rule is now the server's rule (it used Portuguese weekday names, so a promo price never showed). Test: `backend/test/kioskDataPath.test.js`.
- Local view of the kiosk without the PC: `npx vite` with `DEV_API_TARGET=https://freshbubbles.pt` (already in `.claude/launch.json`) and the kiosk key in the git-ignored `.env.local`. READ ONLY: do not press pay on the live server.
- 2026-10-12 later: translated pt/en/fr/de (namespaces `cart` and `buycard`): the payment window, the card and PIN prompts, the hardware toasts (rejected coin/note, fault, no change), credit / refund toasts, the header credit badge with its countdown, the payment result messages and the whole card-purchase screen. Still Portuguese only: admin pages (staff), aria-labels used for screen readers, the WiFi voucher notice and the machine-started notice (`showMachineNotice`).
- The card purchase now charges the cash REALLY in the session (the shop PC ignores the "inserted" figure the screen sent: a pressed 20 button used to be enough for a free card). The purchase screen shows the cash inserted with a Pay button that only enables when it covers the price. Test: `backend/test/cardPurchaseCash.test.js`.

### Shop PC updates itself (2026-10-19)
The PC checks GitHub every minute (task `WashBubbles Update`, `scripts/kiosk-update.ps1`, log `logs\update.log`). A push to `main` is live
on the PC within about a minute: pull (fast-forward only), `npm install` if a package file changed, the screen is built aside
(`dist-new`) and swapped in, ONLY the backend (`src\index.js`) is restarted if backend files changed, `/api/health` is checked and the kiosk
browser is reloaded. If anything fails it goes back to the previous commit and the previous screen. The PC reads GitHub with its own read-only
deploy key (`shop-pc-a8-max`, `core.sshCommand` in the repo config). Manual run: `powershell -File scripts\kiosk-update.ps1 [-DryRun] [-Force]`.
