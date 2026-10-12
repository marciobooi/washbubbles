import React, { useEffect, useRef } from 'react'

// Bioluminescent soap bubbles floating up and popping. Tap one to pop it, tap empty water to blow a few more.
// Canvas, own artwork; stops when unmounted or when the page is hidden.
const PALETTE = [
  { rim: '45,212,191', tint: '20,184,166' },
  { rim: '56,189,248', tint: '14,165,233' },
  { rim: '52,211,153', tint: '16,185,129' },
]
const MAX_BUBBLES = 30

export default function BubbleLoader({ className = '', children, compact = false }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return undefined
    const ctx = canvas.getContext('2d')
    let width = 0
    let height = 0
    let raf = 0
    let stopped = false
    const bubbles = []
    const effects = []
    const reduced = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const r = wrap.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(1, r.width)
      height = Math.max(1, r.height)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
    ro?.observe(wrap)

    function makeBubble(x, y, radius) {
      const rnd = Math.random()
      const base = radius || (compact ? Math.random() * 7 + 6 : rnd < 0.42 ? Math.random() * 14 + 12 : rnd < 0.78 ? Math.random() * 22 + 27 : Math.random() * 28 + 50)
      const buoy = (base > 45 ? 1.9 : base < 20 ? 1.1 : 1.4) * (compact ? 0.45 : 1)
      return {
        x: x !== undefined ? x : (compact ? width / 2 + (Math.random() - 0.5) * width * 0.45 : Math.random() * width),
        y: y !== undefined ? y : height + Math.random() * 80 + 30,
        r: base,
        vy: -(Math.random() * 0.9 + buoy) * (compact ? 0.4 : 0.5),
        vx: (Math.random() - 0.5) * 0.3,
        swaySpeed: (Math.random() * 0.025 + 0.015) * 0.5,
        swayDist: Math.random() * 2.2 + 0.8,
        swayAngle: Math.random() * Math.PI * 2,
        m1: Math.random() * Math.PI * 2, m1s: (Math.random() * 0.045 + 0.025) * 0.5,
        m2: Math.random() * Math.PI * 2, m2s: (Math.random() * 0.03 + 0.02) * 0.5,
        wob: Math.random() * 0.035 + 0.015,
        rot: Math.random() * Math.PI * 2, rots: (Math.random() - 0.5) * 0.012,
        pop: Math.random() * height * 0.2 + (compact ? 4 : 16),
        pal: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        alpha: 0, target: Math.random() * 0.25 + 0.75, dead: false,
      }
    }
    function popBubble(b) {
      if (b.dead) return
      b.dead = true
      effects.push({ kind: 'ring', x: b.x, y: b.y, r: b.r, max: b.r * 1.5, a: 0.7, color: 'rgb(' + b.pal.rim + ')' })
      const n = compact ? 4 : 7
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + Math.random() * 0.6
        const sp = (Math.random() * 1.6 + 1.2) * (b.r > 45 ? 1.4 : 1)
        effects.push({ kind: 'dot', x: b.x + Math.cos(ang) * b.r, y: b.y + Math.sin(ang) * b.r, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: Math.random() * 1.4 + 1, a: 0.9, decay: 0.03, color: 'rgb(' + b.pal.rim + ')' })
      }
    }

    function drawBubble(b) {
      if (b.dead || b.alpha <= 0) return
      const r = b.r
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.scale(1 + Math.sin(b.m1) * b.wob, 1 - Math.sin(b.m1) * b.wob)
      ctx.globalAlpha = b.alpha
      // soft body: nearly clear in the middle, tinted towards the edge
      const g = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r)
      g.addColorStop(0, 'rgba(255,255,255,0.10)')
      g.addColorStop(0.7, 'rgba(' + b.pal.tint + ',0.08)')
      g.addColorStop(1, 'rgba(' + b.pal.tint + ',0.30)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
      // thin clean rim
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(' + b.pal.rim + ',0.85)'
      ctx.lineWidth = Math.max(1.2, r * 0.05)
      ctx.stroke()
      // one soft highlight, top-left
      ctx.beginPath(); ctx.arc(0, 0, r * 0.72, Math.PI * 1.08, Math.PI * 1.45)
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.lineWidth = Math.max(1.6, r * 0.11)
      ctx.lineCap = 'round'
      ctx.stroke()
      // tiny sparkle
      ctx.beginPath(); ctx.arc(r * 0.3, r * 0.35, Math.max(1, r * 0.06), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill()
      ctx.restore()
    }

    for (let i = 0; i < (compact ? 5 : 16); i++) bubbles.push(makeBubble(Math.random() * width, Math.random() * height))
    let tick = 0

    function frame() {
      if (stopped) return
      ctx.clearRect(0, 0, width, height)
      tick++
      if (tick % (compact ? 30 : 40) === 0 && bubbles.length < (compact ? 7 : MAX_BUBBLES)) bubbles.push(makeBubble())
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        if (!b.dead) {
          if (b.alpha < b.target) b.alpha += 0.015
          b.y += b.vy
          b.swayAngle += b.swaySpeed
          b.x += Math.sin(b.swayAngle) * b.swayDist * 0.5 + b.vx
          b.m1 += b.m1s; b.m2 += b.m2s; 
          if (b.y <= b.pop) popBubble(b)
          if (b.x < -b.r * 2.5 || b.x > width + b.r * 2.5) b.dead = true
        }
        drawBubble(b)
        if (b.dead) bubbles.splice(i, 1)
      }
      for (let i = effects.length - 1; i >= 0; i--) {
        const p = effects[i]
        if (p.kind === 'ring') {
          p.r += (p.max - p.r) / 7
          p.a -= 0.05
          if (p.a > 0) {
            ctx.save(); ctx.globalAlpha = p.a
            ctx.strokeStyle = p.color; ctx.lineWidth = 1.6
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke()
            ctx.restore()
          }
        } else {
          p.x += p.vx; p.y += p.vy; p.vy += 0.09; p.vx *= 0.98; p.a -= p.decay
          if (p.a > 0) {
            ctx.save(); ctx.globalAlpha = p.a
            ctx.fillStyle = p.color
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
            ctx.restore()
          }
        }
        if (p.a <= 0) effects.splice(i, 1)
      }
      raf = requestAnimationFrame(frame)
    }
    if (reduced) {
      // no motion: draw the first frame only
      bubbles.forEach((b) => { b.alpha = b.target })
      frame(); cancelAnimationFrame(raf)
    } else {
      raf = requestAnimationFrame(frame)
    }

    const onVisibility = () => {
      if (document.hidden) { cancelAnimationFrame(raf) } else if (!stopped && !reduced) { raf = requestAnimationFrame(frame) }
    }
    document.addEventListener('visibilitychange', onVisibility)

    const onPointer = (e) => {
      const rect = canvas.getBoundingClientRect()
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        if (Math.hypot(b.x - x, b.y - y) <= b.r * 1.35) { popBubble(b); return }
      }
      for (let j = 0; j < 3; j++) {
        const nb = makeBubble(x + (Math.random() - 0.5) * 36, y + (Math.random() - 0.5) * 36, Math.random() * 18 + 14)
        nb.alpha = 0.85
        bubbles.push(nb)
      }
    }
    if (!compact) canvas.addEventListener('pointerdown', onPointer)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      if (!compact) canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [compact])

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className}`} role="status" aria-live="polite">
      <canvas ref={canvasRef} className={`absolute inset-0 w-full h-full ${compact ? '' : 'cursor-pointer'}`} />
      {children ? <div className="relative z-10 h-full flex flex-col items-center justify-center text-center pointer-events-none">{children}</div> : null}
    </div>
  )
}
