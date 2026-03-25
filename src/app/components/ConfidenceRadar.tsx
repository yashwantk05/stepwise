import React from 'react';
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from 'recharts';

export interface ConfidencePoint {
  subject: string;
  confidence: number;
}

export function ConfidenceRadar({ data }: { data: ConfidencePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <RadarChart data={data} outerRadius="62%">
        <PolarGrid stroke="#d1d5db" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 13 }} />
        <Radar
          dataKey="confidence"
          stroke="#8b5cf6"
          fill="#8b5cf6"
          fillOpacity={0.45}
          strokeWidth={2}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
