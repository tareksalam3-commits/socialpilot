export type BarChartDatum = {
  label: string;
  value: number;
};

export type BarChartProps = {
  data: BarChartDatum[];
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
  emptyLabel?: string;
};

/**
 * Minimal, dependency-free responsive bar chart.
 * Renders as inline SVG so it scales with its container and supports dark mode via currentColor/className.
 */
export function BarChart({ data, color = '#0ea5e9', height = 160, formatValue, emptyLabel }: BarChartProps) {
  if (data.length === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        {emptyLabel ?? '—'}
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);
  const width = Math.max(data.length * 32, 240);
  const barWidth = Math.min(24, (width / data.length) * 0.6);
  const gap = width / data.length;

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height + 24}`} width="100%" height={height + 24} preserveAspectRatio="xMinYMin meet" role="img">
        {data.map((d, i) => {
          const barHeight = max > 0 ? (d.value / max) * height : 0;
          const x = i * gap + (gap - barWidth) / 2;
          const y = height - barHeight;
          return (
            <g key={`${d.label}-${i}`}>
              <title>{`${d.label}: ${formatValue ? formatValue(d.value) : d.value}`}</title>
              <rect x={x} y={y} width={barWidth} height={Math.max(barHeight, 1)} rx={3} fill={color} opacity={0.85} />
              <text
                x={x + barWidth / 2}
                y={height + 16}
                textAnchor="middle"
                fontSize={9}
                className="fill-slate-400 dark:fill-slate-500"
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
