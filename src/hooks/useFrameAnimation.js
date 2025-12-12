import { useEffect, useState, useRef } from 'react'

function stringToSeed(str) {
  if (!str) return Math.floor(Math.random() * 1000)
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

export default function useFrameAnimation(frames = [], interval = 300, opts = {}) {
  const seed = typeof opts.seed === 'number' ? opts.seed : stringToSeed(opts.seed || '')
  const [index, setIndex] = useState(() => (frames && frames.length > 0 ? seed % frames.length : 0))
  const intervalRef = useRef(null)
  useEffect(() => {
    if (!frames || frames.length === 0) return
    // Jitter interval by a small amount derived from seed to avoid perfect sync
    const jitter = seed % 120 - 60 // -60..59ms
    const tick = Math.max(60, interval + jitter)
    intervalRef.current = setInterval(() => setIndex((i) => (i + 1) % frames.length), tick)
    return () => clearInterval(intervalRef.current)
  }, [frames, interval, seed])
  return frames && frames.length > 0 ? frames[index] : null
}
