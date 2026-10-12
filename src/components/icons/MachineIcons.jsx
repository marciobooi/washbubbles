import React from 'react'
import './machine-icons.css'

// Own artwork (replaces the picture frames that came with the previous program).
// `animated` turns the motion on; the icons are plain SVG so they scale and take any size.
const cls = (animated, className) => `wbi ${animated ? 'wbi-on' : ''} ${className || ''}`.trim()

/** Washing machine: spinning drum + rising bubbles. */
export function WasherIcon({ animated = true, className = 'w-full h-full', title }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className={cls(animated, className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect x="13" y="5" width="74" height="90" rx="7" fill="#fff" stroke="#559B91" strokeWidth="2.5" />
      <path d="M14 26 H86" stroke="#B8D8D2" strokeWidth="2" />
      <rect x="20" y="12" width="19" height="8" rx="2" fill="#E2F2EF" stroke="#559B91" strokeWidth="1" />
      <circle cx="49" cy="17" r="5" fill="#E2F2EF" stroke="#559B91" strokeWidth="1.5" />
      <path d="M49 14 V17 L52 19" fill="none" stroke="#287F75" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="61" y="12" width="19" height="9" rx="2" fill="#183D43" />
      <circle cx="50" cy="56" r="27" fill="#E5EFED" stroke="#559B91" strokeWidth="3" />
      <circle cx="50" cy="56" r="22" fill="#C9F0E9" stroke="#347F78" strokeWidth="2" />
      <g className="wbi-drum" fill="none" stroke="#439F94" strokeWidth="2" strokeLinecap="round">
        <ellipse cx="50" cy="56" rx="13" ry="20" strokeDasharray="13 8" />
        <path d="M34 49 Q50 40 66 49" />
        <path d="M34 63 Q50 72 66 63" />
      </g>
      <g fill="#fff" stroke="#70C8B8" strokeWidth="1">
        <circle className="wbi-bubble" cx="37" cy="59" r="3" />
        <circle className="wbi-bubble wbi-b2" cx="61" cy="52" r="2.5" />
        <circle className="wbi-bubble wbi-b3" cx="48" cy="69" r="2" />
      </g>
      <path d="M25 84 H75" stroke="#B8D8D2" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Dryer: turning fan blades + warm air rising. */
export function DryerIcon({ animated = true, className = 'w-full h-full', title }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className={cls(animated, className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <rect x="13" y="5" width="74" height="90" rx="7" fill="#fff" stroke="#559B91" strokeWidth="2.5" />
      <path d="M14 26 H86" stroke="#B8D8D2" strokeWidth="2" />
      <rect x="20" y="12" width="26" height="8" rx="2" fill="#E2F2EF" stroke="#559B91" strokeWidth="1" />
      <circle cx="58" cy="16" r="3" fill="#F2B880" />
      <circle cx="67" cy="16" r="3" fill="#E2F2EF" stroke="#559B91" strokeWidth="1" />
      <rect x="74" y="12" width="7" height="9" rx="2" fill="#183D43" />
      <circle cx="50" cy="56" r="27" fill="#E5EFED" stroke="#559B91" strokeWidth="3" />
      <circle cx="50" cy="56" r="22" fill="#F4F1E6" stroke="#347F78" strokeWidth="2" />
      <g className="wbi-fan" fill="#8CCFC4" stroke="#439F94" strokeWidth="1.5" strokeLinejoin="round">
        <path d="M50 56 C44 44 52 36 58 42 C60 48 56 54 50 56Z" />
        <path d="M50 56 C62 50 70 58 64 64 C58 66 52 62 50 56Z" />
        <path d="M50 56 C56 68 48 76 42 70 C40 64 44 58 50 56Z" />
        <path d="M50 56 C38 62 30 54 36 48 C42 46 48 50 50 56Z" />
      </g>
      <circle cx="50" cy="56" r="4" fill="#439F94" />
      <g fill="none" stroke="#F0A15A" strokeWidth="1.8" strokeLinecap="round">
        <path className="wbi-heat" d="M36 45 q3 -3 0 -6 q-3 -3 0 -6" />
        <path className="wbi-heat wbi-h2" d="M50 42 q3 -3 0 -6 q-3 -3 0 -6" />
        <path className="wbi-heat wbi-h3" d="M64 45 q3 -3 0 -6 q-3 -3 0 -6" />
      </g>
      <path d="M25 84 H75" stroke="#B8D8D2" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Loyalty card: chip, stripe and a soft light sweep. */
export function CardIcon({ animated = true, className = 'w-full h-full', title }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className={cls(animated, className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <defs><clipPath id="wbi-card-clip"><rect x="10" y="26" width="80" height="50" rx="8" /></clipPath></defs>
      <g className="wbi-float">
        <rect x="10" y="26" width="80" height="50" rx="8" fill="#fff" stroke="#559B91" strokeWidth="2.5" />
        <rect x="10.5" y="36" width="79" height="9" fill="#C9F0E9" />
        <rect x="19" y="53" width="14" height="10" rx="2.5" fill="#E2F2EF" stroke="#439F94" strokeWidth="1.5" />
        <path d="M40 58 H72" stroke="#B8D8D2" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M40 66 H58" stroke="#B8D8D2" strokeWidth="2.5" strokeLinecap="round" />
        <g clipPath="url(#wbi-card-clip)"><rect className="wbi-shine" x="10" y="20" width="14" height="62" fill="#fff" opacity=".7" /></g>
      </g>
    </svg>
  )
}

/** Two cards with a plus: buy a new card. */
export function CardsIcon({ animated = true, className = 'w-full h-full', title }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" className={cls(animated, className)} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g className="wbi-float2">
        <rect x="24" y="18" width="62" height="40" rx="7" fill="#E2F2EF" stroke="#8CCFC4" strokeWidth="2.5" />
        <path d="M24 30 H86" stroke="#8CCFC4" strokeWidth="5" />
      </g>
      <g className="wbi-float">
        <rect x="12" y="36" width="66" height="44" rx="7" fill="#fff" stroke="#559B91" strokeWidth="2.5" />
        <path d="M12.5 48 H77.5" stroke="#C9F0E9" strokeWidth="7" />
        <path d="M45 58 V72 M38 65 H52" stroke="#287F75" strokeWidth="3.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export const ICONS = { wash: WasherIcon, dry: DryerIcon, card: CardIcon, buyCard: CardsIcon }
