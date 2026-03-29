import React from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface HeatmapDatum {
  notebook: string;
  score: number;
}

interface HeatmapChartProps {
  data: HeatmapDatum[];
}

const getBarColor = (score: number) => {
  if (score >= 0.75) return '#ef4444';
  if (score >= 0.5) return '#f97316';
  if (score >= 0.25) return '#8b5cf6';
  return '#60a5fa';
};

export function HeatmapChart({ data }: HeatmapChartProps) {
  if (data.length === 0) {
    return (
      <div className="weak-empty-chart">
        <p>No mistake data yet. Solve a few problems in AI Whiteboard to unlock your heatmap.</p>
      </div>
    );
  }

  return (
    <div className="weak-chart-shell">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="4 4" stroke="#d1d5db" horizontal vertical />
          <XAxis
            type="number"
            domain={[0, 1]}
            tickCount={5}
            stroke="#64748b"
            tickFormatter={(value) => Number(value).toFixed(2).replace(/\.00$/, '')}
          />
          <YAxis
            type="category"
            dataKey="notebook"
            width={140}
            stroke="#475569"
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            cursor={{ fill: 'rgba(139, 92, 246, 0.08)' }}
            formatter={(value: number) => [`${Math.round(value * 100)}%`, 'Mistake score']}
            contentStyle={{
              borderRadius: 14,
              border: '1px solid #ddd6fe',
              boxShadow: '0 14px 28px rgba(139, 92, 246, 0.12)',
            }}
          />
          <Bar dataKey="score" radius={[0, 12, 12, 0]} barSize={26} minPointSize={3}>
            {data.map((entry) => (
              <Cell key={entry.notebook} fill={getBarColor(entry.score)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
