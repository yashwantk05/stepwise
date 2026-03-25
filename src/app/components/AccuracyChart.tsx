import React from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface AccuracyPoint {
  label: string;
  accuracy: number;
}

export function AccuracyChart({ data }: { data: AccuracyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <AreaChart data={data} margin={{ top: 16, right: 12, left: 6, bottom: 0 }}>
        <defs>
          <linearGradient id="progressAccuracyFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.72} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.18} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="#d1d5db" />
        <XAxis dataKey="label" stroke="#64748b" />
        <YAxis domain={[0, 100]} stroke="#64748b" />
        <Tooltip formatter={(value: number) => [`${Math.round(value)}%`, 'Accuracy']} />
        <Area
          type="monotone"
          dataKey="accuracy"
          stroke="#3b82f6"
          strokeWidth={2.5}
          fill="url(#progressAccuracyFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
