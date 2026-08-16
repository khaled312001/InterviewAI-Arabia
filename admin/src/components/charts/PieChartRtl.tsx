import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { chartHeight, chartMargin, legendProps, seriesColor, tooltipProps } from './chartTheme';

export interface PieDatum {
  /** Arabic label. */
  name: string;
  value: number;
}

export interface PieChartRtlProps {
  data: PieDatum[];
  height?: number | Record<string, number>;
  showLegend?: boolean;
  innerRadius?: number;
}

export function PieChartRtl({
  data,
  height = chartHeight.md,
  showLegend = true,
  innerRadius = 60,
}: PieChartRtlProps) {
  const theme = useTheme();
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    const id = window.setTimeout(() => setAnimate(false), 500);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <Box sx={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={chartMargin}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius="80%"
            paddingAngle={2}
            isAnimationActive={animate}
            animationDuration={400}
            stroke="none"
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={seriesColor(theme, i)} />
            ))}
          </Pie>
          <Tooltip {...tooltipProps(theme)} />
          {showLegend && <Legend {...legendProps()} />}
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}
