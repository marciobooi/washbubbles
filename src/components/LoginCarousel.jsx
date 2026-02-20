import React, { useEffect, useState } from 'react'

// simple carousel that cycles through images located in /login folder under public
export default function LoginCarousel({ className }) {
  const [images, setImages] = useState([])
  const [current, setCurrent] = useState(null)
  const [prev, setPrev] = useState(null)
  const [showPrev, setShowPrev] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)

  useEffect(() => {
    const urls = [
      '/login/1.jpg',
      '/login/2.jpg',
      '/login/3.jpg',
      '/login/4.jpg',
      '/login/5.jpg',
      '/login/6.jpg',
    ]
    setImages(urls)
    if (urls.length) {
      setCurrent(urls[0])
      setShowCurrent(true)
    }
  }, [])

  useEffect(() => {
    if (images.length === 0) return
    const id = setInterval(() => {
      setImages((imgs) => {
        const nextIndex = (imgs.indexOf(current) + 1) % imgs.length
        const nextUrl = imgs[nextIndex]
        setPrev(current)
        setShowPrev(true)
        // hide current before swapping so it can fade in
        setShowCurrent(false)
        setCurrent(nextUrl)
        // after DOM update trigger fades
        setTimeout(() => {
          setShowPrev(false)
          setShowCurrent(true)
        }, 50)
        return imgs
      })
    }, 5000)
    return () => clearInterval(id)
  }, [images, current])

  if (!current) return null

  return (
    <div className={className}>
      {prev && (
        <div
          className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
          style={{
            backgroundImage: `url(${prev})`,
            opacity: showPrev ? 1 : 0,
          }}
        />
      )}
      <div
        className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
        style={{
          backgroundImage: `url(${current})`,
          opacity: showCurrent ? 1 : 0,
        }}
      />
    </div>
  )
}
