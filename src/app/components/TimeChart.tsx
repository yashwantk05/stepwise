import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface TimePoint {
  subject: string;
  hours: number;
}

export function TimeChart({ data }: { data: TimePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: 6, bottom: 0 }}>
        <defs>
          <linearGradient id="progressTimeFill" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="#d1d5db" />
        <XAxis dataKey="subject" stroke="#64748b" />
        <YAxis stroke="#64748b" />
        <Tooltip formatter={(value: number) => [`${value.toFixed(1)} hrs`, 'Study time']} />
        <Bar dataKey="hours" fill="url(#progressTimeFill)" radius={[10, 10, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
