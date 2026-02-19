# Virtual Serial Server (local mock)

Standalone mock server to emulate serial peripherals for local testing with com0com pairs.

Features
- Opens multiple COM ports (default COM10..COM14)
- WebSocket control API (emit device events, write raw bytes)
- Helpers for RFID, KITSEC interface status, ccTalk coin/hopper responses, card dispenser ack
- Non-invasive — lives in `virtual-serial-server/` and can be deleted anytime

Quick start
1. Create paired virtual COM ports with com0com (e.g. COM10 <-> COM11, COM12 <-> COM13, ...).
2. In one terminal run your real agent that expects one end of the pair (e.g. HardwareAgent on COM11).
3. Start this mock server to open the other end (e.g. COM10):

   npm --prefix virtual-serial-server install
   npm --prefix virtual-serial-server start

Configuration
- Use `MOCK_PORTS` env or `--ports=COM10,COM11` CLI to override default ports.
- Use `MOCK_MAPPING` or `--mapping=COM10=rfid_reader,COM11=coin_acceptor` to change logical types.
- Control ports default: `ws://localhost:4002` and `ws://localhost:4067` (server will try ports in order). Set `VSS_CONTROL_PORT` or `VSS_CONTROL_PORTS` (comma-separated) to override.

Control (WebSocket)
- Connect with `wscat -c ws://localhost:4002` or any WebSocket client.
- Send JSON messages (examples):
  - {"action":"list"}
  - {"action":"emit","event":"rfid","port":"COM10","payload":{"card":"12345678"}}
  - {"action":"emit","event":"coin:credit","port":"COM11","payload":{"coinCode":5}}
  - {"action":"write","port":"COM12","data":"hex:02005301f403"}

Notes
- This server writes raw bytes to the configured COM ports — pair the ports with your agent using com0com.
- It's intentionally minimal; extend the helper functions in `index.js` to match any additional protocol details you need.

License: MIT (for local dev/test use)
