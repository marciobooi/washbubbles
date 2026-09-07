/**
 * KITSEC machine-interface framing.
 *
 * Frame: [STX][CMD][PORT][LEN][...payload][ETX][CHK]
 *
 * The old parser searched for the first 0x03 byte after STX and called that the
 * end of the frame. 0x03 is a perfectly ordinary payload value: port 3, or a
 * status byte of 0x03 (doorClosed|occupied — a machine running normally) both
 * truncated the frame to 4 bytes, which was then dropped silently while the
 * reader consumed past the real ETX and desynchronised the stream. Machines on
 * low-numbered ports never updated, and phantom faults appeared at random.
 *
 * Framing is driven by the length byte, and the checksum is verified, so a
 * corrupted byte is discarded instead of reported as a fault on the wrong port.
 */
export const STX = 0x02
export const ETX = 0x03

export const KITSEC_CMD = {
  STATUS: 0x53, // 'S'
  ERROR: 0x45,  // 'E'
  ACTIVATE: 0x41, // 'A'
}

/** XOR of every byte between STX and ETX exclusive — the documented check. */
export function kitsecChecksum(bytes) {
  return bytes.reduce((a, b) => a ^ b, 0) & 0xFF
}

export function kitsecFrame(cmd, port, payload = []) {
  const body = [cmd, port, payload.length, ...payload]
  return Buffer.from([STX, ...body, ETX, kitsecChecksum(body)])
}

/**
 * Pull one complete frame off the front of `buf`.
 *
 * @returns {{frame: object|null, rest: Buffer, resync?: boolean}}
 *   `resync` signals that a malformed frame was skipped — call again.
 */
export function readKitsecFrame(buf) {
  const stx = buf.indexOf(STX)
  if (stx === -1) return { frame: null, rest: Buffer.alloc(0) }
  if (stx > 0) return { frame: null, rest: buf.slice(stx), resync: true }

  // Need at least STX CMD PORT LEN ETX CHK
  if (buf.length < 6) return { frame: null, rest: buf }

  const cmd = buf[1]
  const port = buf[2]
  const len = buf[3]
  const total = 4 + len + 2 // header + payload + ETX + checksum
  if (buf.length < total) return { frame: null, rest: buf }

  if (buf[total - 2] !== ETX) {
    // Length byte disagrees with where ETX actually is — not a valid frame.
    return { frame: null, rest: buf.slice(1), resync: true }
  }

  const payload = buf.slice(4, 4 + len)
  const body = [cmd, port, len, ...payload]
  if (kitsecChecksum(body) !== buf[total - 1]) {
    return { frame: null, rest: buf.slice(1), resync: true }
  }

  return { frame: { cmd, port, payload }, rest: buf.slice(total) }
}

/** Decode the status bitfield carried by a STATUS frame. */
export function parseStatusByte(statusByte) {
  return {
    doorClosed: !!(statusByte & 0x01),
    occupied: !!(statusByte & 0x02),
    fault: !!(statusByte & 0x04),
    reserved: !!(statusByte & 0x08),
    heatingUp: !!(statusByte & 0x10),
    doorLocked: !!(statusByte & 0x20),
  }
}

export default { STX, ETX, KITSEC_CMD, kitsecChecksum, kitsecFrame, readKitsecFrame, parseStatusByte }
