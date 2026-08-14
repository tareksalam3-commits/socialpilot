export type DonutChartDatum = {
  label: string;
  value: number;
  color: string;
};

export type DonutChartProps = {
  data: DonutChartDatum[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
  emptyLabel?: string;
};

/**
 * Minimal, dependency-free donut chart built from SVG circle stroke-dasharray segments.
 */
export function DonutChart({ data, size = 140, thickness = 16, centerLabel, centerValue, emptyLabel }: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  if (total === 0) {
    return (
      <div style={{ width: size, height: size }} className="flex items-center justify-center rounded-full border-8 border-slate-100 text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        {emptyLabel ?? '—'}
      </div>
    );
  }

  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img">
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {data.map((d) => {
              const fraction = d.value / total;
              const dash = fraction * circumference;
              const el = (
                <circle
                  key={d.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={d.color}
                  strokeWidth={thickness}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                >
                  <title>{`${d.label}: ${d.value}`}</title>
                </circle>
              );
              offset += dash;
              return el;
            })}
          </g>
        </svg>
        {(centerLabel || centerValue !== undefined) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue !== undefined && <span className="text-lg font-bold text-slate-900 dark:text-white">{centerValue}</span>}
            {centerLabel && <span className="text-[10px] text-slate-500 dark:text-slate-400">{centerLabel}</span>}
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
            <span className="text-slate-600 dark:text-slate-300">{d.label}</span>
            <span className="font-medium text-slate-900 dark:text-white">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
