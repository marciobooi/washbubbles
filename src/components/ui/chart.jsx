import * as React from 'react'
import * as RechartsPrimitive from 'recharts'
import { cn } from '@/lib/utils'

/**
 * The shadcn chart wrapper (recharts): ChartContainer gives every series its colour as a CSS variable (--color-<key>) from `config`,
 * ChartTooltipContent and ChartLegendContent draw the tooltip and the legend in the same style as the rest of the admin.
 *
 * config = { key: { label, color } }
 */
const ChartContext = React.createContext(null)

function useChart() {
  const ctx = React.useContext(ChartContext)
  if (!ctx) throw new Error('useChart must be used within a <ChartContainer />')
  return ctx
}

const ChartContainer = React.forwardRef(({ id, className, children, config, ...props }, ref) => {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`
  const style = Object.fromEntries(Object.entries(config || {}).filter(([, v]) => v?.color).map(([k, v]) => [`--color-${k}`, v.color]))
  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-chart={chartId}
        ref={ref}
        style={style}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-[#8a8478] [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-black/10 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-black/10 [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-black/5 [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
})
ChartContainer.displayName = 'ChartContainer'

const ChartTooltip = RechartsPrimitive.Tooltip

const ChartTooltipContent = React.forwardRef(
  ({ active, payload, className, hideLabel = false, label, labelFormatter, formatter, valueFormatter, total, indicator = 'dot' }, ref) => {
    const { config } = useChart()
    if (!active || !payload?.length) return null
    const items = payload.filter((p) => p.type !== 'none')
    const heading = hideLabel ? null : labelFormatter ? labelFormatter(label, items) : label
    return (
      <div ref={ref} className={cn('grid min-w-[10rem] items-start gap-1.5 rounded-xl border border-black/10 bg-white px-3 py-2 text-xs shadow-xl', className)}>
        {heading ? <div className="font-semibold text-[#0c2b26]">{heading}</div> : null}
        <div className="grid gap-1">
          {items.map((item) => {
            const key = String(item.dataKey ?? item.name)
            const cfg = config?.[key] || {}
            const color = item.color || item.payload?.fill || cfg.color
            const value = formatter ? formatter(item.value, key, item) : valueFormatter ? valueFormatter(item.value) : item.value
            return (
              <div key={key} className="flex items-center gap-2">
                <span className={cn('shrink-0', indicator === 'line' ? 'h-0.5 w-3' : 'h-2.5 w-2.5 rounded-[2px]')} style={{ background: color }} />
                <span className="flex-1 text-[#8a8478]">{cfg.label || item.name}</span>
                <span className="font-mono font-medium tabular-nums text-[#0c2b26]">{value}</span>
              </div>
            )
          })}
          {total ? (
            <div className="mt-0.5 flex items-center gap-2 border-t border-black/10 pt-1.5">
              <span className="flex-1 text-[#8a8478]">{total.label}</span>
              <span className="font-mono font-semibold tabular-nums text-[#0c2b26]">{total.value(items)}</span>
            </div>
          ) : null}
        </div>
      </div>
    )
  },
)
ChartTooltipContent.displayName = 'ChartTooltipContent'

const ChartLegend = RechartsPrimitive.Legend

const ChartLegendContent = React.forwardRef(({ className, payload, verticalAlign = 'bottom' }, ref) => {
  const { config } = useChart()
  if (!payload?.length) return null
  return (
    <div ref={ref} className={cn('flex flex-wrap items-center justify-center gap-x-4 gap-y-1', verticalAlign === 'top' ? 'pb-3' : 'pt-3', className)}>
      {payload.filter((p) => p.type !== 'none').map((item) => {
        const key = String(item.dataKey ?? item.value)
        return (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: item.color }} />
            {config?.[key]?.label || item.value}
          </div>
        )
      })}
    </div>
  )
})
ChartLegendContent.displayName = 'ChartLegendContent'

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent }
