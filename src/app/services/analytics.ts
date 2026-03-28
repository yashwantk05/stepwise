const STORAGE_KEY = 'stepwise_analytics_events_v1';

export interface AnalyticsEventRecord {
  name: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

export const trackEvent = (name: string, data: Record<string, unknown> = {}) => {
  const event: AnalyticsEventRecord = {
    name,
    data,
    timestamp: Date.now(),
  };

  try {
    const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as AnalyticsEventRecord[];
    existing.push(event);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing.slice(-250)));
  } catch {
    // Ignore local analytics persistence failures in UI-only mode.
  }

  return event;
};
