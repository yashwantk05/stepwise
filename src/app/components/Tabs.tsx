import React from 'react';

export interface ProgressTabOption {
  id: 'accuracy' | 'time' | 'improvement' | 'confidence';
  label: string;
}

interface TabsProps {
  tabs: ProgressTabOption[];
  activeTab: ProgressTabOption['id'];
  onChange: (tab: ProgressTabOption['id']) => void;
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="progress-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`progress-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
