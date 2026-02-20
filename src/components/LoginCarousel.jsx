import React, { useEffect, useState } from 'react'

// simple carousel that cycles through images located in /login folder under public
export default function LoginCarousel({ className }) {
  const [images, setImages] = useState([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    // Vite: import public assets with absolute path pattern
    const modules = import.meta.glob('../../public/login/*.{jpg,jpeg,png,gif}', { query: '?url', import: 'default', eager: true })
    const urls = Object.values(modules)
    setImages(urls)
  }, [])

  useEffect(() => {
    if (images.length === 0) return
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % images.length)
    }, 5000)
    return () => clearInterval(id)
  }, [images])

  if (images.length === 0) return null

  return (
    <div
      className={className}
      style={{
        backgroundImage: `url(${images[index]})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    />
  )
}
