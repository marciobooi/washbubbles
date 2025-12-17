
  import React, { useState, useEffect } from 'react'

const banners = [
    { id: 'banner1', 
        title: 'Limpeza a seco', 
        text: 'Entre em contacto mail@mail.com', 
        image: '/banner/dry.png'
    },
    { id: 'banner2', 
        title: 'Lavagem de carpetes', 
        text: 'Entre em contacto mail@mail.com', 
        image: '/banner/carpet.png'
    },
]

export default function Banner() {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % banners.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const goToSlide = (index) => setCurrentIndex(index)
  const goToPrevious = () => setCurrentIndex((prev) => (prev - 1 + banners.length) % banners.length)
  const goToNext = () => setCurrentIndex((prev) => (prev + 1) % banners.length)

  return (
    <div className="relative w-full h-[20rem] overflow-hidden bg-gradient-to-r from-teal-500 to-teal-600 shadow-xl">
      {banners.map((banner, index) => (
        <div
          key={banner.id}
          className={`absolute inset-0 transition-all duration-700 ease-in-out flex items-center justify-center ${
            index === currentIndex
              ? 'opacity-100 translate-x-0'
              : index < currentIndex
              ? 'opacity-0 -translate-x-full'
              : 'opacity-0 translate-x-full'
          }`}
          style={{
            backgroundImage: `url(${banner.image})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
        >
          {/* Overlay for darkening the image only */}
          <div className="absolute inset-0 z-0" style={{background: 'linear-gradient(to right, rgba(13,148,136,0.7), rgba(20,184,166,0.6))', filter: 'brightness(0.7)'}} />
          <div className="relative z-10 flex flex-col items-start justify-end h-full px-8 lg:px-16 w-full max-w-5xl mx-auto pb-10">
            <h2 className="text-4xl lg:text-5xl font-bold mb-2 text-white drop-shadow-lg">
              {banner.title}
            </h2>
            <p className="text-xl lg:text-2xl text-white opacity-90 drop-shadow-md">
              {banner.text}
            </p>
          </div>
        </div>
      ))}

      {/* Navigation Arrows */}
      <button
        onClick={goToPrevious}
        className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white p-3 rounded-full transition-all z-20"
        aria-label="Previous slide"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button
        onClick={goToNext}
        className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white p-3 rounded-full transition-all z-20"
        aria-label="Next slide"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Dots Indicator */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-20">
        {banners.map((_, index) => (
          <button
            key={index}
            onClick={() => goToSlide(index)}
            className={`w-3 h-3 rounded-full transition-all ${
              index === currentIndex
                ? 'bg-white w-8'
                : 'bg-white/50 hover:bg-white/70'
            }`}
            aria-label={`Go to slide ${index + 1}`}
          />
        ))}
      </div>
    </div>
  )
}