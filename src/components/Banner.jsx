import React, { useState, useEffect, useRef, useCallback } from 'react'
import api from '@/services/api'
import { DEFAULT_BANNERS } from '@/lib/defaultBanners'
import { useTranslation } from 'react-i18next'

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
  const { i18n } = useTranslation()
  // Machine translations of the slides made by the server from the Portuguese the admin wrote
  const [translations, setTranslations] = useState({})
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
    api.getPublicSetting('bannersTranslations').then((resp) => {
      if (!cancelled && resp && resp.value && resp.value.slides) setTranslations(resp.value.slides)
    }).catch(() => { /* the Portuguese text stays */ })
    return () => { cancelled = true }
  }, [])

  // The text in the customer's language, only if it was made from exactly the Portuguese that is saved now
  const textFor = (banner, field) => {
    const lang = i18n.language
    const tr = translations[banner.id]
    if (lang !== 'pt' && tr && tr.pt && tr.pt.title === (banner.title || '') && tr.pt.text === (banner.text || '') && tr[lang] && tr[lang][field]) return tr[lang][field]
    return banner[field]
  }

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
      className="relative isolate w-full h-[26rem] overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-r from-teal-600 to-emerald-700 shadow-lg shadow-teal-950/10 touch-pan-y select-none"
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
          <div className="absolute inset-0 z-0" style={{ background: 'linear-gradient(135deg, rgba(8,70,60,0.88) 0%, rgba(13,148,136,0.74) 50%, rgba(4,120,87,0.82) 100%)' }} />
          <div className="relative z-10 flex flex-col items-center justify-center text-center h-full px-12 w-full pb-6">
            <h2 className="text-6xl font-extrabold tracking-tight mb-4 text-white drop-shadow-lg">
              {textFor(banner, 'title')}
            </h2>
            <p className="text-3xl font-medium text-teal-50 opacity-95 drop-shadow-md max-w-3xl">
              {textFor(banner, 'text')}
            </p>
          </div>
        </div>
      ))}

      {/* Dots Indicator. Swipe and autoplay replace the arrow buttons that used
          to sit here — on a touchscreen kiosk they were redundant with a swipe
          gesture, and could still register a tap through an open modal. */}
      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 z-20">
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
