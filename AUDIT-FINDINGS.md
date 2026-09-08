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

## Round 5 — card identity was reading the wrong bytes entirely

You asked the right question ("what if a different chip is tapped?") and it led
to a real bug: **the day-to-day tap flow and the purchase-write flow were two
completely disconnected code paths.**

- `writeCardData` wrote our own generated `code` into the card's data blocks
  (blocks 1, 2, 4, 5, … — skipping sector trailers).
- But the "customer tapped their card" listener (`handleRFIDData`) just took
  whatever raw bytes arrived on the serial port and used THAT directly as the
  card number — it never read the blocks back. For a request/response PC/SC
  reader (which is what the existing 0xFF 0xB0 / 0xFF 0xD6 commands in this file
  are written for), nothing arrives on the wire until you ask for it, so this
  path would essentially never resolve a legitimately purchased card correctly
  on a normal tap.
- On top of that, MIFARE Classic requires **authenticating to a sector before
  any read or write** — the existing read/write code skipped this step entirely,
  so on real MIFARE hardware every read/write would simply have been refused.

### What changed

- [x] **One function reads a card's identity, used everywhere.** `readCardIdentity`
  authenticates each sector with the MIFARE factory default key, reads the
  blocks, and parses our JSON — used by the explicit `/pos/card/read` route,
  write verification, AND a new active tap-detection poll. There is exactly one
  answer to "what is on this card," never two.
- [x] **Tap detection is now a real poll loop**, not a passive listener. A PC/SC
  reader only speaks when asked, so `startRfidPolling` actively polls for a UID
  (`0xFF 0xCA` Get Data) every 500ms; on a new UID it authenticates and reads.
  The old passive `port.on('data')` dispatch to RFID is removed — it was also
  the reason a write's own ACK bytes could get reinterpreted as a "card tapped"
  event mid-write (the same request/response leak class flagged elsewhere).
- [x] **Authentication is now required** before every block read and write, using
  the MIFARE Classic factory default key (`FFFFFFFFFFFF`) — the only key any
  unformatted stock card carries. This directly answers your question:
- [x] **Your three scenarios, explicitly:**
  1. *Card already has our id* → authenticates, reads it, resolves normally.
  2. *Blank card, ours to write* → the purchase flow generates a random id
     (`crypto.randomInt`, already had a DB-uniqueness retry loop) and writes it —
     unchanged from Round 4, now with authentication actually performed.
  3. *A different chip* (foreign card, a "magic"/UID-clone card, a blank card
     formatted with a non-default key, or a tag that isn't MIFARE Classic at
     all) → authentication fails, or the blocks don't decode as our JSON.
     Either way it throws, is reported under a `UID:<hex>` placeholder id that
     can never collide with one of our own codes, falls through the **existing**
     "card not found" rejection (`client.setClientInfoByCard` → not found →
     `card-invalid`), and **cannot consume or add credits.** Nothing is
     auto-registered from a tap — registration only ever happens through the
     paid purchase-and-write flow.
- [x] **Write is verified by reading the card back**, not just trusting each
  block's ACK — a per-block ACK doesn't prove the full JSON round-trips.
- [x] Confirms the design principle from Round 4: **the database remains the
  source of truth for balance.** The card's factory UID is used only to detect
  that *some* card is present; it is never trusted as an identity, since cheap
  clone hardware can present any UID it likes. Our own written code — behind a
  key an attacker doesn't have — is what makes a card "ours."

### Confidence level — read this before relying on it

Unlike the ccTalk work, **this has not been exercised against a real reader.**
There is no PC/SC-capable device in this environment to test against. What's
covered:

- 8 new unit tests against a fake PC/SC device covering UID read, authentication
  success/failure, identity read/parse/reject, sector-trailer avoidance, and
  write-verification catching a lying write.
- The command bytes (Get UID, Load Key, General Authenticate, Read/Update
  Binary) are the standard PC/SC Part 3 pseudo-APDU family used by most USB CCID
  contactless readers (ACR122U, PN532-based modules) — the same family the
  read/write commands already in this file belong to.

What is **not** confirmed: whether your specific reader model implements this
exact command set, and whether it appends a status word after Read Binary data
the way the code assumes (handled defensively — see the comment above
`hasStatusWord` in `readRFIDSectors`, but not verified). Get the reader's
datasheet before going live and check these against it — the same category of
confirmation as the hopper `coinValue`/`deviceAddress` settings.

---

## Round 6 — day-close cash reconciliation

The admin "Fecho de Caixa" flow (`AdminDayClose.jsx` + `admin.js`'s `/day-close`
routes) turned out to already be a genuinely thorough 5-step wizard — cash count,
mechanism count, hopper actual-vs-target with a gap calculator, bank/float split
with live client-side validation, notes, plus an expandable history. The audit here
found real bugs in the *server-side* reconciliation logic underneath it, not gaps
in the UI.

- [x] **A sale could vanish from every future report.** The next session's start
  boundary was `lastClose.createdAt` — but `createdAt` is set when the document is
  finally written, which is measurably *after* `periodTo` (captured at the start of
  the same request, before several queries run). A sale landing in that gap had a
  timestamp before `createdAt`, so it satisfied neither the closed period's
  `$lte: periodTo` nor the next period's `$gt: createdAt` — it belonged to no
  report, ever, with no error and no trace. Fixed: the next period's start now
  reads `periodTo`, the field that actually marks where counting stopped.
- [x] **A kiosk auto-push could reset the float chain to zero.** `/sync/push/day-close`
  writes its own record to the same `DayClose` collection as an offline backup of
  the kiosk's local Z-report — it never has a real `floatLeft`/`amountToBank` (both
  default to 0) and its `periodTo` is whenever the kiosk happened to run its local
  close, uncoordinated with when staff actually count the drawer. The admin route's
  "last close" query didn't distinguish source, so a kiosk push landing between two
  manual closes would silently zero out `openingFloat` for the next one and shift
  the reconciliation window to the wrong moment. Fixed: the dashboard's chain now
  explicitly excludes `source: 'kiosk'` rows — the kiosk push is a record, the
  dashboard flow is the only source of truth for the cash chain.
- [x] **The bank/float split was only validated client-side.** The dashboard
  already checks `amountToBank + floatLeft === countedCash` before submitting, but
  the server trusted that blindly — a stale tab, a direct API call, or a client bug
  could write a permanent financial record where the split doesn't add up to what
  was counted. Added the same check server-side.
- [x] **Two closes could race and double-book the same cash.** Reading "the last
  close," aggregating sales since it, and writing the new close is a read-then-write
  sequence — two admins closing at the same moment (or one double-tapping through a
  slow network) could both read the same opening state and both succeed, silently
  creating two records over the same sales window. Added a per-tenant lock
  (`models/lock.js`) that serialises the whole sequence — a single atomic
  document update against a unique index, so it holds without needing a replica set
  or multi-document transactions. Verified with a genuinely concurrent test
  (`Promise.all`, not sequential): exactly one of two simultaneous submissions wins.
- [x] **No audit trail linking a close to the sales it covered.** The association
  only ever existed as an implicit re-query by timestamp range. Added
  `Sale.dayCloseId`, set once at close time — an auditor (or the next bug hunt) can
  now trust it directly instead of re-deriving "which sales belong to this report"
  from the same date-range logic that had the gap bug above.

6 new backend tests, all against a dedicated tenant to avoid cross-test pollution:
empty-session baseline, live summary roll-up, the bank/float mismatch rejection, a
full close with sale-tagging verification, float-forward-carry, the periodTo/gap
fix, kiosk-push isolation, and the concurrent double-close rejection. 65 backend
tests total, stable across repeated runs.

---

## Round 7 — day-close on the kiosk, and a maintenance lock screen

Two feature additions, requested directly rather than found in audit.

### Close the day from the kiosk, not just the dashboard

- [x] The reconciliation logic (opening-float chain, the atomic per-tenant lock,
  server-side split validation, sale-tagging) was extracted from `admin.js` into
  `services/dayClose.js`, since `admin.js` applies `requireAdmin` to its whole
  router and a kiosk token could never reach it there. Both `admin.js`'s route and
  a new one in `pos.js` now call the same functions — there is exactly one
  implementation, not two that could quietly drift apart.
- [x] **Kiosk day-close writes are gated by the staff PIN a second time,
  server-side** — not just a kiosk apiKey. A payment can be charged back; a bogus
  reconciliation record just corrupts the books, and an apiKey lifted from a
  compromised terminal's stored config is still only a kiosk credential. The PIN
  is the proof a physical operator is actually there. Reading the live summary
  needs no PIN (nothing is written); an admin token skips the PIN entirely, since
  the admin JWT already is that credential and the dashboard's own route never
  asked for one either.
- [x] The wizard UI itself (5 steps: count, mechanism, hopper, bank/float split,
  notes) was extracted into `components/dayClose/` and is now shared verbatim
  between `AdminDayClose.jsx` and the new `KioskDayCloseModal.jsx` — one set of
  components, two entry points.
- Verified live end-to-end against the real dev backend: PIN gate → wizard loads
  the server's real summary → submits → lands in Mongo tagged
  `source: 'dashboard'`, `closedByUsername: 'kiosk'` — chains into the next
  session's opening float exactly like an admin-initiated close, and shows
  correctly in the dashboard's own history list.

### Maintenance lock screen

- [x] A full-screen "Ecrã bloqueado" overlay (padlock icon) that a staff member
  can engage from a discreet always-present control on the kiosk, for stepping
  away to do physical maintenance — refilling the hopper, clearing a jam,
  physically counting cash — without a customer being able to touch the screen
  in the meantime. Deliberately separate from any modal's own backdrop: a modal
  only blocks interaction while it happens to be open, and closes the moment
  that action finishes — this is for an open-ended "staff isn't watching the
  screen right now" state.
- [x] Unlocking requires the staff PIN again, verified server-side — otherwise
  any customer could tap "Desbloquear" and defeat the entire feature.
- [x] A `kioskLockEnabled` setting, toggled from a new "Staff & Manutenção" card
  in `AdminSettings.jsx`, turns the feature on/off — when off, the lock control
  is hidden entirely (the day-close entry point is unaffected either way, since
  it's a separate action).
- [x] **Caught in live testing, not by inspection**: the day-close modal
  originally also engaged this same global lock while open, on the reasoning
  that counting cash is "maintenance" too. In practice this rendered the
  full-screen "enter PIN to unlock" overlay *on top of* the day-close wizard
  itself the moment it opened — staff would have been locked out of the very
  screen they just opened. Removed; the day-close modal's own backdrop is
  sufficient, since staff are actively present, not stepped away.
- [x] Also added: `AdminSettings.jsx` had no UI at all for the `adminPin`
  setting introduced in Round 4 (manual payment, admin-start-machine) — it was
  only settable via the raw key/value editor at the bottom of the page. Given a
  dedicated field in the same new card.

8 backend tests (kiosk summary read, no-PIN/wrong-PIN/right-PIN on the kiosk
create route, and admin-token-skips-PIN), reusing the existing day-close test
tenant. 70 backend tests total.

---

## Round 8 — offline-first kiosk: bundle the UI locally, and card status parity

Requested directly: what happens to the kiosk when the internet drops. The
answer turned out to be "nothing works, not even the screen" — production
`main.cjs` called `loadURL('https://washbubbles.app')` unconditionally, so a
dropped connection didn't degrade to a local screen, it showed a browser
connection error, because the UI itself had never been fetched onto the
machine in the first place. Worse: even while fully online, the React UI
never used the offline-capable local engine (`pos-engine.cjs` / `database.cjs`
/ `sync-engine.cjs`) that was already built and wired through `preload.cjs` —
every money operation (`App.jsx`'s `handlePay`, recharge, `/pos/sale`) went
straight over HTTP to the remote API, so none of that local machinery was
ever actually in the loop for a real transaction.

This round did the two pieces of that gap that could be closed safely without
a hardware decision or a redesign of multi-item cart checkout — both deferred
below, with the reasons.

### Bundle the frontend locally, load it from disk

- [x] `vite.config.js` now builds with `base: './'` — relative asset paths
  instead of absolute `/assets/...`. The kiosk loads its bundle via `file://`,
  which resolves an absolute path against the filesystem root, not the HTML
  file's own folder; without this the bundled `index.html` would 404 every
  script and stylesheet the instant it wasn't served over HTTP. Safe for the
  normal nginx deployment too, since it's a client-routed SPA and the HTML
  document is always served from the site root regardless of which page is
  active.
- [x] `pos-client/electron/main.cjs` rewritten: `loadURL(remote)` replaced
  with `loadFile(LOCAL_UI_PATH)`, where `LOCAL_UI_PATH` points at the
  repo-root `dist/` build sitting alongside `pos-client/`. A developer
  override (`ELECTRON_START_URL`) still points at a live Vite dev server for
  local work; the CSP and `will-navigate` allowlist only admit that dev
  origin when the override is actually set, so a packaged kiosk build has no
  remote UI origin to fall back to at all.
- [x] If `dist/index.html` is missing on the kiosk machine (packaging
  mistake, forgot to deploy it), the app fails loud on a local data: URL
  ("Aplicação não encontrada — Contacte o suporte técnico") and logs the
  expected path to the console, rather than a browser's generic offline error
  a technician has no way to diagnose from the kiosk screen itself.
- [x] Verified live, not just by inspection: built the real `dist/` output,
  served it over plain HTTP from a throwaway server, and loaded it in a fresh
  browser tab — renders correctly, zero console errors, confirming the
  relative-path resolution actually works before trusting it under real
  `file://` loading in Electron (which nothing here can drive directly).

### Card status parity — local can't spend what the server would refuse

The local engine already tracked card balance, but not activation state.
Offline, a `pending_write` (not yet activated) or `blocked` card could still
be topped up or spent against, because the local SQLite `cards` table had no
`status` column at all — the server-side lifecycle simply didn't exist here.

- [x] Local DB migration v4 (`database.cjs`, `DB_VERSION` 3→4) adds
  `cards.status`, idempotent via a `PRAGMA table_info` guard. `cards.upsert`
  and `cards.bulkUpsertPreserveBalance` both carry it now — the latter
  updates status independently of balance sync, since a card can be blocked
  server-side well before its balance next changes, and status must not wait
  on that.
- [x] `sync-engine.cjs`'s `_mapCard` now pulls `status` down from the server
  on every pull, so a card blocked from the dashboard reaches the kiosk on
  the next sync even with no transaction against that card in between.
- [x] A shared `assertCardSpendable(card)` guard (not found / `pending_write`
  / `blocked`) is now the single check applied at all three places a card can
  be spent or loaded locally: `handleCardDetected` (refuses to load a
  non-active card into session state at all, emitting a new `card:blocked`
  event distinct from `card:unknown`), `topUpCard`, and the card branch of
  `processSale`. One helper, three call sites, instead of three chances to
  forget the check.

### The UI now actually calls the local engine — single-machine cash payment

- [x] New `src/services/local-api.js` — a narrow wrapper around
  `window.electronAPI`, deliberately not a 1:1 mirror of the remote `api.js`.
  It exposes exactly `isElectron`, `getSession()`, and `processSale(...)`,
  because that is exactly as much of the local engine as `handlePay` can
  safely drive today — see the cart/gateway gap above.
- [x] `App.jsx`'s `handlePay` cash branch now checks, before ever touching
  the network: is this a single machine with no card recharges bundled in,
  and does the kiosk's own local session already hold enough real cash
  credit to cover it (money the embedded hardware agent has actually
  received through the physical coin/bill acceptor, tracked in
  `pos-engine.sessionState` independent of connectivity)? If so, the sale is
  settled entirely through `local-api.processSale` — no HTTP call at all —
  and the machine is activated the same way `adminStartMachine` already was:
  directly by the embedded hardware agent, in-process. If not — a multi-item
  cart, a bundled recharge, or simply not enough local credit yet — it falls
  straight through to the existing network path, byte-for-byte unchanged.
  Verified this fallthrough is inert outside Electron: `window.electronAPI`
  is `undefined` in a plain browser, so `isElectron` is `false` and the new
  branch never runs there — confirmed live by loading the built app in a
  browser with no Electron shell and checking `typeof window.electronAPI`.
- [x] **Deliberately did not try to reconcile this with `CashModal`'s
  "declare cash by tapping on-screen coin buttons" flow, or with
  `CartModal`'s cash auto-detection.** That auto-detection currently listens
  for `peripheral:credit` over the *remote* websocket
  (`src/services/websocket.js`) — which traces back to
  `backend/src/hardwareAgentServer.js`, explicitly labelled "Legacy hardware
  agent support" in `ARCHITECTURE.md`, relaying from the standalone
  `backend/src/hardwareAgent.js` agent (also marked legacy/deprecated there).
  That is a *third*, separate hardware pipeline from the one this whole round
  has been hardening (the embedded `pos-client/electron/hardware-agent.cjs`
  feeding `pos-engine.cjs` directly, zero network hop). A site whose cash
  intake genuinely comes from that legacy pipeline, or from a staff member
  manually tapping `CashModal`'s buttons, has no local credit sitting in
  `pos-engine.sessionState` at all — for it, nothing changes: `handlePay`
  simply falls through to the network path exactly as it always did. Nothing
  here can make cash payment worse anywhere; it only adds a path for sites
  where the embedded agent is the one actually wired to the coin acceptor.
- 70 backend tests still pass; no backend changes this round.

### Deliberately deferred — needs a decision or more work, not a quick fix

- [x] **Multi-item cart checkout local equivalent — done in Round 11.**
  `pos-engine.processCart` now handles several machines and/or recharges in
  one atomic batch, wired into `App.jsx`. See Round 11.
- [x] **RFID hardware model mismatch — resolved in Round 11**, by standardising
  on MIFARE (the user's explicit call, given a genuine hardware ambiguity —
  see Round 11). The kiosk's local `hardware-agent.cjs` now does the same
  PC/SC read/write authenticated exchange the server side already did.
- [x] **`BuyCardModal` (new card purchase/write flow) — done in Round 11**,
  now that the write-capable RFID path exists locally.
- [!] **Kiosk day-close still requires connectivity**, by the design decided
  in Round 7 — it calls `/pos/day-close/summary` / `/pos/day-close` directly
  with no local fallback. Left as-is: it's a rare, staff-initiated action
  with a PIN gate already, not something blocking routine customer
  transactions, so it wasn't in scope for "make the kiosk usable while
  offline."
- [x] **Live local session balance — done in Round 12.** `CartModal` now
  subscribes to `onSessionUpdate` and shows the running credit as coins land,
  auto-confirming cash payment once it covers the cart — same UX the legacy
  websocket `cashInserted` path already had.
- [x] **Card payment through the local engine, and RFID auto-pay — done in
  Round 11.** `CartModal` now also listens for the embedded agent's own
  `card:loaded`/`card:blocked` over IPC, and `App.jsx`'s card branch settles
  locally the same way the cash branch does.
- [x] **"Levantar troco" cash-out button — done in Round 12.** New
  `pos-engine.cashOut()` hands back unspent cash + bonus (not a loaded
  card's own balance) via the hopper; a button next to "Cancelar" in
  `CartModal` calls it when there's local cash to return.

No backend changes this round — frontend/Electron only. 70 backend tests
still pass (regression check, unaffected as expected).

---

## Round 9 — the relative-base fix from Round 8 was itself broken

**Caught in live testing, not by inspection** — the user reported "some icons
are missing" after Round 8 shipped. Chasing it down turned up something worse
than missing icons: Round 8's `base: './'` change, needed so the kiosk's
bundle would load over `file://`, silently broke the **web deployment** on
every route except exactly `/`.

### Why: one `base` cannot serve both targets

The web app is a client-routed SPA (`BrowserRouter`, history-API routing) and
nginx serves it with `try_files ... /index.html` — a request for
`/admin/machines` gets index.html's bytes back, but the browser's address bar
still reads `/admin/machines`. A **relative** asset path in that document
(`./assets/index.js`) resolves against the *current URL*, not the file's real
location — on that route it resolves to `/admin/assets/index.js`, which
doesn't exist. Verified directly: served the built `dist/` through `serve -s`
(mirrors nginx's fallback behaviour) and loaded `/admin/machines` — the
browser requested `/admin/assets/index-*.js`, got index.html's bytes back
instead (wrong content, `text/html`), and refused to execute it as a module:
_"Expected a JavaScript-or-Wasm module script but the server responded with a
MIME type of 'text/html'"_. The whole app fails to load — not a cosmetic bug.
Absolute paths (`/assets/index.js`, Vite's default `base: '/'`) don't have
this problem, which is exactly why nothing broke before Round 8 touched it.

The icons the user actually noticed were a second, independent symptom of the
same root cause: `Pos.jsx`, `Machines.jsx`, `MachineDetail.jsx`, `CardModal.jsx`,
`LoginCarousel.jsx`, `LanguageSwitcher.jsx`, `Banner.jsx`, and three admin
pages all referenced images in `public/` by hand-typed absolute path
(`'/washingmashine/L1.png'`, `'/geral/interface.png'`, etc.). Those paths are
never touched by Vite's `base` config at all — they're plain strings, resolved
by the browser at runtime against the *current document location* — so they
work fine over HTTP (where `/x.png` always means "site root") but break under
`file://` (where a leading `/` means *filesystem* root) regardless of which
`base` the build used.

### The fix: two builds, not one config

- [x] `vite.config.js` now takes a `mode`: `npm run build` (default, web) is
  `base: '/'` → `dist/`, unchanged from before Round 8 ever happened. New
  `npm run build:electron` is `base: './'` → `dist-electron/`, used only by
  the kiosk. One `base` value genuinely cannot satisfy both targets — this
  isn't a workaround, it's the correct shape for a SPA that has to run both
  from a domain root with client-side routing *and* standalone off disk.
- [x] `pos-client/electron/main.cjs`'s `LOCAL_UI_PATH` now points at
  `dist-electron/index.html`, not `dist/index.html`. **Deploy note 11 from
  Round 8 is now wrong** — see the corrected one below. Pointing the kiosk at
  plain `dist/` looks fine at first paint and then breaks the instant the app
  client-navigates anywhere, which is exactly how this shipped unnoticed.
- [x] Every hardcoded `public/`-folder image reference across the 10 files
  above was replaced with a real `import` from `src/assets/...` (the actual
  files were `git mv`'d out of `public/` into `src/assets/`, split by the
  original folder name). This is not interchangeable with just prefixing
  `./` onto the old strings — a plain relative string has the *exact same
  current-URL-relative resolution problem* as the `<script>` tag did, so it
  would still break on any nested route in both the web and the Electron
  build the moment the app client-navigates away from `/`. A real `import`
  is resolved by Vite at build time independent of whatever route is active
  when the image renders, in both builds.
  `public/uploads/` (admin-uploaded branding images, written at runtime, not
  part of the build) and two genuinely unreferenced files
  (`geral/freshbubbleslogo.png`, `geral/login.jpg`) were left alone.
- Verified both ways: rebuilt both targets from clean, confirmed `dist/`
  emits `/assets/...` and `dist-electron/` emits `./assets/...`, re-ran the
  `serve -s dist` deep-route repro (now resolves and executes correctly on
  `/admin/machines`, confirmed via a fresh tab with zero console errors), and
  loaded the root route in a live browser to confirm the banner, flag, and
  machine-animation images render from their new bundled paths, not broken
  image icons.
- 70 backend tests still pass; no backend changes.

## Round 10 — post-purchase guest WiFi voucher

New feature, not an audit finding: after a wash/dry sale, the kiosk shows a
QR/code popup for time-limited guest WiFi, backed by a UniFi controller.

- [x] `backend/src/services/unifiVoucher.js` — logs into a UniFi Network
  Controller (classic or UniFi OS via `UNIFI_BASE_PATH`) and creates a
  single-use hotspot voucher. Self-signed cert on the LAN controller is the
  default assumption (`UNIFI_VERIFY_SSL=false`). **Untestable here** — the
  controller only exists at the shop, not in dev — so this is built against
  the documented UniFi API shape and stubbed in tests, not exercised live.
  Verify against the real controller before relying on it.
- [x] `POST /api/wifi/voucher` (kiosk-authenticated, `backend/src/routes/wifi.js`) —
  idempotent per sale `batchId` (retrying returns the same voucher, doesn't
  mint a new one), and only issues one when a real machine-payment `Sale`
  exists for that batch and `wifi.enabled` is on. A controller failure
  returns 502 without touching the sale — never lets a WiFi problem look
  like the purchase itself failed.
- [x] Admin > Definições > WiFi — on/off toggle, access duration (minutes),
  and a display-only SSID field (instructs the customer, doesn't configure
  the network). Same settings/toggle pattern as Staff & Manutenção.
- [x] Kiosk: `WifiQrModal` pops up after a wash/dry cash or card sale with a
  QR of the voucher code, the code as text, and join instructions. Silently
  does nothing if the feature is off or the controller call fails — never
  interrupts or contradicts the payment success toast.
- [x] **Fixed same-day, before this ever shipped**: the design above routed
  every voucher through the cloud backend — which meant a customer couldn't
  get WiFi at exactly the moment the kiosk's own internet was down, the one
  case the feature exists for. Moved voucher issuance into the local engine
  instead: `pos-client/electron/unifi-voucher.cjs` talks to the UniFi
  controller directly over the shop's LAN (DB migration v5 adds a local
  `wifi_vouchers` table for the same batchId idempotency, config lives in
  `pos-client/config.json`'s new `wifi` block). `App.jsx` tries the local
  path first and only falls back to the cloud route when the local engine
  confirms this particular sale wasn't settled locally (i.e. it really did
  go through the network gateway, which needed internet anyway). `wifi.*`
  settings reach the kiosk through the sync engine's existing generic
  settings pull — no new sync plumbing needed for that part.
- 4 new backend tests (validation + idempotency, controller call stubbed).
  Fixed a real bug in `backend/test/setup.test-helper.js` while adding
  them: `startTestDb`/`stopTestDb` weren't reentrant, so a second test file
  in the same run could silently break a previous file's DB connection —
  now guarded on `mongoose.connection.readyState`. 74 backend tests total.

---

## Round 11 — MIFARE locally, multi-item cart, and the card lifecycle offline

Requested directly: the two biggest remaining gaps from Round 8 — no local
multi-item cart, and the RFID hardware mismatch blocking card-based offline
payment and new-card sales. The RFID question was a genuine ambiguity (two
different hardware classes, flagged since Round 5); asked, and the answer was
to standardise on MIFARE, matching what the server side already assumed.

### MIFARE read/write, locally

- [x] `pos-client/electron/hardware-agent.cjs` no longer treats the RFID
  reader as a simple UID-broadcast device (`ReadlineParser` over a line
  protocol). It now does the same PC/SC pseudo-APDU exchange the server side
  (`backend/src/services/middleware.js`, Round 5) already does: Get UID,
  Load Key + General Authenticate before every block, Read/Write Binary,
  read-back verification after every write. `RfidLink` is the only listener
  on the port's `data` event, so a poll tick and an in-progress write can
  never be misread as each other — same reasoning as the ccTalk link.
  **Carries the exact same confidence caveat as the server-side original**:
  these are the standard PC/SC Part 3 commands most USB CCID contactless
  readers speak, but neither implementation has been exercised against a
  real reader. Confirm against the actual reader's datasheet before relying
  on this in production.
- [x] Unrecognised/blank/foreign cards surface as `UID:<hex>` through the
  same `rfid:card_detected` event a real card uses — flows through the
  existing "card not found" rejection with no separate code path, exactly
  mirroring the server's approach.

### Multi-item cart checkout, locally

- [x] `pos-engine.processCart(items, method, cardCode, batchId)` — the local
  equivalent of `backend/src/routes/gateways.js`'s cash/pay and card/pay:
  several machines and/or recharges in one batch, every line validated
  before any of them apply, one atomic balance delta for a card (not one
  write per line), session snapshot/restore on any failure mid-batch.
  Wired into `App.jsx`'s `handlePay` for both cash and card, alongside the
  existing single-item fast path (kept — cheaper for the common case).

### Card lifecycle, locally: buy, write, activate

- [x] `pos-engine.purchaseCard` — sells a new card fully offline. Same
  ordering the server enforces: dispense the blank card FIRST, only charge
  once it's physically out, leave it `pending_write` (unspendable) until
  written. `pos-engine.writeAndActivateCard` — writes the card at the reader
  and only flips it to `active` once the reader confirms the read-back.
  `BuyCardModal` tries both locally first, falling back to the network route
  when there isn't enough local credit or the kiosk isn't running in Electron.
- [x] **A real gap this surfaced, fixed alongside it**: a card created purely
  offline had no way to ever reach the server — `/api/sync/push/card` only
  ever updated an existing card, a sale alone doesn't create one, and the
  kiosk's local id (a random UUID) doesn't match how MongoDB IDs look, so a
  naive "create with a different id" would double up as a second row the
  next time cards sync down. Fixed by generating the eventual server id
  *locally*, in ObjectId shape (`generateObjectId()`), and having the push
  ask the server to create the document at that exact id — local and remote
  are the same row from the moment the card exists, no reconciliation
  needed. `/api/sync/push/card` also gained a narrow status-push path for
  the one transition a kiosk legitimately needs to report:
  `pending_write → active`. Deliberately not `blocked → active` or anything
  else — a compromised kiosk credential silently un-blocking a card an admin
  blocked (lost/stolen) would defeat the entire point of blocking it.
- 4 new backend tests for the create/status push paths (idempotent create,
  missing code rejected, legitimate activation accepted, reactivating a
  blocked card refused). 78 backend tests total.

### Still open

- [ ] Kiosk day-close still requires connectivity (Round 7 decision, unchanged).

---

## Round 12 — live balance display and cash-out

The two remaining polish items from Round 8/11: nothing showed the customer
their local credit as coins went in offline, and there was no way to get
unspent cash back short of spending it on another machine.

- [x] `CartModal` subscribes to the embedded hardware agent's
  `onSessionUpdate` (already emitted, never listened to before now) and
  shows the running local credit live, auto-confirming cash payment once it
  covers the cart — mirrors the UX the legacy remote-websocket
  `cashInserted` path already had, just for the offline pipeline.
- [x] `pos-engine.cashOut()` — hands back unspent cash **and** recharge
  bonus (itself cash-backed) via the hopper, explicitly leaving a loaded
  card's own balance untouched (that money is the card's, not the kiosk's to
  refund as coins). Exposed as a "Levantar troco" button next to "Cancelar"
  in `CartModal`, shown only when there's local cash to return.
- No backend changes; 78 backend tests still pass (regression check).

---

## Round 13 — business-side gaps: reporting, alerts, receipts

Not audit findings — requested directly, after being asked what's missing
from a shop-operator's point of view rather than a code-correctness one.
Scoped down deliberately: cash-only payments and wash/dry-only machines were
confirmed as intentional, not gaps, so neither was touched. Two decisions
were needed before starting (asked, not guessed): receipts stay a plain
confirmation, not a certified fiscal document (Portuguese AT/SAF-T
certification is a business/legal step with an accountant, not something to
fake in code); alerts go out by email, reusing the mailer already in the
codebase rather than standing up a new channel.

### Reporting dashboard

- [x] **The backend already had this — nothing used it.** `/admin/analytics/revenue`,
  `/admin/analytics/machines`, and `/admin/kiosks/health` were fully built,
  fully working, and called from exactly zero frontend code — `/admin` just
  redirected straight to Operações. New `AdminOverview.jsx` (now the admin
  landing page) surfaces all three: 30-day revenue (cash/card split, hand-rolled
  bars, no new chart dependency), per-machine utilization, and kiosk fleet status.
- [x] **Fixed a real bug in `kiosks/health` while surfacing it**: "online" there
  checks a websocket connection from the *legacy* standalone hardware-agent
  pipeline (see Round 8's ARCHITECTURE.md note) — an embedded/offline-first
  kiosk (this whole project's actual architecture) never opens that socket,
  so it would always show "offline" even mid-sale. The new page uses
  `lastSeen` instead (updated on every authenticated kiosk request — pulls,
  pushes — regardless of protocol) as the real, protocol-agnostic freshness
  signal, and says so in the page copy rather than silently disagreeing with
  the API's own field.

### Operator email alerts

- [x] `alerts.email` setting (Admin > Definições > Alertas) — where alerts go;
  blank disables the feature entirely, on both paths below.
- [x] **Hardware faults, pushed live.** `pos-client/electron/main.cjs` wires
  the embedded hardware agent's `hopper:fault`/`hopper:empty`/`hardware:error`/
  `hardware:disconnected` events to `sync-engine.cjs`'s new `pushAlert()`,
  which reaches the new `POST /pos/alert` (kiosk-authenticated) only while
  online. Dropped, not queued, when offline — by the time a queued alert
  would reach the server it's almost always stale (staff already noticed, or
  the next sale surfaces it anyway).
- [x] **Kiosk gone quiet, checked periodically.** `services/kioskWatchdog.js`
  scans kiosk `User.lastSeen` every 5 minutes; anything stale past 15 minutes
  gets one email, not one per check — `User.offlineAlertSent` tracks that and
  clears the moment the kiosk is seen again.

### Customer receipts

- [x] `POST /pos/receipt` — emails a plain confirmation (items, total, date)
  for a sale batch. Explicitly not a fiscal document; the code says so.
- [x] **The kiosk already had a thermal printer wired end-to-end
  (`hardwareAgent.printReceipt` → `posEngine.printReceipt` → `hw:printReceipt`
  IPC → `preload.cjs`) with zero frontend usage — same pattern as the
  analytics routes above.** `ReceiptPrompt` now offers both: print (purely
  local hardware, no server round trip, so it works on the Round 11/12
  local-engine fast paths too, not just network-settled sales) and email
  (needs the sale to already exist server-side, so network-settled only —
  the receipt route looks it up by batch). `src/lib/receipt.js` formats the
  same plain-text body either way, so the printed and emailed versions read
  identically. Also backfilled `tryShowWifiVoucher` onto the one local
  single-item cash success path that had been missing it since Round 11.
- [x] `ReceiptPrompt` — a small dismissible corner card, not a modal (most
  customers won't want to stop and type an email for a €3 wash).

10 new backend tests (alert push validation, watchdog stale/recovery/never-seen
behaviour, receipt validation + send). 88 backend tests total — the printer
wiring itself is local-hardware-only and untestable here, same caveat as
every other serial peripheral in this project without a real device to test
against.

### A test-suite fix that unblocks adding more test files

- [x] **`/api/auth/login`'s rate limit (6/15min, process-wide) was already
  right at the edge before this round** — every test file that wanted "an
  authenticated token" was hitting the real HTTP login route to get one, and
  the limiter is a module-level singleton shared across the *entire*
  `npm test` run, not per-file. Adding one more file's one more login (this
  round's `alerts.test.js`) tipped it over into a 429 → cascading 401s
  across unrelated tests, the same failure mode already patched once in
  Round 10's wifi.test.js fix. Fixed properly this time: `signToken(user)` in
  `setup.test-helper.js` mints a token directly (mirrors `auth.js`'s own
  `jwt.sign` call) for every call site that doesn't actually test the login
  route itself. Only the tests that genuinely exercise login/wrong-password/
  apiKey-login still make a real HTTP call — 3 total, well under the cap,
  with real headroom for future test files.

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
8. **Confirm the RFID reader's exact command set against its datasheet before
   going live** — see the confidence note in Round 5. This is the one piece of
   hardware work in this project that has not been exercised against a real or
   simulated device, unlike the ccTalk stack (verified over a real PTY).
9. **New indexes build on first boot.** The unique one on `{tenantId, interfaceId, port}` will
   FAIL to build if duplicates already exist. Check before deploying:
   ```
   db.machines.aggregate([{$match:{interfaceId:{$ne:null},port:{$ne:null}}},{$group:{_id:{t:'$tenantId',i:'$interfaceId',p:'$port'},n:{$sum:1}}},{$match:{n:{$gt:1}}}])
   ```
   Anything returned is two machines wired to one physical port — fix the data first.
10. **Set the staff PIN** in Admin → Definições → Staff & Manutenção before relying
    on manual payment, admin-start-machine, kiosk day-close, or the maintenance
    lock — every one of them fails closed with no PIN configured, by design.
    Turn on the maintenance-lock toggle there too if you want it available.
11. **The kiosk now needs the frontend's build output present on disk, not
    just reachable over the network — but it is a DIFFERENT build from the
    one deployed to the web server.** Run `npm run build:electron` at the
    repo root (not plain `npm run build` — see Round 9, that one is `base: '/'`
    and silently breaks under `file://` past the very first paint) and copy
    the resulting `dist-electron/` folder so it sits as a sibling of
    `pos-client/` on the actual kiosk machine (`LOCAL_UI_PATH` in `main.cjs`
    resolves to `<repo root>/dist-electron/index.html`). This is a new deploy
    step, not an update to an existing one — previous kiosk builds never
    needed either `dist/` folder at all, since they loaded the UI from
    `https://washbubbles.app` directly. A kiosk missing this folder boots to
    a "não encontrada" error screen instead of the POS UI, online or not.
    Rebuild and redeploy `dist-electron/` (never plain `dist/`) to every
    kiosk on every frontend release from now on. The web server keeps
    deploying `dist/` from plain `npm run build`, exactly as before.
12. **Kiosk DB migrates to v4 automatically** on first launch of this build
    (adds `cards.status`). One-way, like the v3 migration above — take a
    copy of `washbubbles.db` first if you want to be able to roll back.
13. **Set `UNIFI_HOST`/`UNIFI_USERNAME`/`UNIFI_PASSWORD` (and `UNIFI_BASE_PATH`
    if it's a UDM/UniFi OS console)** in `backend/.env` before turning the
    WiFi-voucher toggle on in Admin > Definições — see the new block in
    `backend/.env.example`. The feature fails closed (502, sale unaffected)
    with no controller configured, but stays visibly broken until this is
    set.
14. **Set `MAIL_HOST`/`MAIL_PORT`/`MAIL_USER`/`MAIL_PASS`/`MAIL_FROM`** in
    `backend/.env` for operator alerts and customer receipts to actually send
    anything — without it, both features run (no errors) but every "email"
    just gets logged to the server console instead of delivered. Then set
    `alerts.email` in Admin > Definições > Alertas to whoever should receive
    hardware-fault and kiosk-offline notices.

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
