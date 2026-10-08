import React from 'react'
import useFrameAnimation from '../hooks/useFrameAnimation'

export default function Card({ c, onClick = () => {} }) {
  const frame = useFrameAnimation(c.frames, 300)
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed="false"
      onClick={() => onClick(c.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick(c.id)}
      className="glass-card h-full flex flex-col justify-between p-10 select-none cursor-pointer group shadow-lg"
    >
      <div className="flex-grow flex items-center justify-center w-full overflow-hidden py-2">
        {frame ? (
          <img
            src={frame}
            alt={`${c.title} animation`}
            className="mx-auto w-auto max-w-56 h-56 object-contain drop-shadow-sm transition-all duration-300 group-hover:scale-110 group-hover:drop-shadow-md"
            style={{ filter: 'brightness(0) saturate(100%) invert(93%) sepia(7%) saturate(2300%) hue-rotate(130deg) brightness(77%) contrast(82%)' }}
          />
        ) : null}
      </div>
      <div className="mt-6 text-center">
        <p className="text-neutral-700 font-semibold text-3xl tracking-wide uppercase">{c.text}</p>
        <div className="h-1.5 w-12 bg-primary-400/30 mx-auto mt-4 rounded-full transition-all duration-300 group-hover:w-24 group-hover:bg-primary-500/50"></div>
      </div>
    </div>
  )
}
