import { useEffect, useState } from 'react'

export default function useFrameAnimation(frames = [], interval = 300) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!frames || frames.length === 0) return
    const id = setInterval(() => setIndex((i) => (i + 1) % frames.length), interval)
    return () => clearInterval(id)
  }, [frames, interval])
  return frames && frames.length > 0 ? frames[index] : null
}
