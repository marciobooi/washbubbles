import React from 'react'
import { CartContext } from '@/context/CartContext'
import CardModal from '@/components/CardModal'

/** DEV ONLY (route /dev/card): the "My card" window with a fake card and history. */
export default function DevCardPreview() {
  const now = Date.now()
  const tx = [
    { id: '1', ts: new Date(now - 3600e3).toISOString(), type: 'recharge', amount: 10 },
    { id: '2', ts: new Date(now - 7200e3).toISOString(), type: 'payment', amount: -4.5, name: 'Lavar 4', machineType: 'wash' },
    { id: '3', ts: new Date(now - 9e6).toISOString(), type: 'payment', amount: -1.8, name: 'Secar 8', machineType: 'dry' },
    { id: '4', ts: new Date(now - 2e7).toISOString(), type: 'payment', amount: -1.8, name: 'Secar 9', machineType: 'dry' },
    { id: '5', ts: new Date(now - 3e7).toISOString(), type: 'recharge', amount: 20 },
    { id: '6', ts: new Date(now - 4e7).toISOString(), type: 'payment', amount: -6.5, name: 'Lavar 1', machineType: 'wash' },
    { id: '7', ts: new Date(now - 5e7).toISOString(), type: 'card_purchase', amount: 5 },
  ]
  const value = { cart: [], addToCart: () => {}, openCart: () => {}, credit: 0, refundAt: null }
  return (
    <CartContext.Provider value={value}>
      <CardModal open onClose={() => {}} transactions={tx} balance={14.7} card={{ code: 'CARD-84920' }} />
    </CartContext.Provider>
  )
}
