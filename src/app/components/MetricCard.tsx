import React from 'react';

interface MetricCardProps {
  icon: React.ReactNode;
  value: string;
  label: string;
  badge: string;
  variant: 'blue' | 'purple' | 'green' | 'orange';
}

export function MetricCard({ icon, value, label, badge, variant }: MetricCardProps) {
  return (
    <article className={`progress-metric-card progress-metric-card-${variant}`}>
      <div className="progress-metric-icon">{icon}</div>
      <strong>{value}</strong>
      <span>{label}</span>
      <label>{badge}</label>
    </article>
  );
}
