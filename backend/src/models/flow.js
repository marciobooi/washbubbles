import mongoose from 'mongoose'

const { Schema } = mongoose

/**
 * One customer action, from the first step to the last, as ONE record: selected the machine, put in money, paid, change, impulse sent
 * to the machine... Written by services/flows.js on the shop PC while it happens, sent to the central server when it is over, and shown
 * in the admin's Auditoria ("Fluxos"), where a row expands into its steps.
 */
const stepSchema = new Schema({
  at: { type: Date, required: true },
  type: { type: String, required: true },           // 'cash_in', 'pay_requested', 'impulse_sent', 'change_paid', ...
  text: { type: String, default: '' },              // what a person reads in the timeline
  ok: { type: Boolean, default: true },             // false = a problem step (shown in red)
  data: { type: Schema.Types.Mixed, default: null },
}, { _id: false })

const flowSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  flowId: { type: String, required: true },
  // machine_payment | card_purchase | recharge | mbway | refund | card | admin | other  (decided by what happened in it)
  kind: { type: String, default: 'other' },
  status: { type: String, enum: ['open', 'done', 'problem', 'interrupted'], default: 'open' },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date, default: null },
  lastAt: { type: Date, required: true },
  // What the list shows without opening the flow
  title: { type: String, default: '' },
  machines: { type: [String], default: [] },
  cardCode: { type: String, default: '' },          // the card's last 4 digits only
  method: { type: String, default: '' },            // cash | card | mbway
  amount: { type: Number, default: 0 },             // what was paid for
  inserted: { type: Number, default: 0 },           // cash put in
  change: { type: Number, default: 0 },             // change paid out
  problems: { type: Number, default: 0 },          // real problems only (see utils/flowSeverity.js)
  warnings: { type: Number, default: 0 },          // orange: cancelled MB WAY, refused coin, change retry
  steps: { type: [stepSchema], default: [] },
  createdAt: { type: Date, default: Date.now },
})

flowSchema.index({ tenantId: 1, flowId: 1 }, { unique: true })
flowSchema.index({ tenantId: 1, startedAt: -1 })
flowSchema.index({ tenantId: 1, status: 1, lastAt: 1 })

export default mongoose.model('Flow', flowSchema)
