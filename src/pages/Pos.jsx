import React, { useEffect, useState } from 'react'
import Wave from '../components/wave'

export default function Pos() {
  const cards = [
    { id: 'wash', title: 'Lavar roupa', text: 'Lavar roupa', frames: ['/washingmashine/L1.png', '/washingmashine/L2.png', '/washingmashine/L3.png', '/washingmashine/L4.png'] },
    { id: 'dry', title: 'Secar roupa', text: 'Secar roupa', frames: ['/drymachine/S1.png', '/drymachine/S2.png', '/drymachine/S3.png', '/drymachine/S4.png'] },
    { id: 'card', title: 'Rinse', text: 'Carregar cartao', frames: ['/card/card.png' ] },
    { id: 'buyCard', title: 'Settings', text: 'Comprar cartao' , frames: ['/card/card-group.png' ] }
  ]

  function useFrameAnimation(frames = [], interval = 300) {
    const [index, setIndex] = useState(0)
    useEffect(() => {
      if (!frames || frames.length === 0) return
      const id = setInterval(() => setIndex((i) => (i + 1) % frames.length), interval)
      return () => clearInterval(id)
    }, [frames, interval])
    return frames && frames.length > 0 ? frames[index] : null
  }

  function Card({ c }) {
    const frame = useFrameAnimation(c.frames, 300)
    return (
      <div key={c.id} role="button" tabIndex={0} aria-pressed="false" onClick={() => console.log('clicked', c.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && console.log('clicked', c.id)} className="z-50 glass-card p-6 shadow-xl transition-transform duration-150 ease-in-out h-full flex flex-col justify-center select-none cursor-pointer active:scale-95 active:shadow-lg">
       
        <div className="mt-2">
          {frame ? (
            <img
              src={frame}
              alt={`${c.title} animation`}
              className="mx-auto w-64 h-64 object-contain"
              style={{ filter: 'brightness(0) saturate(100%) invert(93%) sepia(7%) saturate(2300%) hue-rotate(130deg) brightness(77%) contrast(82%)' }}
            />
          ) : null}
        </div>
         <p className="mt-2 text-center text-neutral-600 font-bold text-2xl">{c.text}</p>
      </div>
    )
  }

  return (
    <div className="relative pb-[12vh] z-10">
      <div className="min-h-[calc(100vh-6rem)] grid grid-rows-4 sm:grid-rows-2 sm:grid-cols-2 lg:grid-rows-1 lg:grid-cols-4 gap-6">
        {cards.map((c) => (
          <Card key={c.id} c={c} />
        ))}
      </div>
      <Wave height="12vh" className="mt-2" />
    </div>
  )
}
