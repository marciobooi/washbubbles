import React from 'react'
import Wave from '../components/wave'
import Card from '../components/Card'

export default function Pos() {
  const cards = [
    { id: 'wash', title: 'Lavar roupa', text: 'Lavar roupa', frames: ['/washingmashine/L1.png', '/washingmashine/L2.png', '/washingmashine/L3.png', '/washingmashine/L4.png'] },
    { id: 'dry', title: 'Secar roupa', text: 'Secar roupa', frames: ['/drymachine/S1.png', '/drymachine/S2.png', '/drymachine/S3.png', '/drymachine/S4.png'] },
    { id: 'card', title: 'Rinse', text: 'Carregar cartao', frames: ['/card/card.png' ] },
    { id: 'buyCard', title: 'Settings', text: 'Comprar cartao' , frames: ['/card/card-group.png' ] }
  ]

  // Card component moved to src/components/Card.jsx

  return (
    <div className="relative pb-[12vh] z-10">
      <div className="min-h-[calc(100vh-6rem)] grid grid-rows-4 sm:grid-rows-2 sm:grid-cols-2 lg:grid-rows-1 lg:grid-cols-4 gap-6">
        {cards.map((c) => (
          <Card key={c.id} c={c} onClick={(id) => console.log('clicked', id)} />
        ))}
      </div>
      <Wave height="12vh" className="mt-2" />
    </div>
  )
}
