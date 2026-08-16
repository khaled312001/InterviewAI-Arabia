import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

export interface BarSeries {
  /** Neutral latin key — never an Arabic literal, so data shape stays
   *  decoupled from copy. */
  dataKey: string;
  /** Arabic label shown in the legend and tooltip. */
  name: string;
  stackId?: string;
}

export interface BarChartRtlProps<T extends object> {
  data: T[];
  categoryKey: string;
  series: BarSeries[];
  height?: number | Record<string, number>;
  showLegend?: boolean;
  yWidth?: number;
}

export function BarChartRtl<T extends object>({
  data,
  categoryKey,
  series,
  height = chartHeight.md,
  showLegend = false,
  yWidth = 56,
}: BarChartRtlProps<T>) {
  const theme = useTheme();
  // Only the first mount animates; a chart that redraws itself on every poll
  // is unreadable.
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setAnimate(false), 500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <Box sx={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={chartMargin}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridStroke(theme)} vertical={false} />
          {/* `reversed` puts the first category at the inline-start (right). */}
          <XAxis dataKey={categoryKey} reversed tick={axisTick(theme)} tickLine={false} axisLine={false} />
          {/* The value axis belongs on the right in RTL. */}
          <YAxis
            orientation="right"
            width={yWidth}
            tick={axisTick(theme)}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip {...tooltipProps(theme)} />
          {showLegend && <Legend {...legendProps()} />}
          {series.map((s, i) => (
            <Bar
              key={s.dataKey}
              dataKey={s.dataKey}
              name={s.name}
              stackId={s.stackId}
              fill={seriesColor(theme, i)}
              radius={[6, 6, 0, 0]}
              isAnimationActive={animate}
              animationDuration={400}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
