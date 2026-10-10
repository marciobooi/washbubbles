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
- [ ] Press F5 on the kiosk (or restart Edge) so it runs the new screen

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

- [ ] **€10 bill is credited**: put the note in again (it was swallowed uncredited while being read); log must say
      `Bill accepted: €10.00` and the badge goes up by €10. The table (`billEqTable`: `"10"`→10) was saved but this
      was never confirmed
- [ ] **€5 bill**: insert one, read the code from the log (`bill-inserted`), add it to `billEqTable` in Hetzner, insert again
- [ ] **€20 bill**: same
- [ ] €50 note: same, only if the shop accepts it (otherwise leave it refused)
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
- [ ] The fallback table on a PC that never was online has **only** `"10"`; decide if more codes should be built in

## 3. Refund of unspent cash (new, never run on hardware)

- [x] Insert one coin, touch nothing: after **2:00** the hopper pays it back; toast "Crédito devolvido"; badge disappears;
      log `[Refund] … paid back (idle)`; audit entry `cash.refund`  — **seen 2026-10-10**: €1 coin (code 7) → 2 min → `get-change 100` → `no-change 0` → refund paid, audit `cash.refund`; the owner saw the timer and the money come back
- [x] Countdown "devolução em m:ss" is visible and counts down  — seen 2026-10-10 (owner)
- [ ] Touching the screen restarts the countdown (keepalive); a coin/bill restarts it too
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

- [ ] Buy something cheaper than the cash inserted: change is paid out, exact amount, coins in the tray
- [ ] Change when the hopper cannot cover it: the shortfall is reported to the customer and logged (no silent loss)
- [ ] `hopperCoinValue`/`hopperMaxDispenseCoins` are right for the coins actually loaded
- [ ] Hopper stock counter (`hopperConfig.currentCount`) goes down after payouts and survives a restart/pull

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

- [ ] Pick a machine that is wired, empty and safe to run; pay the **exact** amount in cash (no change involved)
- [ ] Log shows `activate-machine sent via controller: interface <addr>, channel <n>` and the washer really starts
- [ ] Machine turns "Ocupado" on the kiosk and in the central admin, and frees itself when the cycle ends
- [ ] **Pulse timing**: `tOn=5 / tOff=1` is an unverified unit. If nothing starts, the pulse is probably too short
- [ ] Pay with more cash than the price: machine starts **and** change is paid (§4)
- [ ] Pay with card balance; pay with part cash + part card
- [ ] A dryer: the time bought = impulses × 15 min (`tImp`); polarity `low` machines read busy/free correctly
- [ ] Two machines in one cart start both

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
- [ ] **`status_int` bit strings**: each interface answers with 8 bits (for example `00000010`), but the app only reads the last two
      (the two channels). Switch things at the machine (open the door, start, finish, cut power to the interface) and see which of
      the **other bits** change. They may carry door open, door locked, fault or "cycle finished"
- [ ] The app already decodes `fault`, `occupied`, `doorLocked`, `doorClosed` per machine (visible in the log as
      `Machine … status update`): confirm that each of these four really follows the machine, and for which machines
- [ ] `machine-started`, `door-opened` and `machine-issue` events: trigger each one on purpose and check what the app does with it
- [ ] **Interface offline** (`active:"0"`): unplug one interface and check the machine turns "fault" in the app, in the kiosk and in the
      central admin, and the operator is alerted
- [ ] Does any machine report a **remaining time**, a **program**, a **cycle counter** or an **error code**? If yes: show it in the
      admin/kiosk; if not, say so here, so we stop looking
- [ ] Polarity per machine (`activation` high/low): confirm busy and free are not swapped on any machine (lavar 1 and lavar 5 read busy at rest)
- [ ] Write down which signals we **do not use yet** and decide, one by one: show to the customer, show to the operator, alert on, ignore
- [ ] Ask the vendor for the full list of machine and interface messages (also the open questions in `docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md` §11)

## 6. Admin Start / End from the central admin

- [ ] Hetzner admin → Operações → **Iniciar** on a wired, empty machine: it starts within ~5 s without payment;
      the admin shows "Pedido enviado ao posto", then "Ocupado" once the shop confirms
- [ ] Same from the PC's own admin (`http://localhost:3000`): starts at once
- [ ] **Parar** frees the machine in the system (the controller has no stop command: a running cycle finishes by itself)
- [ ] Start on an unwired / already running machine is refused with a readable reason
- [ ] A command sent while the PC is offline is **not** run hours later (older than 2 min = expired)

## 7. Receipt printer (never tested)

- [ ] Print a receipt from the kiosk after a sale (`print-receipt`): paper comes out, readable, correct total
- [ ] Out-of-paper / printer fault: shown as a peripheral problem, the sale is not blocked
- [ ] Email receipt (needs the mailbox password, see §12)

## 8. Cards (RFID reader and dispenser — never tested)

- [ ] Present a card: it is read (`card-inserted`, `has-card`), balance shown
- [ ] Recharge a card with cash; balance written to the card **and** to the database, and synced to Hetzner
- [ ] Buy a new card: the dispenser releases one, it is written (`write-card` 201) and activated
- [ ] Card removed mid-way: no double credit, unspent cash goes onto the card
- [ ] Blocked / `pending_write` card: the right message
- [ ] `get-version` gets no reply from the controller (known); check it does not matter

## 9. Machine wiring — decide and fix in Hetzner (source of truth)

- [ ] **Lavar 1**: PC has INT 6 (addr 16) port 1, Hetzner has **nothing**. Decide the true wiring and set it in Hetzner
- [ ] **Lavar 2**: INT 6 port 2 on both — confirm it is physically right
- [ ] Walk every machine (1–9): the interface + port in the admin is the washer/dryer you are standing at
- [ ] **Lavar 1 and Lavar 5 read busy** from the controller although nobody uses them: real, or wrong polarity
      (`activation` high/low)? Fix before real customers
- [ ] The pull cannot *remove* a field: clearing a machine's interface in Hetzner does not clear it on the PC
      (needs `$unset` support in `services/downlink.js`)

## 10. Offline day (the shop must work with no internet)

- [ ] Unplug the internet (`Ethernet 3`): coins/bills are credited, a machine can be bought and starts, change is paid
- [ ] Sales and card changes queue (`SyncOutbox`) and **all arrive in Hetzner, once each**, after reconnecting
- [ ] A fresh PC offline on day one still recognises coins (fallback codes, §2) and loads machines/prices stored locally
- [ ] Central admin shows the shop as stale/offline sensibly while it is disconnected

## 11. Reboot and power cut

- [ ] Restart the PC: it logs in by itself, backend up before login, Edge opens full-screen kiosk, Tailscale/SSH back
- [ ] Power cut with credit inside: after power returns the credit is back (≤30 min) and is refunded after 2 min
- [ ] Backend crash: `run-backend.bat` restarts it, the kiosk page recovers by itself
- [ ] Windows Update must not reboot the PC in opening hours (set active hours / policy)

## 12. Loose ends

- [ ] **Passwords**: admin/kiosk passwords were printed in a chat during setup — rotate them and the kiosk API key
- [ ] Email: set `MAIL_PASS` for `marcacoes@freshbubbles.pt` in `backend\.env` / `.env.docker`; send a real receipt and a password reset
- [ ] Windows auto-login has no password: confirm that is acceptable (physical access = full access)
- [ ] TeamViewer is installed on the PC: keep or remove; Tailscale is the way in
- [ ] Old PC is switched off; decide when to wipe it. Keep its config backup until all machines are verified
- [ ] Backups: MongoDB on the PC (daily dump) and Hetzner
- [ ] Screen sizes: the kiosk page is 2×2 cards and bigger rows; check on the real screen, adjust if too big/small.
      The dryer list (9 machines) scrolls — check it is comfortable on touch
- [ ] Known flaky tests (not caused by the shop work): "Day close … double-book two closes racing" (~1 in 16) and some
      40 ms-timer uplink tests; fix the races when there is time

## How to run a test with me

Tell me "doing test X". I read the controller trace live (`LOWLEVEL_TRACE=true` is on) and say what happened, one step at a
time. When a code is unknown I read it and save it in Hetzner's tables; I never guess a coin or bill value.


### Note 2026-10-10: acceptor light went off / note not pulled in
Owner changed a USB connection and the acceptor worked again (EUR 10 credited and refunded). The log shows the controller link dropping and reconnecting around then; a loose USB link is the likely cause. Watch for it coming back.
