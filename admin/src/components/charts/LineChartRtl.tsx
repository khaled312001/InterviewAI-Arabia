import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  axisTick,
  chartHeight,
  chartMargin,
  gridStroke,
  legendProps,
  seriesColor,
  tooltipProps,
} from './chartTheme';

export interface LineSeries {
  /** Neutral latin key — never an Arabic literal. */
  dataKey: string;
  /** Arabic label for the legend and tooltip. */
  name: string;
  /** Series that may legitimately have no value on a given day (an average
   *  over zero samples) must not be drawn through the gap. */
  connectNulls?: boolean;
}

export interface LineChartRtlProps<T extends Record<string, unknown>> {
  data: T[];
  categoryKey: string;
  series: LineSeries[];
  height?: number | Record<string, number>;
  showLegend?: boolean;
  yWidth?: number;
  tickFormatter?: (value: string) => string;
  /** Formats the tooltip's category heading; defaults to tickFormatter. */
  labelFormatter?: (value: string) => string;
  yDomain?: [number | 'auto', number | 'auto'];
}

/** Trend over time. Same RTL treatment as BarChartRtl: the first point sits at
 *  the inline-start (right) and the value axis is on the right. */
export function LineChartRtl<T extends Record<string, unknown>>({
  data,
  categoryKey,
  series,
  height = chartHeight.md,
  showLegend = true,
  yWidth = 48,
  tickFormatter,
  labelFormatter,
  yDomain,
}: LineChartRtlProps<T>) {
  const theme = useTheme();
  // Only the first mount animates; redrawing on every refetch is unreadable.
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setAnimate(false), 500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <Box sx={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke(theme)} vertical={false} />
          <XAxis
            dataKey={categoryKey}
            reversed
            tick={axisTick(theme)}
            tickLine={false}
            axisLine={false}
            tickFormatter={tickFormatter}
            interval="preserveStartEnd"
            minTickGap={28}
          />
          <YAxis
            orientation="right"
            width={yWidth}
            domain={yDomain}
            allowDecimals={false}
            tick={axisTick(theme)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip {...tooltipProps(theme)} labelFormatter={labelFormatter ?? tickFormatter} />
          {showLegend && <Legend {...legendProps()} />}
          {series.map((s, i) => (
            <Line
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stroke={seriesColor(theme, i)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls={s.connectNulls ?? false}
              isAnimationActive={animate}
              animationDuration={400}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}
