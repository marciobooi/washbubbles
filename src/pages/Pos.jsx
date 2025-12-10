import React from 'react'
import Wave from '../components/wave'

export default function Pos() {
  const cards = [
    { id: 'wash', title: 'Wash', text: 'Start a wash cycle' },
    { id: 'dry', title: 'Dry', text: 'Start a dry cycle' },
    { id: 'rinse', title: 'Rinse', text: 'Rinse cycle' },
    { id: 'settings', title: 'Settings', text: 'Kiosk settings' },
  ]

  return (
    <div className="relative pb-[12vh]">
      <h2 className="text-2xl font-bold mb-4">Kiosk</h2>
      <div className="min-h-[calc(100vh-6rem)] grid grid-rows-4 sm:grid-rows-2 sm:grid-cols-2 lg:grid-rows-1 lg:grid-cols-4 gap-6">
        {cards.map((c) => (
          <div key={c.id} className="glass-card p-6 shadow-xl transition-transform duration-150 ease-in-out h-full flex flex-col justify-center select-none cursor-pointer active:scale-95 active:shadow-lg">
            <h3 className="text-lg font-semibold text-primary-800">{c.title}</h3>
            <p className="mt-2 text-neutral-600">{c.text}</p>
            <div className="mt-4">
              <button className="px-6 py-3 rounded btn-primary w-full text-lg active:scale-95 active:translate-y-1">Start</button>
            </div>
          </div>
        ))}
      </div>
      <Wave height="12vh" className="mt-2" />
    </div>
  )
}
