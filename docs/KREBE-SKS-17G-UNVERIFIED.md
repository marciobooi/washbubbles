# Krebe SKS-17 G (2014) — signal list received 2026-10-09 — **UNVERIFIED**

> **Status: not a manufacturer document.** It was pasted by the owner from an AI chat answer. A web search found no public manual for
> the SKS-16-G / SKS-17-G, and several points do not fit how this shop is wired (see "Why it is doubtful"). **Nothing below is
> used by the app.** It is kept as a list of things to *look for* when the PC is on (`docs/GO-LIVE-TESTS.md` §5b): a code only
> counts once it has been seen on the wire from a real machine.

## Why it is doubtful

- **The shop does not talk Modbus to the machines.** The app talks to a low-level controller (`192.168.2.201:16852`, JSON), which
  switches each machine through a KITSEC interface board and reads back **two channel bits per board** (`status_int`). There are
  no Modbus registers (40001, 40101 …) for our app to read or write, unless the controller exposes them, which is unknown.
- The addresses are described as "standard industrial memory addresses", i.e. generic, not taken from a Krebe document.
- It assumes a **gas dryer** (ignition, gas type, burner). **Confirmed by the owner: the dryers here are gas-fired**, so ignition, gas and overheating faults are real things to look for. The codes and numbers listed here are still unverified.
- The text itself says the platform is "frequently based on classic OEM microprocessors" — a guess, not a fact.
- The machines are of different models and years (SKS-16-G 2015, SKS-17-G 2014, …); one list for "the dryer" cannot be right for all.

## What it claims (to check, not to trust)

### Error codes

| Code | Meaning claimed |
|---|---|
| E01 | Door open / latch fault (door or lint-drawer microswitch) |
| E02 | Airflow fault (exhaust pressure switch; blocked filter or fan) |
| E03 | Drum overheating (mechanical safety thermostat tripped) |
| E04 | No rotation (Hall sensor; belt or motor) |
| E05 | Inlet-air NTC probe fault |
| E06 | Exhaust-air NTC probe fault |
| E11 | Heating fault (temperature did not rise) |
| E15 | Drying time limit exceeded |
| E20 | Gas configuration error |
| E25 | Internal communication fault (display board / power board) |
| E26 | Invalid inverter feedback |
| E27 | Inverter communication lost (RS-485/CAN) |
| E28 | Motor start time-out |
| E32 | EEPROM data loss |
| E33 | Real-time clock fault |
| E99 / IGN | Ignition / gas fault (3 failed ignitions) |

### Machine state (0 to 5)

0 idle · 1 running · 2 cool-down · 3 pause (door opened or paused) · 4 unloading / anti-wrinkle · 5 alarm (stopped by an error)

### Registers claimed (Modbus)

| Address | Content | Access |
|---|---|---|
| 40001 | Current state (0–5) | read |
| 40002 | Active alarm code (0 = none) | read |
| 40003 | Air temperature, ×10 (652 = 65.2 °C) | read |
| 40004 | Remaining cycle time, seconds | read |
| 40005 | Residual humidity 0–100 % (if a sensor is fitted) | read |
| 40010 | Selected program (1–20) | read/write |
| 40101 | Remote command: 1 start · 2 pause · 4 reset alarm | write |

## How to use it later

1. With the PC on and `LOWLEVEL_TRACE=true`, record a full cycle on a dryer (and a washer) — see §5b of the go-live list.
2. Compare what the controller really reports (the `status_int` bits, `machine-issue`, `machine-started`, `door-opened`, any unknown `op`)
   with the states above: does a "pause" appear when the door opens? does an "alarm" appear when the interface goes offline?
3. Ask Krebe-Tippo (Maribor, Slovenia) or the Portuguese distributor for the real interface description of each model, and replace this
   file with it.
4. Only signals that were **seen** go into the app (admin screen, kiosk, alerts).
