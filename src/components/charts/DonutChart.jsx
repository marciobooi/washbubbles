import React from 'react'

/**
 * A plain SVG donut (no chart library). `slices` = [{ key, label, value, color }]; the centre shows `centre` (a big number and a
 * caption). Slices with no value are left out; with nothing at all it draws an empty ring.
 */
export default function DonutChart({ slices, centre, size = 190, thickness = 30 }) {
  const total = slices.reduce((s, x) => s + (x.value || 0), 0)
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(20,25,30,0.07)" strokeWidth={thickness} />
      {total > 0 && slices.filter((x) => x.value > 0).map((x) => {
        const len = (x.value / total) * c
        const el = (
          <circle key={x.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={x.color} strokeWidth={thickness}
            strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`} strokeDashoffset={-offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <title>{`${x.label}: ${x.value} (${Math.round((x.value / total) * 100)}%)`}</title>
          </circle>
        )
        offset += len
        return el
      })}
      {centre && (
        <g textAnchor="middle">
          <text x={size / 2} y={size / 2 + 2} fontSize="26" fontWeight="800" fill="currentColor">{centre.big}</text>
          <text x={size / 2} y={size / 2 + 20} fontSize="11" fill="#8a8478">{centre.small}</text>
        </g>
      )}
    </svg>
  )
}
