import React, { useEffect, useRef } from 'react'

// Bioluminescent soap bubbles floating up and popping. Tap one to pop it, tap empty water to blow a few more.
// Canvas, own artwork; stops when unmounted or when the page is hidden.
const PALETTE = [
  { neon: '#00E5FF', accent: '#38BDF8' },
  { neon: '#10B981', accent: '#34D399' },
  { neon: '#2DD4BF', accent: '#5EEAD4' },
  { neon: '#38BDF8', accent: '#7DD3FC' },
]
const MAX_BUBBLES = 30

export default function BubbleLoader({ className = '', children }) {
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
      const base = radius || (rnd < 0.42 ? Math.random() * 14 + 12 : rnd < 0.78 ? Math.random() * 22 + 27 : Math.random() * 28 + 50)
      const buoy = base > 45 ? 1.9 : base < 20 ? 1.1 : 1.4
      return {
        x: x !== undefined ? x : Math.random() * width,
        y: y !== undefined ? y : height + Math.random() * 80 + 30,
        r: base,
        vy: -(Math.random() * 0.9 + buoy),
        vx: (Math.random() - 0.5) * 0.6,
        swaySpeed: Math.random() * 0.025 + 0.015,
        swayDist: Math.random() * 2.2 + 0.8,
        swayAngle: Math.random() * Math.PI * 2,
        m1: Math.random() * Math.PI * 2, m1s: Math.random() * 0.045 + 0.025,
        m2: Math.random() * Math.PI * 2, m2s: Math.random() * 0.03 + 0.02,
        wob: Math.random() * 0.14 + 0.06,
        rot: Math.random() * Math.PI * 2, rots: (Math.random() - 0.5) * 0.012,
        pop: Math.random() * height * 0.2 + 16,
        pal: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        alpha: 0, target: Math.random() * 0.25 + 0.75, dead: false,
      }
    }
    function popBubble(b) {
      if (b.dead) return
      b.dead = true
      effects.push({ kind: 'ring', x: b.x, y: b.y, r: b.r * 0.4, max: b.r * 1.45, a: 0.95, color: b.pal.neon })
      const n = Math.floor(b.r * 0.5) + 8
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2
        const sp = (Math.random() * 4.5 + 2) * (b.r > 45 ? 1.25 : 1)
        effects.push({ kind: 'dot', x: b.x, y: b.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 1.2, r: Math.random() * 2.2 + 0.8, a: 1, decay: Math.random() * 0.03 + 0.025, color: b.pal.neon })
      }
    }

    function drawBubble(b) {
      if (b.dead || b.alpha <= 0) return
      const r = b.r
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(b.rot)
      const sx = 1 + Math.sin(b.m1) * b.wob
      const sy = 1 - Math.sin(b.m1) * b.wob * 0.85
      ctx.transform(sx, Math.cos(b.m2) * b.wob * 0.35, 0, sy, 0, 0)
      ctx.globalAlpha = b.alpha
      // neon rim
      ctx.shadowColor = b.pal.neon
      ctx.shadowBlur = r > 40 ? 24 : r > 25 ? 16 : 9
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2)
      ctx.strokeStyle = b.pal.neon; ctx.lineWidth = Math.max(1.8, r * 0.075); ctx.stroke()
      ctx.shadowBlur = 0
      // translucent iridescent body
      const g = ctx.createRadialGradient(-r * 0.28, -r * 0.28, r * 0.1, 0, 0, r)
      g.addColorStop(0, 'rgba(255,255,255,0.14)')
      g.addColorStop(0.55, 'rgba(0,229,255,0.05)')
      g.addColorStop(0.82, 'rgba(16,185,129,0.10)')
      g.addColorStop(0.96, 'rgba(255,255,255,0.26)')
      g.addColorStop(1, 'rgba(0,229,255,0.45)')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
      // glass edge
      ctx.beginPath(); ctx.arc(0, 0, Math.max(1, r - 1.5), 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, r * 0.035); ctx.stroke()
      // crescent highlight
      ctx.save()
      ctx.beginPath()
      ctx.arc(0, 0, r * 0.88, -Math.PI * 0.82, -Math.PI * 0.16, false)
      ctx.arc(0, 0, r * 0.7, -Math.PI * 0.16, -Math.PI * 0.82, true)
      ctx.closePath()
      const gg = ctx.createLinearGradient(-r * 0.6, -r * 0.8, r * 0.5, -r * 0.2)
      gg.addColorStop(0, 'rgba(255,255,255,0.25)'); gg.addColorStop(0.35, 'rgba(255,255,255,0.98)')
      gg.addColorStop(0.75, 'rgba(255,255,255,0.85)'); gg.addColorStop(1, 'rgba(255,255,255,0.1)')
      ctx.fillStyle = gg; ctx.fill()
      ctx.restore()
      ctx.beginPath(); ctx.arc(-r * 0.42, -r * 0.48, Math.max(1.8, r * 0.1), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill()
      // lower refraction
      ctx.beginPath(); ctx.arc(0, 0, r * 0.86, Math.PI * 0.28, Math.PI * 0.68)
      ctx.strokeStyle = b.pal.accent; ctx.lineWidth = Math.max(1.4, r * 0.065); ctx.lineCap = 'round'; ctx.stroke()
      ctx.restore()
    }

    for (let i = 0; i < 16; i++) bubbles.push(makeBubble(Math.random() * width, Math.random() * height))
    let tick = 0

    function frame() {
      if (stopped) return
      ctx.clearRect(0, 0, width, height)
      tick++
      if (tick % 24 === 0 && bubbles.length < MAX_BUBBLES) bubbles.push(makeBubble())
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i]
        if (!b.dead) {
          if (b.alpha < b.target) b.alpha += 0.03
          b.y += b.vy
          b.swayAngle += b.swaySpeed
          b.x += Math.sin(b.swayAngle) * b.swayDist * 0.5 + b.vx
          b.m1 += b.m1s; b.m2 += b.m2s; b.rot += b.rots
          if (b.y <= b.pop) popBubble(b)
          if (b.x < -b.r * 2.5 || b.x > width + b.r * 2.5) b.dead = true
        }
        drawBubble(b)
        if (b.dead) bubbles.splice(i, 1)
      }
      for (let i = effects.length - 1; i >= 0; i--) {
        const p = effects[i]
        if (p.kind === 'ring') {
          p.r += (p.max - p.r) / 4
          p.a -= 0.085
          if (p.a > 0) {
            ctx.save(); ctx.globalAlpha = p.a
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2; ctx.shadowColor = p.color; ctx.shadowBlur = 12
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke()
            ctx.restore()
          }
        } else {
          p.x += p.vx; p.y += p.vy; p.vy += 0.09; p.vx *= 0.98; p.a -= p.decay
          if (p.a > 0) {
            ctx.save(); ctx.globalAlpha = p.a
            ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 8
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
    canvas.addEventListener('pointerdown', onPointer)

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      ro?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('pointerdown', onPointer)
    }
  }, [])

  return (
    <div ref={wrapRef} className={`relative overflow-hidden ${className}`} role="status" aria-live="polite">
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full cursor-pointer" />
      {children ? <div className="relative z-10 h-full flex flex-col items-center justify-center text-center pointer-events-none">{children}</div> : null}
    </div>
  )
}
