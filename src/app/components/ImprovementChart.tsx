import React from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface ImprovementPoint {
  subject: string;
  before: number;
  after: number;
}

export function ImprovementChart({ data }: { data: ImprovementPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: 6, bottom: 0 }}>
        <CartesianGrid strokeDasharray="4 4" stroke="#d1d5db" />
        <XAxis dataKey="subject" stroke="#64748b" />
        <YAxis domain={[0, 100]} stroke="#64748b" />
        <Tooltip formatter={(value: number) => [`${Math.round(value)}%`, 'Accuracy']} />
        <Legend />
        <Bar dataKey="before" fill="#ef4444" radius={[8, 8, 0, 0]} />
        <Bar dataKey="after" fill="#10b981" radius={[8, 8, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
