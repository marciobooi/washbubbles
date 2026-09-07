import mongoose from 'mongoose'

const peripheralSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  name: { type: String, required: true },
  type: { 
    type: String, 
    required: true,
    enum: ['bill_acceptor', 'card_dispenser', 'coin_acceptor', 'hopper', 'printer', 'rfid_reader']
  },
  enabled: { type: Boolean, default: true },
  protocol: { 
    type: String,
    enum: ['rs232', 'pulse', 'cctalk', 'MDB', 'usb', 'ethernet'],
    default: 'pulse'
  },
  // Serial port path, e.g. 'COM3' or '/dev/ttyUSB0'.
  address: { type: String, default: '' },
  /**
   * ccTalk bus address of the device itself (1-255), separate from the port path.
   *
   * `middleware.js` used to do `parseInt(peripheral.address)`, which is always
   * NaN for a path like 'COM3' or '/dev/ttyUSB0' and silently fell back to a
   * hardcoded 3 or 4 — the wrong device on a multi-drop bus.
   */
  deviceAddress: { type: Number, default: null, min: 1, max: 255 },
  baudRate: { type: String, default: '' },
  brand: { type: String, default: '' },
  model: { type: String, default: '' },
  serialNumber: { type: String, default: '' },
  status: {
    type: String,
    enum: ['ok', 'fault', 'offline', 'unknown'],
    default: 'unknown'
  },
  image: { type: String, default: '' },
  
  // Hopper-specific configuration
  hopperConfig: {
    /**
     * The single coin denomination THIS hopper pays out, in euros.
     *
     * A ccTalk payout hopper holds one coin type — its dispense command carries
     * only a coin *count*, never a value. The old code looped a list of
     * denominations against one address, so a request for "1×€2, 1×€1, 1×€0.50"
     * became three "dispense 1 coin" commands to the same hopper and the customer
     * got three of whatever it happened to hold. Fit more denominations by adding
     * more hopper peripherals, each with its own coinValue and deviceAddress.
     */
    coinValue: { type: Number, default: null },
    // Retained for existing records; `coinValue` is what the dispense logic uses.
    coinDenominations: {
      type: [Number],
      default: [2.00, 1.00, 0.50, 0.20, 0.10, 0.05] // Euro coins
    },
    maxStock: { type: Number, default: 500 }, // Maximum coins this hopper holds
    /** Coins currently loaded. Decremented as change is paid out. */
    currentCount: { type: Number, default: 0 },
    /** Refuse to dispense more than this in one payout — anti-drain guard. */
    maxDispenseCoins: { type: Number, default: 50 },
    currentStock: {
      type: Map,
      of: Number,
      default: {} // legacy per-denomination map, kept for old records
    }
  }
}, { timestamps: true })

// Per-tenant lookups
peripheralSchema.index({ tenantId: 1, type: 1 })

export default mongoose.model('Peripheral', peripheralSchema)
