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
      className="z-50 glass-card p-6 shadow-xl transition-transform duration-150 ease-in-out h-full flex flex-col justify-center select-none cursor-pointer active:scale-95 active:shadow-lg"
    >
      <div className="mt-2 flex-grow flex items-center justify-center w-full overflow-hidden">
        {frame ? (
          <img
            src={frame}
            alt={`${c.title} animation`}
            className="mx-auto w-full h-full object-contain max-h-64"
            style={{ filter: 'brightness(0) saturate(100%) invert(93%) sepia(7%) saturate(2300%) hue-rotate(130deg) brightness(77%) contrast(82%)' }}
          />
        ) : null}
      </div>
      <p className="mt-4 text-center text-neutral-600 font-bold text-2xl">{c.text}</p>
    </div>
  )
}
