import React, { useEffect, useMemo, useState } from 'react';
import { getUserSettings, updateUserSettings } from '../services/storage';

interface SettingsPageProps {
  user: {
    id?: string;
  } | null;
}

export function SettingsPage({ user }: SettingsPageProps) {
  const [classLevel, setClassLevel] = useState<number | ''>('');

  const classOptions = useMemo(() => Array.from({ length: 12 }, (_, index) => index + 1), []);

  useEffect(() => {
    const saved = getUserSettings(user?.id).classLevel;
    setClassLevel(saved ?? '');
  }, [user?.id]);

  const handleClassChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextValue = Number(event.target.value);
    const normalized = Number.isInteger(nextValue) && nextValue >= 1 && nextValue <= 12 ? nextValue : '';
    setClassLevel(normalized);
    updateUserSettings({ classLevel: normalized === '' ? null : normalized }, user?.id);
  };

  return (
    <main className="settings-page">
      <section className="settings-card">
        <h1>Settings</h1>
        <p>Choose your class so tutor explanations stay at the right level.</p>

        <label htmlFor="class-level" className="settings-field-label">
          Class
        </label>
        <select id="class-level" className="settings-select" value={classLevel} onChange={handleClassChange}>
          <option value="">Select class</option>
          {classOptions.map((level) => (
            <option key={level} value={level}>
              Class {level}
            </option>
          ))}
        </select>
      </section>
    </main>
  );
}
