import React from 'react'

export default function Pos() {
  const cards = [
    { id: 'wash', title: 'Wash', text: 'Start a wash cycle' },
    { id: 'dry', title: 'Dry', text: 'Start a dry cycle' },
    { id: 'rinse', title: 'Rinse', text: 'Rinse cycle' },
    { id: 'settings', title: 'Settings', text: 'Kiosk settings' },
  ]

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Kiosk</h2>
      <div className="min-h-[calc(100vh-6rem)] grid grid-rows-4 sm:grid-rows-2 sm:grid-cols-2 lg:grid-rows-1 lg:grid-cols-4 gap-6">
        {cards.map((c) => (
          <div key={c.id} className="glass-card p-6 shadow-xl hover:shadow-2xl transition-shadow duration-200 h-full flex flex-col justify-center">
            <h3 className="text-lg font-semibold text-primary-800">{c.title}</h3>
            <p className="mt-2 text-neutral-600">{c.text}</p>
            <div className="mt-4">
              <button className="px-6 py-3 rounded btn-primary w-full text-lg">Start</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
