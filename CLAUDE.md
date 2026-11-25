# washbubbles — laundry kiosk, admin dashboard and server

Rules below come from corrections made in past sessions (usage report 2026-11-25). Edit them if a rule is wrong.

## Cash-close accounting
- Count only cash actually received. Do NOT include card-balance / credit usage in cash totals.
- Never carry an uncounted or estimated balance forward. Only the confirmed counted amount carries over.
- Admin cycle counts must include every cycle from the source of truth; cross-check totals against the raw records before reporting (past bug: 62 shown, 255 real).
- Before changing cash-close code: write the formula in plain words, compute one real day by hand, show it next to the code's output, and wait for the OK.
- Prefer tests built from real days (anonymised fixtures) so each correction becomes a regression test.

## Admin and machine controls
- After any refactor of admin controls, check each control's handler end to end (stop, start, send impulse, add cycle) before saying nothing broke; use `git diff` on the refactor commit, not memory.
- A new control must be visible in every state it applies to (e.g. the add-cycles button on busy AND idle machines).

## Charts and UI
- Verify chart and layout fixes in the browser: inspect the rendered DOM, scroll the page, and check that sticky navs, sliders and footers do not overlap or cut content.
- The server build did not see chart areas wrapped in a React Fragment; keep chart series as direct children (see commit 547246c2) and check that every area renders.

## Kiosk
- Kiosk code: `src/components/KioskDayCloseModal.jsx` (day close = the cash-close above), `KioskLockOverlay.jsx`, `src/context/KioskLockContext.jsx`, `src/lib/kioskContext.js`, `pos-client/` (Electron POS client), `scripts/kiosk-update*.ps1` and `kiosk-watch.ps1` (updates), `start-kiosk.bat`, tests in `backend/test/kiosk*.test.js`.
- The kiosk is used by real customers. Don't ship changes that lock, restart or stop it without saying so first, and verify each customer-facing flow (pay, start cycle, day close) end to end after a change.
- Day close follows the cash-close rules above: counted cash only, no card balance, nothing uncounted carried forward.
- Kiosk updates: after running an update script, confirm the kiosk runs the expected commit and report anything that differs.
- Kiosk and server bugs often share code: when fixing one, check the other side (`pos-client/` and `backend/`) for the same problem.

## Production
- Never load-test production services (e.g. the LibreTranslate translator) without permission; use local or staging.
- Before deploying, compare the deployed commit with local HEAD and report any unrequested differences.
- Commits: no attribution lines.

## Delegation and tokens
- Agents in `.claude/agents/`: `ui-verifier` (loads a page, checks the rendered DOM and layout, returns pass/fail) and `cash-auditor` (recomputes a day's totals from raw records and compares with what the code shows). Use them after chart/UI changes and any cash-close change.
- Wide searches (a pattern across `src`, `backend`, `pos-client`) go to an Explore/sweep agent; only the summary comes back. One writer per set of files.
- `node_modules`, `dist`, `dist-electron`, `backups` and `package-lock.json` are never read. `grep -n` first, then read a line range.
- Browser checks: `javascript_tool` / `get_page_text` first; screenshot only as final proof.

## Long sessions
- When this session gets long or the next task is different, use `/new-chat` (global skill) to write `.claude/handoff.md` and continue in a fresh chat; see `~/.claude/CLAUDE.md`. Keep `.claude/handoff.md` out of commits.
