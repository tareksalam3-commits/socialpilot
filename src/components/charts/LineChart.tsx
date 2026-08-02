export type LineChartSeries = {
  name: string;
  color: string;
  points: { label: string; value: number }[];
};

export type LineChartProps = {
  series: LineChartSeries[];
  height?: number;
  formatValue?: (value: number) => string;
  emptyLabel?: string;
};

/**
 * Minimal, dependency-free responsive multi-series line chart with area fill.
 */
export function LineChart({ series, height = 180, formatValue, emptyLabel }: LineChartProps) {
  const pointCount = series[0]?.points.length ?? 0;

  if (series.length === 0 || pointCount === 0) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
        {emptyLabel ?? '—'}
      </div>
    );
  }

  const width = Math.max(pointCount * 24, 320);
  const max = Math.max(...series.flatMap((s) => s.points.map((p) => p.value)), 1);
  const stepX = pointCount > 1 ? width / (pointCount - 1) : width;

  const toPath = (points: { value: number }[]) =>
    points
      .map((p, i) => {
        const x = i * stepX;
        const y = height - (p.value / max) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const toAreaPath = (points: { value: number }[]) => {
    const line = toPath(points);
    const lastX = (points.length - 1) * stepX;
    return `${line} L${lastX.toFixed(1)},${height} L0,${height} Z`;
  };

  const labelStep = Math.max(1, Math.ceil(pointCount / 6));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height + 24}`} width="100%" height={height + 24} preserveAspectRatio="xMinYMin meet" role="img">
        {series.map((s) => (
          <path key={`${s.name}-area`} d={toAreaPath(s.points)} fill={s.color} opacity={0.08} />
        ))}
        {series.map((s) => (
          <path key={`${s.name}-line`} d={toPath(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series[0].points.map((p, i) => {
          if (i % labelStep !== 0 && i !== pointCount - 1) return null;
          const x = i * stepX;
          return (
            <text key={`label-${i}`} x={x} y={height + 16} textAnchor="middle" fontSize={9} className="fill-slate-400 dark:fill-slate-500">
              {p.label}
            </text>
          );
        })}
        {series.map((s) =>
          s.points.map((p, i) => {
            const x = i * stepX;
            const y = height - (p.value / max) * height;
            return (
              <circle key={`${s.name}-pt-${i}`} cx={x} cy={y} r={2.5} fill={s.color}>
                <title>{`${s.name} · ${p.label}: ${formatValue ? formatValue(p.value) : p.value}`}</title>
              </circle>
            );
          }),
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4">
        {series.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.name}
          </div>
        ))}
      </div>
    </div>
  );
}
