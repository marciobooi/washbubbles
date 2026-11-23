import React, { useState } from 'react'
import { Palette, Image as ImageIcon, Globe, Scale, SlidersHorizontal, ShieldCheck, Wifi as WifiIcon, CreditCard as CardIcon, MessageCircle, Bell, Power } from 'lucide-react'
import ShutdownScheduleForm from '@/components/ShutdownScheduleForm'
import PageHeader from '@/components/PageHeader'
import BrandingTab from './BrandingTab'
import BannerTab from './BannerTab'
import LandingTab from './LandingTab'
import StaffTab from './StaffTab'
import PaymentsTab from './PaymentsTab'
import WiFiTab from './WiFiTab'
import LegalTab from './LegalTab'
import AlertsTab from './AlertsTab'
import CreditSettings from './CreditSettings'
import WhatsAppTab from './WhatsAppTab'
import AdvancedTab from './AdvancedTab'

// Two menu entries share this page: "Website" (what the public sees: branding, banner, the start page, legal) and "Definições" (how
// the shop works: the kiosk PIN, WiFi, MB WAY, WhatsApp). 'scope' picks the tabs; each tab loads its own data when it becomes active.
const TABS = [
  { id: 'branding', label: 'Branding', Icon: Palette, scope: 'website' },
  { id: 'banner', label: 'Banner', Icon: ImageIcon, scope: 'website' },
  { id: 'landing', label: 'Página Inicial', Icon: Globe, scope: 'website' },
  { id: 'legal', label: 'Legal / RGPD', Icon: Scale, scope: 'website' },
  { id: 'advanced', label: 'Avançado', Icon: SlidersHorizontal, scope: 'website' },
  { id: 'staff', label: 'Kiosk PIN', Icon: ShieldCheck, scope: 'system' },
  { id: 'wifi', label: 'WiFi', Icon: WifiIcon, scope: 'system' },
  { id: 'payments', label: 'Mbway', Icon: CardIcon, scope: 'system' },
  { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle, scope: 'system' },
  { id: 'credit', label: 'Cartão e crédito', Icon: CardIcon, scope: 'system' },
  { id: 'alerts', label: 'Email', Icon: Bell, scope: 'system' },
  { id: 'shutdown', label: 'Desligar PC', Icon: Power, scope: 'system' },
]

export default function AdminSettings({ scope = 'website' }) {
  const tabs = TABS.filter((t) => t.scope === scope)
  const [activeTabRaw, setActiveTab] = useState(tabs[0].id)
  // never show a tab that belongs to the other page (the same component serves both menu entries)
  const activeTab = tabs.some((t) => t.id === activeTabRaw) ? activeTabRaw : tabs[0].id

  return (
    <div className="p-4 md:p-6 space-y-4">
      <PageHeader title={scope === 'system' ? 'Definições' : 'Website'} />

      {/* Tab bar — one section visible at a time instead of every Card stacked and
          expanded; each tab owns its own state, so switching tabs never loses anything. */}
      <div className="flex gap-2 overflow-x-auto pb-1 max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => {
          const active = activeTab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-lg border whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[var(--primary,#0d9488)]
                ${active ? 'bg-[var(--primary,#0d9488)] text-white border-transparent hover:bg-[color-mix(in_srgb,var(--primary,#0d9488)_88%,black)]' : 'bg-white border-black/[0.12] text-neutral-700 hover:bg-white hover:border-[var(--primary,#0d9488)] hover:text-[var(--primary,#0d9488)] active:bg-neutral-50'}`}
            >
              <t.Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'branding' && <BrandingTab />}
      {activeTab === 'banner' && <BannerTab />}
      {activeTab === 'landing' && <LandingTab />}
      {activeTab === 'staff' && <StaffTab />}
      {activeTab === 'payments' && <PaymentsTab />}
      {activeTab === 'wifi' && <WiFiTab />}
      {activeTab === 'legal' && <LegalTab />}
      {activeTab === 'alerts' && <AlertsTab />}
      {activeTab === 'credit' && <CreditSettings />}
      {activeTab === 'shutdown' && <ShutdownScheduleForm />}
      {activeTab === 'whatsapp' && <WhatsAppTab />}
      {activeTab === 'advanced' && <AdvancedTab />}
    </div>
  )
}
