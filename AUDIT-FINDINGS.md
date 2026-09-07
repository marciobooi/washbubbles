# WashBubbles — Audit Findings & TODO

Full A-to-Z audit of backend, admin dashboard, kiosk (pos-client) and frontend.
Ordered by severity. Work top-down.

**Legend:** `[x]` fixed & verified · `[~]` partly fixed · `[ ]` outstanding · `[?]` needs a product decision before fixing

**Verification note:** items marked **(verified)** were confirmed by reading the code directly.
Unmarked items came from an automated sweep and should be confirmed while fixing — the
line numbers are a starting point, not gospel.

---

## P0 — Money taken, nothing delivered

These are the worst class of bug here: the customer pays, the system reports success,
and the physical thing never happens. All silent.

- [ ] **Machine activation never reaches the hardware.** `backend/src/services/middleware.js:987-1017`
  — `sendMachineActivation()` builds the command buffer, logs `"Activation pulse sent"`, and
  returns it **without ever writing to the serial port**. `coinMachine.js:550` then marks the
  machine `working` and saves. Customer pays, credits deducted, UI shows running, washer never starts.
- [ ] **Two methods named `send` in the same class.** `backend/src/services/middleware.js:600` and `:1065`
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
- [ ] **Hopper jam reports success.** `backend/src/services/middleware.js:816,827-847` — the dispense
  timeout resolves `null` and the code proceeds as if it worked. `dispenseChange:766` also loops
  denominations: a throw on the 2nd leaves the 1st already dispensed, and `pos.js:145,290` swallow
  the error and return 200. Customer gets partial change; a retry double-dispenses. Neither path
  decrements `hopperConfig.currentStock` or `dayClose.totalChangeDispensed`.
- [?] **autoCharge double-credits every coin.** `backend/src/services/coinMachine.js:266-269` +
  `client.js:84-111` — `handleCoinInserted` pushes the value into `chargedArr` *and* calls
  `addToBalance()`. The cash is immediately spendable, and on card removal the same amount is
  added to the card in the DB. Insert €5 → €5 spendable **and** €5 on the card. House loses the
  difference on every insertion. *Needs your call on intended behaviour: should inserted cash go
  to the session, to the card, or to the card only on removal?*
- [?] **Cash-mode payment debits the card in memory only.** `backend/src/services/client.js:161-168`
  + `coinMachine.js:398-418` — `deductCredits` always drains `balanceCard` first, but the
  `saveCardBalance()` call is skipped when `paymentType === 'cash'`. `resetCardInfo` (`client.js:61`)
  then zeroes the in-memory balance without ever saving. Card keeps its original DB balance →
  unlimited free washes. *Needs your call: should cash-mode ever touch the card balance at all?*
- [ ] **The hopper is never told *which* coin to pay out.** **(verified)**
  `backend/src/services/middleware.js:778-822` — the ccTalk dispense frame is
  `[addr, len, src, 167, count, chk]`; `denomination` is used only in the `console.log`.
  `dispenseChange` loops the breakdown and fires four separate "dispense N coins" commands at the
  *same* address, so the hopper pays N coins of whatever it physically holds. €3.70 of change
  (1×2.00 + 1×1.00 + 1×0.50 + 1×0.20) becomes 4 coins: €2.00 from a 50c hopper, €8.00 from a €2
  hopper. **Every payout is wrong, in either direction, by an unbounded amount.**
  **Fix:** one hopper = one denomination; address each hopper separately from the peripheral config
  (see the `parseInt(address)` bug below), or drop multi-denomination change entirely.
- [ ] **No serial framing on peripheral data — coins lost, phantom €20 bills credited.** **(verified)**
  `middleware.js:291-331,539-595` — `port.on('data')` hands the raw chunk to `handleCoinData`, which
  reads only `data[0]`. Serial chunk boundaries are arbitrary: two coins arriving in one chunk credit
  **one** coin (customer loses money); a reply split across chunks makes a mid-frame byte the "coin
  code" — `0x03` reads as €0.05, or in `parseBillValue` as **€20.00 of free credit**. And because a
  real ccTalk reply is `[dest,len,src,cmd,…]`, `data[0]` is an address byte and never a coin code, so
  every ACK also fires a spurious `coin-rejected`/`bill-rejected`.
  **Fix:** accumulate into a buffer and parse whole ccTalk frames (length byte + checksum), the way
  `hardware-agent.cjs`'s `CcTalkLink` already does. Port that class here.
- [ ] **`writeCardData` claims success without writing — and bricks the card.** **(verified)**
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
- [ ] **Rate limiting only exists on `/auth/login`.** Unlimited: `/auth/forgot-password` (mail bomb,
  user enumeration), `/auth/reset-password` (64-hex token brute force), `pos.js:439` and
  `gateways.js:12` (card balance lookup by code — the kiosk apiKey sits on a public terminal).
- [ ] **Kiosk renderer runs remote content with `unsafe-inline`/`unsafe-eval`.**
  `pos-client/electron/main.cjs:74` — combined with the unvalidated IPC money handlers below, one
  XSS on the loaded origin owns the till.
- [ ] **No IPC validation on money handlers.** `pos-client/electron/ipc-handlers.cjs:12,22,33` forward
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
- [ ] **Stub connectors report `ok`, then silently "dispense".** **(verified)**
  `middleware.js:134-160,621-645` — `connectPulse`/`connectUSB`/`connectEthernet` are placeholders
  that set peripheral status to `ok` without touching hardware. A pulse card dispenser therefore has
  no `.port`, so `sendCardDispenserPulseCommand` returns at `:681` and `dispenseCard` emits
  `card-dispensed` + `{success:true}` (`:643`). Customer is charged, no card comes out, dashboard is
  all green. **Fix:** make the stubs throw / report `error`, so the peripheral shows as down.
- [ ] **A dropped serial port wedges the peripheral until process restart.** **(verified)**
  `middleware.js:113-125` + `:50` — `port.on('close')` sets status `offline` but leaves the entry in
  `this.connections`, so any later `connect()` short-circuits at `:50` with "already connected".
  A USB replug needs a restart, and `send()` meanwhile writes to a dead port. **Fix:** delete the
  connection entry on close and add backoff reconnect.
- [ ] **`print` is the same silent-success class.** **(verified)** `middleware.js:894-902` —
  `if (connection.port)` gates the whole write loop, then `receipt-printed` + `{success:true}` fire
  regardless. No ACK, no paper check.
- [ ] **`waitForResponse` has no request/response correlation.** **(verified)**
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
- [ ] **`/admin/kiosks/:id/command` never verifies the kiosk belongs to the caller's tenant.**
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

- [~] **No money rounding anywhere.** **(partly fixed — `utils/money.js` added and used on every route; `services/client.js` and `coinMachine.js` still do raw float math)** There is no `roundMoney` helper in the backend at all (the
  kiosk has one). `client.js:117,167,179,211` and `coinMachine.js:260,293` do raw float math —
  five €1 coins + 10% bonus → `5.500000000000001`; a €5 target can land at `4.999999999` and
  `processPayment:408` then throws "Insufficient credits" on an exact payment. `client.js:167` can
  leave a balance slightly negative.
- [ ] **Settings/cards/machines loaded without a tenant filter in the coin machine.**
  `coinMachine.js:87-91` (`Setting.findOne({key})` on a singleton returns an arbitrary tenant's row —
  tenant A's bonus applied to tenant B's coins), `client.js:96,128`, and every
  `Machine.findOne({intId})` at `coinMachine.js:581,607,634,663` (tenant B's machine started by
  tenant A's payment).
- [ ] **`broadcastHardwareEvent` called with 2 args in coinMachine.** `coinMachine.js:216,227,236,245`
  — signature is `(tenantId, type, payload)`. Fraud and hopper-empty alerts reach nobody. (Same bug
  already fixed in `index.js`; this file was missed.)
- [ ] **One dropped status bit wipes a paid session.** `coinMachine.js:760-768` — a `working` machine
  reporting `doorClosed && !occupied` for a single status packet is reset to `free` with
  `currentProgram`/`reservedBy` cleared, freeing it for someone else mid-cycle.
- [ ] **Cancelled reservations are never cleared.** `middleware.js:1102` emits `machine-res-canceled`;
  nothing listens. The machine stays `reserved` forever and is unbookable, yet `activateMachine:519`
  will still activate it.
- [ ] **Event shape mismatches.** `middleware.js:328,344` emit `{peripheral, signal}` but
  `coinMachine.js:212,222` destructure `{reason, fraud}` → `fraud` is always undefined, so
  `peripheral:fraud` never fires from the serial path. `middleware.js:524` emits `hopper-event` with
  no listener.
- [ ] **Missing hot-path indexes.** `machine.intId` and `{interfaceId, port}` (collection scan on
  every status packet — `coinMachine.js:735,798`); `card.code` alone isn't a usable prefix of
  `{tenantId, code}`, so every card read is a collection scan.
- [~] **Listener/interval leaks on a long-running kiosk.** **(kiosk autosave interval fixed; `local-api.js` still leaks)** `src/services/local-api.js:114-147`
  registers `ipcRenderer.on` per subscribe and returns a no-op cleanup (the code comments admit it);
  `database.cjs:94` autosave interval is never stored or cleared.
- [ ] **26 empty `catch {}` blocks in the frontend** swallow errors with no logging (mostly
  non-critical UI side effects, but they mask real failures too).
- [ ] **KITSEC frame parsing matches ETX inside the payload and never checks the checksum.**
  **(verified)** `middleware.js:199-204` — `buffer.indexOf(0x03, stxIndex)` finds the first `0x03`
  *anywhere*, including the `port` and `statusByte` fields. Port 3, or `statusByte === 0x03`
  (`doorClosed|occupied` — the normal running state), truncates the frame to 4 bytes, which `:243`
  then drops silently while `:204` consumes past it and desyncs the stream. `handleInterfaceData`
  also never verifies the trailing checksum, so one noise-corrupted byte can report `fault` or
  `occupied` on the wrong port. Machines on low-numbered ports never update status; phantom faults
  appear at random. **Fix:** use the length field, not an ETX scan, and verify the checksum.
- [ ] **Serial ports are only opened on Windows.** **(verified)** `middleware.js:175` —
  `iface.address.startsWith('COM')`. On Linux/macOS (`/dev/ttyUSB0`) no port is opened, yet
  `:223-228` still register the interface with `connected: true`. Every activation is a silent no-op.
  Matters directly: the Hetzner box is Linux.
- [ ] **`parseInt(peripheral.address)` is always `NaN`.** **(verified)** `middleware.js:653,786` —
  `address` holds the port path (it is used as `path` at `:94`), so the ccTalk device address
  silently falls back to the hardcoded 3/4 — the wrong device on a multi-drop bus. Needs a separate
  `deviceAddress` field on the peripheral (and in the admin UI).
- [ ] **`disconnectAll` never iterates `this.interfaces`.** **(verified)** `middleware.js:934-938` —
  interface ports stay open across shutdown, so a restart hits a busy port.
- [ ] **`buildInterfaceCommand` byte order and types are wrong.** **(verified)**
  `middleware.js:1023-1058` — the comment says little-endian, the code writes the high byte first;
  `cmd.address` is a string (`'COM3'`) so `Buffer.from` coerces it to 0; undefined `tOn`/`tOff`
  become 0. Latent only because the write is missing (P0 item 1) — fix both together.

## P2 — Missing / dead flows

- [?] **Change is never dispensed from the kiosk UI.** `dispenseChange` is fully implemented and
  exposed over IPC (`preload.cjs:28`) but **nothing in `src/` ever calls it**. Change is computed and
  recorded on the sale; the hopper is never triggered. *Decision needed: wire it into the checkout
  flow, or is change handled manually?*
- [?] **`CashModal` can never open.** `src/components/CartModal.jsx:214` — `setShowCash(true)` only
  happens in `openCashModal()`, which nothing calls. The whole manual cash-payment modal is
  unreachable; payment works only via hardware-driven paths.
- [?] **The "Pagar com Cartão" prompt can never open.** `CartModal.jsx:158` — `setShowCardPrompt(true)`
  only happens in `handleCardPay()`, which nothing calls. Only the automatic RFID path works.
  *Decision needed on both: add manual buttons as a hardware-failure fallback, or delete?*
- [ ] **`CardModal`'s change display is unreachable.** `src/components/CardModal.jsx:79` —
  `handleInsertMoney()` is never called, so `insertedMoney`/`showChange` never change and the
  "Troco" block at `:194` is dead.
- [ ] **`CardModal`'s `onRecharge` prop is dead.** Destructured at `:22`, never used; `Pos.jsx:142`
  passes `handleRecharge` expecting it to fire. The cart-based flow superseded it.
- [ ] **`Machines.jsx` `pay()` calls an undeclared `closeModal()`.** `src/pages/Machines.jsx:141` —
  would throw `ReferenceError` if ever invoked. Currently dead (nothing calls `pay()`), alongside the
  dead `handleAddToCart` wrapper at `:118`.
- [ ] **`AdminUsers.jsx` `resetForm()` is never called** — the Cancel button uses an inline handler.
- [ ] **`AdminPrices.jsx` duplicates the coin/bill settings UI** that also exists in `AdminSettings.jsx`,
  writing to the same keys from two pages. (The `AdminSettings` copy has been removed; `AdminPrices`
  is now the single home.)

## P3 — Dead code & unused dependencies

- [ ] `backend/tmp-upload-test.js`, `backend/tmp-upload-bad.js` — leftover scratch files, zero references.
- [ ] `src/services/local-api.js` — nothing imports it, and it's stale: it destructures
  `getPublicMachines` from `api.js`, which isn't exported there.
- [ ] `src/components/version-switcher.jsx` — zero references repo-wide.
- [ ] `src/hooks/useMachineStatus.js` — no page or component imports it.
- [ ] `src/components/ui/dialog.jsx` — unused shadcn Radix dialog; `Modal.jsx` is the one actually
  used (9 files). Removing it also frees `@radix-ui/react-dialog`.
- [ ] Unused `api.js` exports: `register`, `getUser`, `rotateUserKey`, `getTransaction`,
  `deleteTransaction`, `getInterface`, `getPeripheral`, `deletePeripheral`, `getMiddlewareClient`,
  `getMiddlewareMachines`, `getMiddlewareMachine`.
- [ ] Unused deps — root: `autoprefixer`, `postcss` (no postcss config; Tailwind v4 runs via
  `@tailwindcss/vite`), `@radix-ui/react-dialog` (once dialog.jsx goes). backend: `sonner` (a React
  toast library in a Node package).
- [ ] `virtual-serial-server` imports `@serialport/binding-mock` but **doesn't declare it** — it only
  resolves as a transitive of `serialport`. Add it before deploying.
- [ ] Unused assets: `public/geral/login.jpg` (carousel uses `/login/1..6.jpg`),
  `public/geral/freshbubbleslogo.png`. *Verify against the branding settings row first — that path
  is dynamic.*
- [ ] **Tailwind config may be inert.** `tailwind.config.cjs` is v3-style but `src/index.css` uses
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
