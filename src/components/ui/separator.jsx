export function Separator({ orientation = 'horizontal', className = '' }) {
  if (orientation === 'vertical') return <div className={`w-px h-6 bg-muted/40 ${className}`} />
  return <div className={`h-px w-full bg-muted/40 ${className}`} />
}
