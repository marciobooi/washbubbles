import mongoose from 'mongoose'

const { Schema } = mongoose

const cardPurchaseSchema = new Schema({
  cardId: { type: Schema.Types.ObjectId, ref: 'Card', required: true },
  cardCode: { type: String, required: true },
  
  // Purchase details
  purchasePrice: { type: Number, required: true }, // Price paid for the card
  initialCredit: { type: Number, required: true }, // Initial balance loaded on card
  
  // Payment information
  paymentMethod: { type: String, enum: ['cash', 'card'], default: 'cash' },
  amountInserted: { type: Number, required: true },
  changeGiven: { type: Number, default: 0 },
  
  // Optional customer data
  customerName: { type: String, default: '' },
  customerEmail: { type: String, default: '' },
  customerPhone: { type: String, default: '' },
  customerContribuinte: { type: String, default: '' },
  
  // Sale tracking
  saleId: { type: Schema.Types.ObjectId, ref: 'Sale' },
  batchId: { type: String, default: '' },
  
  // Hardware tracking
  dispenserUsed: { type: Boolean, default: false },
  cardWritten: { type: Boolean, default: false },
  
  createdAt: { type: Date, default: Date.now }
})

cardPurchaseSchema.index({ cardCode: 1 })
cardPurchaseSchema.index({ createdAt: -1 })

export default mongoose.model('CardPurchase', cardPurchaseSchema)
