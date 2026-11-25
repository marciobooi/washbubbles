# pos-client — kiosk POS client (Electron)

This is the kiosk app that customers use. The washbubbles root `../CLAUDE.md` loads automatically and applies here: cash-close accounting rules, admin/machine control checks, production safety and the Kiosk section.

Kiosk-specific:
- Live customers use this app. Say before shipping anything that locks, restarts or stops it, and verify pay, start-cycle and day-close end to end after a change.
- Day close: counted cash only, no card-balance usage, nothing uncounted carried forward. Cross-check totals against the raw records.
- Fixes here often have a twin in `../src` or `../backend`; check both sides.
- Don't change `config.json` values (hardware, keys, URLs) unless asked; `config.example.json` is the template.
- Commits: no attribution lines.
- Delegation and token rules (agents, short outputs, no whole-file reads) are in `../CLAUDE.md`.
