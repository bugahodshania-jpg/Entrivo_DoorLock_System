// Granted vs denied bar chart shared by the faculty/staff and student dashboards.
const chartWidth = 640;
const chartHeight = 240;
const chartPadding = {
  top: 16,
  right: 4,
  bottom: 32,
  left: 26,
};

function getNiceMax(value) {
  const safeValue = Math.max(1, Number(value) || 0);

  if (safeValue <= 4) {
    return 4;
  }

  const magnitude = 10 ** Math.floor(Math.log10(safeValue));
  const normalized = safeValue / magnitude;

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 5) return 5 * magnitude;

  return 10 * magnitude;
}

function getYTicks(maxValue, tickCount = 4) {
  return Array.from({ length: tickCount + 1 }, (_, index) =>
    Math.round((maxValue / tickCount) * index),
  );
}

function getBarLayout(dataLength) {
  const plotWidth = chartWidth - chartPadding.left - chartPadding.right;
  const groupWidth = plotWidth / Math.max(dataLength, 1);
  const clusterWidth = Math.min(groupWidth * 0.72, 56);
  const barGap = 3;
  const barWidth = Math.max((clusterWidth - barGap) / 2, 6);

  return { groupWidth, clusterWidth, barGap, barWidth };
}

export default function AccessTrendChart({ data }) {
  const rawMax = Math.max(
    0,
    ...data.flatMap((item) => [Number(item.granted) || 0, Number(item.denied) || 0]),
  );
  const maxChartValue = getNiceMax(rawMax);
  const yTicks = getYTicks(maxChartValue);
  const plotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
  const baselineY = chartHeight - chartPadding.bottom;
  const { groupWidth, clusterWidth, barGap, barWidth } = getBarLayout(data.length);

  return (
    <div
      className="dashboard-bar-chart"
      role="img"
      aria-label="Bar chart comparing granted and denied access"
    >
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none">
        {yTicks.map((tick) => {
          const y = baselineY - (tick / maxChartValue) * plotHeight;

          return (
            <g key={`tick-${tick}`}>
              <line
                x1={chartPadding.left}
                y1={y}
                x2={chartWidth - chartPadding.right}
                y2={y}
                className={tick === 0 ? 'dashboard-chart-axis' : 'dashboard-chart-grid-line'}
              />
              <text
                x={chartPadding.left - 6}
                y={y + 3}
                className="dashboard-chart-axis-label"
                textAnchor="end"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {data.map((item, index) => {
          const granted = Number(item.granted) || 0;
          const denied = Number(item.denied) || 0;
          const groupCenter = chartPadding.left + index * groupWidth + groupWidth / 2;
          const clusterStart = groupCenter - clusterWidth / 2;
          const grantedHeight = (granted / maxChartValue) * plotHeight;
          const deniedHeight = (denied / maxChartValue) * plotHeight;
          const grantedX = clusterStart;
          const deniedX = clusterStart + barWidth + barGap;

          return (
            <g key={item.date}>
              <rect
                className="dashboard-chart-bar dashboard-chart-bar-granted"
                x={grantedX}
                y={baselineY - grantedHeight}
                width={barWidth}
                height={Math.max(grantedHeight, granted > 0 ? 2 : 0)}
                rx="2"
                ry="2"
              >
                <title>{`${item.label}: ${granted} granted`}</title>
              </rect>
              <rect
                className="dashboard-chart-bar dashboard-chart-bar-denied"
                x={deniedX}
                y={baselineY - deniedHeight}
                width={barWidth}
                height={Math.max(deniedHeight, denied > 0 ? 2 : 0)}
                rx="2"
                ry="2"
              >
                <title>{`${item.label}: ${denied} denied`}</title>
              </rect>
              <text
                x={groupCenter}
                y={chartHeight - 8}
                className="dashboard-chart-label"
                textAnchor="middle"
              >
                {item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
