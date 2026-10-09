# Go-live tests — what is done, what is left

Shop PC `a8-max` (Windows 11), controller `192.168.2.201:16852` on the PC's **"Ethernet"** port
(`192.168.2.190/24`, no gateway), central server Hetzner (`freshbubbles.pt`).
Tick a box only after it was *seen working at the machine*, not when the code merely passes tests.
Written 2026-10-09. Related: `docs/SHOP-HARDWARE-AND-COMMUNICATIONS.md` §9, §11, §14.

## 0. Before anything: put the latest code on the PC (it was off)

Committed and pushed, **not yet on the PC**:

- [ ] Copy to `C:\washbubbles`: `backend/src/services/coinMachine.js`, `backend/src/services/middleware.js`,
      `backend/src/routes/middleware.js`, `src/App.jsx`, `src/context/CartContext.jsx`
- [ ] Rebuild the screen (`npm run build` with `VITE_KIOSK_API_KEY` taken from `backend\.env`), kill `node`
      (the boot task `WashBubbles Backend` restarts it), press F5 on the kiosk
- [ ] Backend log shows `Low-level controller connected` and `[Downlink] in step with central`
- [ ] **Hopper has coins in it** (the database said 0). Note how many and of which value

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
- [ ] Wrong/foreign note: acceptor rejects it and the kiosk shows the message (`peripheral:rejected`), nothing credited
- [ ] Bill acceptor jam / stacker full: message shown, peripheral turns red in the central admin
- [ ] The fallback table on a PC that never was online has **only** `"10"`; decide if more codes should be built in

## 3. Refund of unspent cash (new, never run on hardware)

- [ ] Insert one coin, touch nothing: after **2:00** the hopper pays it back; toast "Crédito devolvido"; badge disappears;
      log `[Refund] … paid back (idle)`; audit entry `cash.refund`
- [ ] Countdown "devolução em m:ss" is visible and counts down
- [ ] Touching the screen restarts the countdown (keepalive); a coin/bill restarts it too
- [ ] Reload the page (F5) with credit inside: the badge comes back with the right amount and the right countdown
- [ ] **Short payout**: with an empty/low hopper the part that cannot be paid stays as credit, the screen says to
      contact the counter, audit `cash.refund.short` shows the amount owed
- [ ] A customer with a card loaded is **not** refunded in coins (the card flow takes the unspent cash)
- [ ] Refund works with **no internet** (unplug `Ethernet 3`, then repeat the first test)
- [ ] Admin forced refund: `POST /api/middleware/client/refund`
- [ ] Setting `creditRefundSeconds` changed in Hetzner admin reaches the PC (and `0` turns the refund off)

## 4. Change from the hopper (never tested)

- [ ] Buy something cheaper than the cash inserted: change is paid out, exact amount, coins in the tray
- [ ] Change when the hopper cannot cover it: the shortfall is reported to the customer and logged (no silent loss)
- [ ] `hopperCoinValue`/`hopperMaxDispenseCoins` are right for the coins actually loaded
- [ ] Hopper stock counter (`hopperConfig.currentCount`) goes down after payouts and survives a restart/pull

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
