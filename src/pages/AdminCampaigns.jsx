import React from 'react'
import MarketingBroadcastCard from '@/components/MarketingBroadcastCard'

/** Campaigns: an e-mail to the customers who accepted marketing. The address the answers go to is set in Definições > Email. */
export default function AdminCampaigns() {
  return (
    <div className="p-4 space-y-4">
      <h2 className="text-2xl font-bold">Campanhas</h2>
      <MarketingBroadcastCard />
    </div>
  )
}
