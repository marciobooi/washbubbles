# WashBubbles — Audit Findings & TODO

Full A-to-Z audit of backend, admin dashboard, kiosk (pos-client) and frontend.
Ordered by severity. Work top-down.

**Legend:** `[x]` fixed & verified · `[~]` partly fixed · `[ ]` outstanding · `[?]` needs a product decision · `[!]` deliberately left alone

**Verification note:** items marked **(verified)** were confirmed by reading the code directly.
Unmarked items came from an automated sweep and should be confirmed while fixing — the
line numbers are a starting point, not gospel.

---

## P0 — Money taken, nothing delivered

These are the worst class of bug here: the customer pays, the system reports success,
and the physical thing never happens. All silent.

- [x] **Machine activation never reaches the hardware.** **(fixed)** `backend/src/services/middleware.js:987-1017`
  — `sendMachineActivation()` builds the command buffer, logs `"Activation pulse sent"`, and
  returns it **without ever writing to the serial port**. `coinMachine.js:550` then marks the
  machine `working` and saves. Customer pays, credits deducted, UI shows running, washer never starts.
- [x] **Two methods named `send` in the same class.** **(fixed — renamed to `sendPackage`)** `backend/src/services/middleware.js:600` and `:1065`
  — the later definition silently overrides the earlier one, so `dispenseCard`'s generic branch (`:639`)
  and every `print()` write (`:896`) hit the frame-wrapper instead of the port. `dispenseCard` still
  emits `card-dispensed` and returns `{success:true}`, and `pos.js` books the CardPurchase with
  `dispenserUsed: true`. Customer pays for a card, receives nothing, sale is recorded.
- [x] **`/pos/recharge` dispenses change then crashes before recording the sale.** **(verified & fixed)**
  `backend/src/routes/pos.js:106-160` — `CardT` and `SaleT` are never defined in this handler.
  The card is credited (`:129`) and the hopper physically dispenses change (`:144`) *before* the
  `ReferenceError` at `:126`/`:156`. Coins leave the machine with no Sale row, so day-close
  reconciliation (`admin.js:826`) shows an unexplainable shortage.
  **Fix:** define `CardT`/`SaleT` via `withTenant`, and record the sale *before* dispensing change.
- [x] **Hopper jam reports success.** **(fixed)** `backend/src/services/middleware.js:816,827-847` — the dispense
  timeout resolves `null` and the code proceeds as if it worked. `dispenseChange:766` also loops
  denominations: a throw on the 2nd leaves the 1st already dispensed, and `pos.js:145,290` swallow
  the error and return 200. Customer gets partial change; a retry double-dispenses. Neither path
  decrements `hopperConfig.currentStock` or `dayClose.totalChangeDispensed`.
- [x] **autoCharge double-credits every coin.** **(fixed — see decision note)** `backend/src/services/coinMachine.js:266-269` +
  `client.js:84-111` — `handleCoinInserted` pushes the value into `chargedArr` *and* calls
  `addToBalance()`. The cash is immediately spendable, and on card removal the same amount is
  added to the card in the DB. Insert €5 → €5 spendable **and** €5 on the card. House loses the
  difference on every insertion. *Needs your call on intended behaviour: should inserted cash go
  to the session, to the card, or to the card only on removal?*
- [x] **Cash-mode payment debits the card in memory only.** **(fixed — see decision note)** `backend/src/services/client.js:161-168`
  + `coinMachine.js:398-418` — `deductCredits` always drains `balanceCard` first, but the
  `saveCardBalance()` call is skipped when `paymentType === 'cash'`. `resetCardInfo` (`client.js:61`)
  then zeroes the in-memory balance without ever saving. Card keeps its original DB balance →
  unlimited free washes. *Needs your call: should cash-mode ever touch the card balance at all?*
- [x] **The hopper is never told *which* coin to pay out.** **(fixed)** **(verified)**
  `backend/src/services/middleware.js:778-822` — the ccTalk dispense frame is
  `[addr, len, src, 167, count, chk]`; `denomination` is used only in the `console.log`.
  `dispenseChange` loops the breakdown and fires four separate "dispense N coins" commands at the
  *same* address, so the hopper pays N coins of whatever it physically holds. €3.70 of change
  (1×2.00 + 1×1.00 + 1×0.50 + 1×0.20) becomes 4 coins: €2.00 from a 50c hopper, €8.00 from a €2
  hopper. **Every payout is wrong, in either direction, by an unbounded amount.**
  **Fix:** one hopper = one denomination; address each hopper separately from the peripheral config
  (see the `parseInt(address)` bug below), or drop multi-denomination change entirely.
- [x] **No serial framing on peripheral data — coins lost, phantom €20 bills credited.** **(verified)**
  `middleware.js:291-331,539-595` — `port.on('data')` hands the raw chunk to `handleCoinData`, which
  reads only `data[0]`. Serial chunk boundaries are arbitrary: two coins arriving in one chunk credit
  **one** coin (customer loses money); a reply split across chunks makes a mid-frame byte the "coin
  code" — `0x03` reads as €0.05, or in `parseBillValue` as **€20.00 of free credit**. And because a
  real ccTalk reply is `[dest,len,src,cmd,…]`, `data[0]` is an address byte and never a coin code, so
  every ACK also fires a spurious `coin-rejected`/`bill-rejected`.
  **Fix:** accumulate into a buffer and parse whole ccTalk frames (length byte + checksum), the way
  `hardware-agent.cjs`'s `CcTalkLink` already does. Port that class here.
- [x] **`writeCardData` claims success without writing — and bricks the card.** **(verified)**
  `middleware.js:370-447` — two separate bugs:
  (a) `:393` only writes for `usb`/`rs232` and `:411` returns early with a `console.warn` when there
  is no port, yet `:397-400` still emit `card-written` and return `{success:true}`; the
  `waitForResponse` ACK at `:445` is discarded, so a NAK is success too. A €20 top-up is booked as
  written to a card holding nothing.
  (b) `:431` `blockNumber = 4 + i` walks straight through MIFARE sector trailers (blocks 7, 11, 15).
  The JSON payload exceeds 48 bytes as soon as name/email are set, so block 7 — keys and access bits
  — is overwritten with JSON. **The card is permanently unreadable.** `readRFIDSectors` (`:496`)
  reads the same trailers back as data.
  **Fix:** skip every 4th block, verify the ACK before reporting success, and cap the payload.

## P0 — Security

- [x] **`/api/middleware/*` was entirely unauthenticated.** **(verified & fixed)** 11 of 16 routes had
  no guard — including `/client/add-cash` (mint credit), `/payment`, and `/activate-machine` (start
  any machine free). Anyone who could reach the server could drain it. Added a new
  `requireKioskOrAdmin` guard (`middleware/auth.js`) and applied it to all unguarded routes.
- [x] **`/auth/register` is public and takes `role` from the request body.** **(verified & fixed — route deleted)**
  `backend/src/routes/auth.js:50` — `POST {"username":"x","password":"y","role":"SUPERADMIN"}`
  grants full cross-tenant admin to anyone. `models/user.js:11` has no enum on `role` to stop it.
  Secondarily `tenantId` is required and never set here, so the create throws → unhandled rejection
  → **unauthenticated remote process kill**.
  **Fix:** delete the route (admin.js already has proper user creation) or put it behind `requireAdmin`
  and force the role.
- [x] **Admin user CRUD is not tenant-scoped.** **(verified & fixed)** `backend/src/routes/admin.js:182,195,202`
  use bare `User.findById/findByIdAndUpdate/findByIdAndDelete`. A tenant-A admin can
  `PUT /admin/users/<any-superadmin-id>` with a new password and role. Full platform takeover from
  one low-value account. Same bare-model pattern at `:276` (delete any tenant's Sale), `:391`
  (settings), `:564,571,581` (interfaces), `:590,598,604,617,637,643,659,665` (prices — set a
  competitor's wash price to 0), `:674,683,705,712` (peripherals).
- [x] **`X-Tenant-Id` header is trusted without authentication.** **(fixed)** `backend/src/middleware/tenant.js:7-17`,
  mounted globally. `requireAuth` overwrites it so authenticated routes are safe, but every
  *unauthenticated* route inherits attacker-chosen tenant scope: `pos.js:20,22` (machine lists),
  `:25` (prices), `:449` (settings).
- [x] **`/pos/recharge` uses bare `Card` lookups.** **(fixed)** `backend/src/routes/pos.js:122-123` — a kiosk key
  from tenant A can top up tenant B's card by id or code.
- [x] **Negative / NaN amounts are never rejected on any money path.** **(fixed)** `pos.js:81-83` —
  `card.balance - Number(-50)` *credits* the card. Same at `pos.js:473-476`, `gateways.js:33,57-58`,
  `sync.js:88` (`data.delta` unbounded → set any balance), `sync.js:91` (`Number(undefined)` → `NaN`
  balance), `admin.js:268`. Any kiosk key becomes unlimited free credit.
- [x] **`inserted` is never coerced to a number.** **(fixed)** `backend/src/routes/gateways.js:103` — `"5" + 0.0001`
  is the *string* `"50.0001"`, which compares greater than a €20 total. Send `inserted:"5"` → free
  wash plus €45 of change dispensed at `:141`.
- [x] **Recharge books revenue without crediting the customer.** **(fixed)** `backend/src/routes/gateways.js:56-60`
  vs `:67,81` — the Sale is persisted in the loop but `card.save()` only runs on some branches. If
  `:76`/`:77` returns 404/409, the sale is recorded and the card is never credited.
- [x] **Rate limiting only exists on `/auth/login`.** **(fixed)** Unlimited: `/auth/forgot-password` (mail bomb,
  user enumeration), `/auth/reset-password` (64-hex token brute force), `pos.js:439` and
  `gateways.js:12` (card balance lookup by code — the kiosk apiKey sits on a public terminal).
- [x] **Kiosk renderer runs remote content with `unsafe-inline`/`unsafe-eval`.** **(fixed)**
  `pos-client/electron/main.cjs:74` — combined with the unvalidated IPC money handlers below, one
  XSS on the loaded origin owns the till.
- [x] **No IPC validation on money handlers.** **(fixed)** `pos-client/electron/ipc-handlers.cjs:12,22,33` forward
  `amount` verbatim. A negative amount in `processSale` makes the balance *increase* and still pass
  the `< 0` check; `card:topUp` never checks the session cash balance, so any renderer call mints
  balance; `hw:adminStartMachine` starts machines free with no auth check.

## P1 — Crashes & data integrity

- [x] **No Express error handler anywhere.** **(verified & fixed)** `backend/src/index.js` — on Node 24
  an unhandled rejection in an async route terminates the process. Every un-try/caught `await` below
  was a remote DoS. Added an arity-4 catch-all after all route mounts plus an `unhandledRejection`
  handler; the rest of these are now 500s instead of outages.
- [x] **`mongoose` is never imported in `admin.js`.** **(verified & fixed)** Used at `:891,913`, so
  `GET /admin/analytics/revenue` and `/analytics/machines` threw `ReferenceError` → server died.
- [x] **`Machine` is never imported in `sync.js`.** **(verified & fixed)** `:111,220` →
  `/sync/push/machine` and `/sync/pull/machines` always 500. Machine config never synced to kiosks at
  all, and every machine push retried 10 times then was silently dropped.
- [x] **Stub connectors report `ok`, then silently "dispense".** **(verified)**
  `middleware.js:134-160,621-645` — `connectPulse`/`connectUSB`/`connectEthernet` are placeholders
  that set peripheral status to `ok` without touching hardware. A pulse card dispenser therefore has
  no `.port`, so `sendCardDispenserPulseCommand` returns at `:681` and `dispenseCard` emits
  `card-dispensed` + `{success:true}` (`:643`). Customer is charged, no card comes out, dashboard is
  all green. **Fix:** make the stubs throw / report `error`, so the peripheral shows as down.
- [x] **A dropped serial port wedges the peripheral until process restart.** **(verified)**
  `middleware.js:113-125` + `:50` — `port.on('close')` sets status `offline` but leaves the entry in
  `this.connections`, so any later `connect()` short-circuits at `:50` with "already connected".
  A USB replug needs a restart, and `send()` meanwhile writes to a dead port. **Fix:** delete the
  connection entry on close and add backoff reconnect.
- [x] **`print` is the same silent-success class.** **(fixed)** **(verified)** `middleware.js:894-902` —
  `if (connection.port)` gates the whole write loop, then `receipt-printed` + `{success:true}` fire
  regardless. No ACK, no paper check.
- [x] **`waitForResponse` has no request/response correlation.** **(fixed — replaced by a per-port queue)** **(verified)**
  `middleware.js:695-715` — it resolves on the *next* chunk on a shared port, whoever sent it.
  Concurrent callers each register their own `once('data')`, so a single chunk resolves both promises
  and command A's ACK is read as command B's. In `readRFIDSectors` a late block-N reply satisfies
  block N−1, **shifting the balance data**. The chunk is also delivered to the permanent `handleData`
  listener, so RFID block reads emit bogus `card-read` events mid-write. **Fix:** one command queue
  per port, with a mutex.
- [x] **`/sync/push/day-close` doesn't exist.** **(fixed)** `pos-client/electron/sync-engine.cjs:144` pushes to it;
  there is no such route in `backend/src/routes/sync.js` → 404 → every Z-report is abandoned after
  10 attempts.
- [x] **`card` schema has no `bonus` field.** **(fixed)** `backend/src/models/card.js:5-19` — but `client.js:138`
  reads `card.bonus` and `:197` writes it. Mongoose strict mode drops it silently: **all loyalty
  bonus is permanently lost.**
- [x] **`user.js` email index has the broken-sparse bug.** **(fixed — needs a manual index drop, see Deploy notes)** `backend/src/models/user.js:21` —
  `{tenantId:1, email:1}, {unique:true, sparse:true}`. `tenantId` is always present and `email`
  defaults to `null`, so sparse skips nothing and the *second* user created without an email in a
  tenant fails with E11000. Same fix as machines.number: `partialFilterExpression`.
  (`interface.js:29` has the same no-op sparse — currently harmless.)
- [x] **`req.user._id` is always `undefined`.** **(fixed)** `backend/src/routes/sync.js:151` — `middleware/auth.js`
  sets `req.user = {sub, role}`. Mongoose strips the undefined key, so **every kiosk pulls every
  other kiosk's pending commands** in the tenant. (Same class of bug already fixed in day-close.)
  `sync.js:59` `posId` is likewise always null.
- [x] **`/admin/kiosks/:id/command` never verifies the kiosk belongs to the caller's tenant.**
  `backend/src/routes/admin.js:962`.

## P1 — Kiosk sync (money duplication / loss)

- [x] **Card balance pushes are delta-based with no idempotency key — retries double the money.** **(fixed)**
  `pos-client/electron/sync-engine.cjs:120-121` pushes and marks synced in two non-atomic steps;
  `backend/src/routes/sync.js:87-89` applies `card.balance += delta` with no dedupe (contrast
  `/push/sale`, which *does* dedupe on `metadata.localId`). Timeout or power loss between the two
  → delta applied twice → customer gets €40 for a €20 recharge. Debits double the same way.
- [x] **Incremental pull + `bulkReplace` wipes local config.** **(fixed)** `sync-engine.cjs:176-181` feeds a
  `?since=`-filtered result into `prices.bulkReplace` / `settings.bulkReplace` /
  `interfaces.bulkReplace` / `peripherals.bulkReplace`, each of which does
  `DELETE FROM … WHERE tenant_id=?` first (`database.cjs:423,448,470,490`). Admin edits one price →
  next pull returns one row → **every other price is deleted locally**. A settings pull destroys
  `coinEqTable`/`billEqTable`, so coins get miscredited; an interfaces wipe means the customer pays
  and the machine never starts.
- [x] **Inserted cash lives only in RAM.** **(fixed)** `pos-client/electron/pos-engine.cjs:17` — `sessionState` is
  never persisted (`session.update()` in `database.cjs:539` is never called anywhere) and `init()`
  calls `session.reset()` on boot. A power blip after a customer feeds in €20 destroys it with no record.
- [x] **`topUpCard` never flushes to disk.** **(fixed)** `pos-engine.cjs:107-118` — unlike `processSale`, no
  `flushSave()`, so a power loss inside the 2s debounce loses a recharge the customer already paid for.
- [x] **`removeCard` auto-charge is unflushed and unrecorded.** **(fixed)** `pos-engine.cjs:84-92` — moves session
  cash onto the card and queues a delta but creates no `sales` row and never flushes. Cash-in-drawer
  vs card credit can't be reconciled.
- [x] **Sync queue gives up silently after 10 attempts.** **(fixed — dead-letter table + exponential backoff)** `database.cjs:505` — no dead-letter table,
  no alert, nothing operator-visible. A sale rejected by server validation is money taken and never
  accounted for. Also no backoff: a hard 500 retries every 60s until burned through.
- [x] **`sessionState` is mutated inside `runTransaction`.** **(fixed)** `pos-engine.cjs:144-157` — a throw at
  `sales.create` rolls back SQL but leaves the JS object debited; the customer's credits vanish.
- [x] **No startup reconciliation.** **(fixed)** `pos-engine.cjs:160` sets a machine `working` and nothing ever
  frees it locally — a crash mid-cycle leaves it permanently "Ocupado" and `processSale:138` rejects
  the next customer.
- [x] **`sales.markSynced` / `getUnsynced` are never called.** **(fixed)** `database.cjs:396-401` — `sales.synced`
  is permanently 0 and the server id returned by `/push/sale` is discarded.

## P2 — Correctness & robustness

- [x] **No money rounding anywhere.** **(fixed everywhere)** **(partly fixed — `utils/money.js` added and used on every route; `services/client.js` and `coinMachine.js` still do raw float math)** There is no `roundMoney` helper in the backend at all (the
  kiosk has one). `client.js:117,167,179,211` and `coinMachine.js:260,293` do raw float math —
  five €1 coins + 10% bonus → `5.500000000000001`; a €5 target can land at `4.999999999` and
  `processPayment:408` then throws "Insufficient credits" on an exact payment. `client.js:167` can
  leave a balance slightly negative.
- [x] **Settings/cards/machines loaded without a tenant filter in the coin machine.** **(fixed)**
  `coinMachine.js:87-91` (`Setting.findOne({key})` on a singleton returns an arbitrary tenant's row —
  tenant A's bonus applied to tenant B's coins), `client.js:96,128`, and every
  `Machine.findOne({intId})` at `coinMachine.js:581,607,634,663` (tenant B's machine started by
  tenant A's payment).
- [x] **`broadcastHardwareEvent` called with 2 args in coinMachine.** **(fixed)** `coinMachine.js:216,227,236,245`
  — signature is `(tenantId, type, payload)`. Fraud and hopper-empty alerts reach nobody. (Same bug
  already fixed in `index.js`; this file was missed.)
- [x] **One dropped status bit wipes a paid session.** **(fixed — 3 consecutive idle readings now required before a paid machine is freed)** `coinMachine.js:760-768` — a `working` machine
  reporting `doorClosed && !occupied` for a single status packet is reset to `free` with
  `currentProgram`/`reservedBy` cleared, freeing it for someone else mid-cycle.
- [x] **Cancelled reservations are never cleared.** **(fixed — `machine-res-canceled` now has a handler; only clears a still-`reserved` machine)** `middleware.js:1102` emits `machine-res-canceled`;
  nothing listens. The machine stays `reserved` forever and is unbookable, yet `activateMachine:519`
  will still activate it.
- [x] **Event shape mismatches.** **(fixed)** `middleware.js:328,344` emit `{peripheral, signal}` but
  `coinMachine.js:212,222` destructure `{reason, fraud}` → `fraud` is always undefined, so
  `peripheral:fraud` never fires from the serial path. `middleware.js:524` emits `hopper-event` with
  no listener.
- [x] **Missing hot-path indexes.** **(fixed)** `machine.intId` and `{interfaceId, port}` (collection scan on
  every status packet — `coinMachine.js:735,798`); `card.code` alone isn't a usable prefix of
  `{tenantId, code}`, so every card read is a collection scan.
- [x] **Listener/interval leaks on a long-running kiosk.** **(fixed — local-api.js deleted, autosave interval cleared)** **(kiosk autosave interval fixed; `local-api.js` still leaks)** `src/services/local-api.js:114-147`
  registers `ipcRenderer.on` per subscribe and returns a no-op cleanup (the code comments admit it);
  `database.cjs:94` autosave interval is never stored or cleared.
- [x] **26 empty `catch {}` blocks in the frontend** swallow errors with no logging (mostly
  non-critical UI side effects, but they mask real failures too).
- [x] **KITSEC frame parsing matches ETX inside the payload and never checks the checksum.**
  **(verified)** `middleware.js:199-204` — `buffer.indexOf(0x03, stxIndex)` finds the first `0x03`
  *anywhere*, including the `port` and `statusByte` fields. Port 3, or `statusByte === 0x03`
  (`doorClosed|occupied` — the normal running state), truncates the frame to 4 bytes, which `:243`
  then drops silently while `:204` consumes past it and desyncs the stream. `handleInterfaceData`
  also never verifies the trailing checksum, so one noise-corrupted byte can report `fault` or
  `occupied` on the wrong port. Machines on low-numbered ports never update status; phantom faults
  appear at random. **Fix:** use the length field, not an ETX scan, and verify the checksum.
- [x] **Serial ports are only opened on Windows.** **(fixed)** **(verified)** `middleware.js:175` —
  `iface.address.startsWith('COM')`. On Linux/macOS (`/dev/ttyUSB0`) no port is opened, yet
  `:223-228` still register the interface with `connected: true`. Every activation is a silent no-op.
  Matters directly: the Hetzner box is Linux.
- [x] **`parseInt(peripheral.address)` is always `NaN`.** **(fixed — new `deviceAddress` field)** **(verified)** `middleware.js:653,786` —
  `address` holds the port path (it is used as `path` at `:94`), so the ccTalk device address
  silently falls back to the hardcoded 3/4 — the wrong device on a multi-drop bus. Needs a separate
  `deviceAddress` field on the peripheral (and in the admin UI).
- [x] **`disconnectAll` never iterates `this.interfaces`.** **(fixed)** **(verified)** `middleware.js:934-938` —
  interface ports stay open across shutdown, so a restart hits a busy port.
- [x] **`buildInterfaceCommand` byte order and types are wrong.** **(fixed)** **(verified)**
  `middleware.js:1023-1058` — the comment says little-endian, the code writes the high byte first;
  `cmd.address` is a string (`'COM3'`) so `Buffer.from` coerces it to 0; undefined `tOn`/`tOff`
  become 0. Latent only because the write is missing (P0 item 1) — fix both together.

## P2 — Missing / dead flows

- [x] **Change is never dispensed from the kiosk UI.** **(fixed — server dispenses and reports it)** `dispenseChange` is fully implemented and
  exposed over IPC (`preload.cjs:28`) but **nothing in `src/` ever calls it**. Change is computed and
  recorded on the sale; the hopper is never triggered. *Decision needed: wire it into the checkout
  flow, or is change handled manually?*
- [x] **`CashModal` can never open.** **(resolved — see decision note)** `src/components/CartModal.jsx:214` — `setShowCash(true)` only
  happens in `openCashModal()`, which nothing calls. The whole manual cash-payment modal is
  unreachable; payment works only via hardware-driven paths.
- [x] **The "Pagar com Cartão" prompt can never open.** **(resolved — see decision note)** `CartModal.jsx:158` — `setShowCardPrompt(true)`
  only happens in `handleCardPay()`, which nothing calls. Only the automatic RFID path works.
  *Decision needed on both: add manual buttons as a hardware-failure fallback, or delete?*
- [x] **`CardModal`'s change display is unreachable.** **(removed)** `src/components/CardModal.jsx:79` —
  `handleInsertMoney()` is never called, so `insertedMoney`/`showChange` never change and the
  "Troco" block at `:194` is dead.
- [x] **`CardModal`'s `onRecharge` prop is dead.** **(removed)** Destructured at `:22`, never used; `Pos.jsx:142`
  passes `handleRecharge` expecting it to fire. The cart-based flow superseded it.
- [x] **`Machines.jsx` `pay()` calls an undeclared `closeModal()`.** **(removed)** `src/pages/Machines.jsx:141` —
  would throw `ReferenceError` if ever invoked. Currently dead (nothing calls `pay()`), alongside the
  dead `handleAddToCart` wrapper at `:118`.
- [x] **`AdminUsers.jsx` `resetForm()` is never called** **(removed)** — the Cancel button uses an inline handler.
- [x] **`AdminPrices.jsx` duplicates the coin/bill settings UI** that also exists in `AdminSettings.jsx`,
  writing to the same keys from two pages. (The `AdminSettings` copy has been removed; `AdminPrices`
  is now the single home.)

## P3 — Dead code & unused dependencies

- [x] `backend/tmp-upload-test.js`, `backend/tmp-upload-bad.js` — leftover scratch files, zero references.
- [x] `src/services/local-api.js` — nothing imports it, and it's stale: it destructures
  `getPublicMachines` from `api.js`, which isn't exported there.
- [x] `src/components/version-switcher.jsx` — zero references repo-wide.
- [x] `src/hooks/useMachineStatus.js` — no page or component imports it.
- [x] `src/components/ui/dialog.jsx` — unused shadcn Radix dialog; `Modal.jsx` is the one actually
  used (9 files). Removing it also frees `@radix-ui/react-dialog`.
- [x] Unused `api.js` exports: `register`, `getUser`, `rotateUserKey`, `getTransaction`,
  `deleteTransaction`, `getInterface`, `getPeripheral`, `deletePeripheral`, `getMiddlewareClient`,
  `getMiddlewareMachines`, `getMiddlewareMachine`.
- [x] Unused deps — root: `autoprefixer`, `postcss` (no postcss config; Tailwind v4 runs via
  `@tailwindcss/vite`), `@radix-ui/react-dialog` (once dialog.jsx goes). backend: `sonner` (a React
  toast library in a Node package).
- [x] `virtual-serial-server` imports `@serialport/binding-mock` but **doesn't declare it** — it only
  resolves as a transitive of `serialport`. Add it before deploying.
- [!] Unused assets: `public/geral/login.jpg` (carousel uses `/login/1..6.jpg`),
  `public/geral/freshbubbleslogo.png`. *Verify against the branding settings row first — that path
  is dynamic.*
- [x] **Tailwind config was inert.** **(fixed — theme ported to v4 `@theme`; verified by A/B build)** `tailwind.config.cjs` is v3-style but `src/index.css` uses
  Tailwind v4 (`@import "tailwindcss"`) with no `@config` directive, so it likely never loads —
  meaning the custom theme colors and `@tailwindcss/forms` aren't applying. Worth verifying.

---

## Found while fixing (all fixed)

Bugs that were not in the original sweep — they surfaced while repairing the items above.

- [x] **Every offline sale push 500'd, so nothing ever synced.** `backend/src/routes/sync.js:36` —
  the duplicate check was `findOne({$or:[{_id: data.id}, …]})` and the kiosk generates **UUIDs**
  (`database.cjs:generateId` → `randomUUID()`), which are not ObjectIds. Mongoose threw a CastError
  on every push. Now `_id` is only matched when the value is actually a valid ObjectId.
- [x] **`/pos/cards/:code/spend` crashed after debiting the card.** `pos.js` — `MachineT` was
  declared with `const` *inside* an `if (machineId)` block, then used again outside it. Every card
  spend that named a machine threw a `ReferenceError` **after** the balance had been reduced and the
  sale recorded, but before the machine was started. Customer paid, machine never ran.
- [x] **`withTenant` failed *open*.** `services/tenant.js` — when no tenant resolved it dropped the
  filter entirely, so an unauthenticated request with no `X-Tenant-Id` read every tenant's machines,
  prices and settings. Now scopes to an impossible filter, with a single-tenant fallback in
  `resolveTenant` so public kiosk endpoints still work on a normal one-operator install.
- [x] **`withTenant` had no `aggregate`,** so both analytics routes used the bare model. (They
  happened to carry their own `$match`; the wrapper now adds one regardless.)
- [x] **The kiosk silently stopped receiving config.** `database.cjs` — sql.js refuses to bind
  `undefined`, and the sync mappers emit `undefined` for any optional field the server omitted (a
  price with no `duration`, a peripheral with no `image`). That threw inside `bulkReplace`'s
  transaction, aborting the whole pull — and the error was swallowed by an empty `catch {}`.
  `run`/`queryGet`/`queryAll` now coerce `undefined` to SQL NULL.
- [x] **`session.update` stored `null` as the string `"null"`.** `database.cjs` — `typeof null` is
  `'object'`, so the JSON branch stringified it. Read back, `"null"` is truthy, so the POS would
  believe a card was still inserted after removal.
- [x] **`dayCloses.create` returned `{changes}`, not the id,** so `performDayClose`'s
  `result.local_id` was `undefined` and the queued Z-report had no idempotency key at all.
- [x] **Sale/day-close pushes reported failures as a bare `HTTP 400`,** with the server's reason
  discarded — then retried ten times and dropped. The response body is now included in the error.
- [x] **Client-supplied prices were trusted.** `gateways.js` — `card/pay` and `cash/pay` totalled
  `Number(item.price)` straight from the request. The kiosk sits on a public terminal, so that is a
  €10 wash for €0.01. Both now price every line from the tenant's own `Price` table
  (`{type, weight}`, cash vs card column, promo window honoured) and ignore what the client sent.
- [x] **A machine could be double-sold between validation and activation.** `gateways.js` — the
  status check and the `status: 'working'` write were separate. Now a conditional
  `findOneAndUpdate({status: {$ne: 'working'}})`.

---

## Round 2 — data model, concurrency & frontend money flow

Run inline after the deep-dive agents hit the session limit twice. All fixed.

### Concurrency (the big one)

- [x] **Every card balance change was a lost-update race.** Six read-modify-write sites
  (`pos.js` ×3, `gateways.js` ×2, `sync.js` ×1) all did
  `card = await findOne(); card.balance = …; await card.save()`. Two kiosks in one tenant
  touching the same card both read the old balance and the second `save()` overwrote the
  first: a €20 card paying two concurrent €5 washes was charged **once** and got **two**
  washes. Added `services/cardBalance.js` — `creditCard` / `debitCard` / `applyCardDelta` —
  which push the arithmetic and the sufficiency check into a single guarded `$inc`.
- [x] **The sync idempotency check was itself racy.** `/sync/push/card` read
  `appliedDeltas`, checked `.includes(opId)`, then wrote. Two concurrent retries of the
  *same* push both passed the check and both applied the delta — precisely the double
  credit the key exists to prevent. Dedupe, overdraft guard and balance change are now one
  `findOneAndUpdate` with `appliedDeltas: {$ne: opId}` and `$push … $slice`.
- [x] **Two admins could assign the same interface port.** `admin.js` only checked for a
  collision in application code with a `findOne`. Now enforced by a unique partial index on
  `{tenantId, interfaceId, port}` — otherwise one customer's payment starts another's machine.
- [x] **Missing indexes on genuinely hot paths.** `/sync/push/sale` dedupes on
  `metadata.localId` on *every* push from *every* kiosk with no index — a full collection
  scan per sale. Same for `machine.intId` and `{interfaceId, port}`, both hit several times
  a second by hardware status packets, and `sale.cardCode` for card history.

### Frontend money flow

- [x] **Retrying a failed checkout re-credited every recharge.** `App.jsx:handlePay` posts
  recharges first, then machine payments; a 409 on a busy machine aborts the rest but leaves
  the recharges applied — and the cart is not cleared. `batchId` was
  `batch-${Date.now()}-${random}`, so the customer tapping "pay" again produced a brand-new
  batch and credited the card again, every time. `batchId` is now derived from the cart's own
  stable item ids, each request carries a `localId`, and `/pos/sale` + `/pos/recharge` dedupe
  on `metadata.localId` and return the original result.
- [x] **A hopper jam was a silent short-change.** `PaymentContext` discarded the
  `changeDispensed` / `changeError` fields the backend now returns, so the UI showed
  "Pagamento efetuado" whether or not the coins came out. It now shows a destructive toast
  naming the amount owed and telling the customer the sale is on record.
- [x] **`change` was sent from the client** on the `/pos/recharge` and `/pos/sale` calls in
  `App.jsx`. The server ignores it now, but sending it at all was the wrong shape — removed.

**Note on what I did NOT find:** the manual pay buttons (`checkCardAndPay`,
`topupCardAndRetry`) do have `disabled={checkingCard}` in-flight guards. The main cart flow is
hardware-driven ("Aguardando pagamento…") with no tappable pay button, so there is no
double-submit hole there — the retry path above was the real duplicate-charge route.

---

## Round 3 — hardware layer, security hardening, dead code

### Decisions I made (change them if you disagree)

Two items were marked "needs your call". Both had a correct implementation already
in the kiosk (`pos-client/electron/pos-engine.cjs`), so I aligned the backend to it
rather than inventing a rule:

1. **autoCharge — inserted cash goes to the session; the UNSPENT remainder moves to
   the card when it is removed.** Previously every coin was queued as a card credit
   *and* made immediately spendable: insert €5 → €5 to spend now plus €5 on the card.
   Now: insert €5, spend €2, remove the card → €3 moves across.
   *If you actually want inserted cash to go straight to the card and not be
   spendable in the session, say so and it is a small change.*
2. **Cash-mode payment persists the card balance.** `deductCredits` always drained
   the card first but the save was skipped for `paymentType === 'cash'`, and
   `resetCardInfo` then wiped the in-memory copy — so the card kept its old DB
   balance. Unlimited free washes. The balance is now saved before the card is
   cleared.
3. **`CashModal` and the "Pagar com Cartão" prompt stay unreachable, and the dead
   code behind them is gone.** The live flow is hardware-driven (insert coins / tap
   card) and now reports change failures properly. Re-adding manual buttons is a
   product decision, not a bug fix — say the word if you want them as a
   hardware-failure fallback.

### Hardware layer — rewritten around real framing

New `backend/src/services/ccTalk.js` and `kitsec.js`, both covered by tests.

- [x] **One hopper now pays one denomination.** A ccTalk hopper's dispense command
  carries only a coin *count*, so looping denominations against a single address
  paid N coins of whatever it held. Hoppers each get a `coinValue` and their own
  `deviceAddress`; payout is planned largest-coin-first across all of them, and any
  amount that cannot be made (e.g. €0.20 from a 50c-only hopper) is **reported**
  rather than silently mispaid.
- [x] **Serial data is framed and checksum-verified.** Two coins in one chunk are two
  credits; a split frame is buffered; a bad checksum resynchronises instead of
  wedging. An unmapped credit code is now refused rather than guessed at.
- [x] **`waitForResponse` replaced by a per-port queue.** One command in flight at a
  time, so a reply can only belong to the command that asked for it.
- [x] **Machine activation actually writes to the port** (and `drain`s), instead of
  logging "Activation pulse sent" and returning the buffer.
- [x] **Nothing reports success it cannot verify any more**: `print`, `dispenseCard`,
  `writeCardData` and the stub pulse/USB/ethernet transports all throw instead.
- [x] **MIFARE sector trailers are skipped**, so writing a card no longer bricks it.
- [x] **Dropped ports reconnect** with backoff instead of wedging until restart.

### Verification

- 36 backend tests pass, including 12 new hardware-protocol tests covering the exact
  failure modes above (two-coins-one-chunk, split frames, bad checksums, noise
  resync, request/response correlation, KITSEC status byte 0x03).
- The ccTalk stack was additionally exercised **over a real PTY pair** against a
  simulated acceptor — framing, concurrent request correlation and multi-coin replies
  all verified on real serial rather than in a mock.
- The Tailwind fix was confirmed by an A/B build: `bg-primary-600` and `font-heading`
  emitted **0 rules** before and 1 each after.

---

## Round 4 — the loyalty card system

Checked end to end after you flagged it. **It did not work at all.** Four separate
breaks, each of which alone would stop a card from ever being usable.

- [x] **`middleware` was `undefined` at every call site in `pos.js`.** All four did
  `const { middleware } = await import('../index.js')` — and `index.js` exports
  nothing. So:
  - `if (dispenser && middleware)` was always false → **no card was ever dispensed**,
    while the customer was charged in full and shown *"Card dispensed. Please insert
    card into reader to activate."*
  - `/card/write` hit `if (!rfidReader || !middleware)` → **503 every time**, so a
    purchased card could never be activated
  - `/card/read` never worked
  - change on a card purchase was never paid out
- [x] **The kiosk UI never wrote the card.** `BuyCardModal` called
  `/pos/card/mark-written/:code`, which only flips a database boolean — the endpoint
  that actually writes the id and balance onto the plastic (`/pos/card/write/:code`)
  was never called. And its `catch` moved to "Cartão ativado!" *even on failure*.
  The customer walked away with blank plastic and a database row.
- [x] **Money could be taken with no card.** The dispense now happens **before** the
  sale is recorded: a jammed or empty dispenser returns 503 and nothing is charged.
- [x] **A blank card was spendable.** Cards now carry a `status`
  (`pending_write` → `active`), and a card that was paid for but never written at
  the reader is refused for payment until it is.

### How the flow works now

1. Customer fills in their details and pays → price checked, amount validated.
2. **Blank card is dispensed first.** If the dispenser fails: 503, no charge, no sale.
3. Card row created as `pending_write`, sale recorded, change paid (and reported if
   the hopper could not).
4. Customer inserts the blank card → `/pos/card/write/:code` writes **the card code
   (their id) plus balance and details** onto it, verifies the reader's ACK, and
   only then flips the card to `active`.
5. A write failure keeps the card `pending_write` and tells the customer to retry —
   their payment is already on record, so they do not lose the card they bought.

### One design decision worth knowing

**The database is the source of truth for balance, not the card.** When a customer
taps their card we read the *code* off it and look the balance up server-side
(`client.setClientInfoByCard`). The balance written onto the card is a convenience
copy — for display and any future offline use — and is never trusted for spending.

That is deliberate: a balance the card itself asserts is a balance a customer can
forge with a €30 reader/writer. If you ever want true offline card spending, the
card data has to be cryptographically signed, which is a bigger piece of work — say
the word and I will scope it.

---

## Deploy notes (do these on the Hetzner box)

1. **Drop the old user email index once**, or the new `partialFilterExpression` will not be created
   (Mongo keeps the existing `sparse` index and silently ignores the new definition):
   ```
   db.users.dropIndex('tenantId_1_email_1')
   ```
   Mongoose recreates it correctly on next boot.
2. **Kiosk DB migrates to v3 automatically** on first launch (adds `sync_dead_letter`). No action,
   but it is a one-way migration — take a copy of `washbubbles.db` first.
3. **`role` is now an enum** on `User`. Any existing row with a role outside
   `USER|KIOSK|ADMIN|SUPERADMIN` will fail validation on its next save — check with
   `db.users.distinct('role')` before deploying.
4. **Card delta pushes now require a `localId`.** Old kiosk builds don't send one and will get a 400.
   Deploy the kiosk and the backend together.
5. **Configure the hopper(s).** Each hopper peripheral now needs `hopperConfig.coinValue`
   (the single coin it pays) and `deviceAddress` (its ccTalk bus address). Without a
   coinValue a hopper is skipped and change is reported as undispensed — deliberately,
   since the alternative is paying out the wrong coin. One hopper per denomination.
6. **Set an admin PIN.** `hw:adminStartMachine` (start a machine free of charge) now
   requires the `adminPin` setting. It is unset by default and the action fails closed
   until you set one.
7. **Check the card dispenser and RFID reader are configured** as peripherals with
   the right `address` (port path) and `deviceAddress` (ccTalk bus address). Selling
   a card now fails closed with a 503 if no dispenser is configured, rather than
   charging for a card that never appears.
8. **New indexes build on first boot.** The unique one on `{tenantId, interfaceId, port}` will
   FAIL to build if duplicates already exist. Check before deploying:
   ```
   db.machines.aggregate([{$match:{interfaceId:{$ne:null},port:{$ne:null}}},{$group:{_id:{t:'$tenantId',i:'$interfaceId',p:'$port'},n:{$sum:1}}},{$match:{n:{$gt:1}}}])
   ```
   Anything returned is two machines wired to one physical port — fix the data first.

---

## Already fixed in this pass

- [x] `requireKioskOrAdmin` guard added and applied to all 11 unguarded `/api/middleware/*` routes.
- [x] Real ccTalk protocol implemented in both hardware agents (poll → route → stack → credit,
      poll-until-idle hopper dispense), verified end-to-end against `virtual-serial-server` over a
      real PTY pair.
- [x] `dispenseCoins()` was a no-op stub that never wrote to the serial port — now implemented, and
      its caller fixed to await it.
- [x] Hopper over-dispense ceiling (admin-configurable, defaults to 50 coins).
- [x] Tenant "assign user" endpoint was a no-op that never saved the membership.
- [x] Day-close `closedBy` always saved as `undefined` (`req.user._id` doesn't exist).
- [x] `AdminPrices.jsx` loaded `autoCharge` with a corrupted key string.
- [x] `AdminPeripherals.jsx` card-dispenser protocol list was missing `cctalk`.
