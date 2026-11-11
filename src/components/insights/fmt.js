export function fmtEuro(n) {
  return `${(Number(n) || 0).toFixed(2)}€`
}

export const CARD_CLASS = 'bg-card rounded-[20px] p-6 shadow-[0_1px_2px_rgba(20,25,30,0.04),0_8px_20px_-12px_rgba(20,25,30,0.08)]'
