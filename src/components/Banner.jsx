import React, { useState, useEffect, useRef, useCallback } from 'react'
import api from '@/services/api'
import { DEFAULT_BANNERS } from '@/lib/defaultBanners'

const AUTOPLAY_INTERVAL_MS = 10000
// Minimum horizontal drag before it counts as a swipe rather than a stray tap
// or a slightly-off-axis touch that shouldn't move the slide.
const SWIPE_THRESHOLD_PX = 50

export default function Banner() {
  // Admin-configurable (Definições > Banner), publicly readable since this
  // renders before any customer session exists. Falls back to the built-in
  // defaults when the setting has never been saved, so an upgraded kiosk
  // doesn't go blank — see lib/defaultBanners.js.
  const [banners, setBanners] = useState(DEFAULT_BANNERS)
  const [currentIndex, setCurrentIndex] = useState(0)
  const timerRef = useRef(null)
  const dragStartX = useRef(null)
  const dragDeltaX = useRef(0)

  useEffect(() => {
    let cancelled = false
    api.getPublicSetting('banners').then((resp) => {
      if (cancelled) return
      const saved = resp && Array.isArray(resp.value) ? resp.value : null
      if (saved && saved.length > 0) setBanners(saved)
    }).catch(() => { /* keep the defaults already in state */ })
    return () => { cancelled = true }
  }, [])

  // Restarting the timer (rather than letting a fixed setInterval run
  // untouched) means a manual swipe or dot tap doesn't get overridden a moment
  // later by an autoplay tick someone didn't ask for. Depends on the slide
  // count so it re-syncs once the real (possibly admin-edited) list loads in
  // place of the initial defaults.
  const slideCount = banners.length
  const restartAutoplay = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (slideCount < 2) return // nothing to autoplay through
    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slideCount)
    }, AUTOPLAY_INTERVAL_MS)
  }, [slideCount])

  useEffect(() => {
    setCurrentIndex(0) // the loaded list can be a different length/order than the defaults
    restartAutoplay()
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [restartAutoplay])

  const goToSlide = (index) => {
    setCurrentIndex(index)
    restartAutoplay()
  }
  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + banners.length) % banners.length)
    restartAutoplay()
  }
  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % banners.length)
    restartAutoplay()
  }

  // Swipe left/right on the slide itself. Pointer events (not just touch)
  // so a mouse-drag works too when testing outside a real touchscreen.
  const onPointerDown = (e) => {
    dragStartX.current = e.clientX
    dragDeltaX.current = 0
  }
  const onPointerMove = (e) => {
    if (dragStartX.current === null) return
    dragDeltaX.current = e.clientX - dragStartX.current
  }
  const onPointerUp = () => {
    if (dragStartX.current === null) return
    const delta = dragDeltaX.current
    dragStartX.current = null
    dragDeltaX.current = 0
    if (delta <= -SWIPE_THRESHOLD_PX) goToNext()
    else if (delta >= SWIPE_THRESHOLD_PX) goToPrevious()
  }

  return (
    <div
      className="relative w-full h-[20rem] overflow-hidden bg-gradient-to-r from-teal-500 to-teal-600 shadow-xl touch-pan-y select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
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

      {/* Dots Indicator. Swipe and autoplay replace the arrow buttons that used
          to sit here — on a touchscreen kiosk they were redundant with a swipe
          gesture, and could still register a tap through an open modal. */}
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
