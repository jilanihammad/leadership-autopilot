"use client";

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function Sparkline({
  data,
  color = "hsl(217 91% 60%)",
  width = 80,
  height = 28,
}: SparklineProps) {
  if (!data || data.length === 0) return null;

  // Single data point: show a flat line with a dot
  if (data.length === 1) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line x1={2} y1={height / 2} x2={width - 2} y2={height / 2}
          stroke={color} strokeWidth={1} strokeOpacity={0.3} strokeDasharray="2,2" />
        <circle cx={width - 2} cy={height / 2} r={2} fill={color} />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const padding = 2;
  const effectiveWidth = width - padding * 2;
  const effectiveHeight = height - padding * 2;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * effectiveWidth;
    const y =
      padding + effectiveHeight - ((value - min) / range) * effectiveHeight;
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(" L ")}`;

  // Create area path (for gradient fill)
  const areaD = `${pathD} L ${padding + effectiveWidth},${padding + effectiveHeight} L ${padding},${padding + effectiveHeight} Z`;

  const gradientId = `sparkline-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradientId})`} />
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot */}
      <circle
        cx={padding + effectiveWidth}
        cy={
          padding +
          effectiveHeight -
          ((data[data.length - 1] - min) / range) * effectiveHeight
        }
        r={2}
        fill={color}
      />
    </svg>
  );
}
