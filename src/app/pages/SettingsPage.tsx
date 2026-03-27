import React, { useEffect, useState } from 'react';
import {
  AudioLines,
  Check,
  Languages,
  Eye,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  Type,
  Volume2,
} from 'lucide-react';
import {
  resetUserSettings,
  updateUserSettings,
  type UserSettings,
} from '../services/storage';
import {
  applyAccessibilitySettings,
  stopAccessibilitySpeech,
} from '../services/accessibility';
import {
  getLanguageLabel,
  LANGUAGE_OPTIONS,
} from '../services/translation';

interface SettingsPageProps {
  user: {
    id?: string;
  } | null;
  settings: UserSettings;
  onSettingsChange: (settings: UserSettings) => void;
}

type ThemeOption = UserSettings['colorTheme'];

const themeCards: Array<{
  id: ThemeOption;
  title: string;
  badge: string;
  description: string;
  previewClassName: string;
}> = [
  {
    id: 'default',
    title: 'Default',
    badge: 'Balanced',
    description: 'Keeps the standard Stepwise look with strong contrast and bright accents.',
    previewClassName: 'theme-preview-default',
  },
  {
    id: 'dark',
    title: 'Dark',
    badge: 'Low glare',
    description: 'Uses dark surfaces to reduce glare during longer study sessions.',
    previewClassName: 'theme-preview-dark',
  },
];

const speechRateLabel = (value: number) => {
  if (value < 35) return 'Slow';
  if (value > 70) return 'Fast';
  return 'Normal';
};

const fontScaleLabel = (value: number) => {
  if (value < 35) return 'Small';
  if (value > 70) return 'Large';
  return 'Medium';
};

function SettingsToggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`settings-toggle ${checked ? 'is-on' : 'is-off'}`}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-thumb" />
    </button>
  );
}

function SettingsRange({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="settings-range"
      aria-label={label}
      style={{ ['--range-progress' as string]: value } as React.CSSProperties}
    />
  );
}

export function SettingsPage({ user, settings, onSettingsChange }: SettingsPageProps) {
  const [draft, setDraft] = useState<UserSettings>(settings);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    applyAccessibilitySettings(draft);
    return () => applyAccessibilitySettings(settings);
  }, [draft, settings]);

  useEffect(() => () => stopAccessibilitySpeech(), []);

  const setField = <K extends keyof UserSettings,>(key: K, value: UserSettings[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStatusMessage('');

    try {
      const saved = updateUserSettings(draft, user?.id);
      onSettingsChange(saved);
      setDraft(saved);

      setStatusMessage('Accessibility settings saved successfully.');
    } catch (error) {
      console.error('Failed to save settings:', error);
      setStatusMessage('Unable to save settings right now.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    stopAccessibilitySpeech();
    const reset = resetUserSettings(user?.id);
    onSettingsChange(reset);
    setDraft(reset);

    setStatusMessage('Accessibility settings reset to defaults.');
  };

  return (
    <main className="settings-page accessibility-settings-page">
      <section className="settings-hero">
        <span className="settings-eyebrow">Accessibility Settings</span>
        <h1>Make Stepwise easier to hear, read, and navigate.</h1>
        <p>
          Adjust audio support, visual readability, and color themes with live controls that
          save to your profile.
        </p>
      </section>

      <section className="settings-panel">
        <div className="settings-section-header settings-section-header-visual">
          <Languages size={20} />
          <div>
            <h2>Language & Localization</h2>
            <p className="settings-section-copy">
              Translate app text across the interface with Azure-powered multilingual support.
            </p>
          </div>
        </div>

        <div className="settings-option-row">
          <div className="settings-option-copy">
            <div className="settings-option-title">
              <Languages size={18} />
              <h3>App Language</h3>
            </div>
            <p>Choose the language used for labels, buttons, menus, and page copy across Stepwise.</p>
          </div>
          <span className="settings-inline-value">{getLanguageLabel(draft.appLanguage)}</span>
        </div>

        <label className="settings-field-label" htmlFor="app-language-select">
          Language
        </label>
        <select
          id="app-language-select"
          className="settings-select"
          value={draft.appLanguage}
          onChange={(event) => setField('appLanguage', event.target.value)}
        >
          {LANGUAGE_OPTIONS.map((language) => (
            <option key={language.code} value={language.code}>
              {language.label}
            </option>
          ))}
        </select>
      </section>

      <section className="settings-panel">
        <div className="settings-section-header settings-section-header-audio">
          <AudioLines size={20} />
          <div>
            <h2>Audio Features</h2>
            <p className="settings-section-copy">
              Spoken support is available here, and the old speech-to-text setting has been removed.
            </p>
          </div>
        </div>

        <div className="settings-option-row">
          <div className="settings-option-copy">
            <div className="settings-option-title">
              <Volume2 size={18} />
              <h3>Text to Speech</h3>
            </div>
            <p>Read page content aloud using Azure speech with your selected speed.</p>
          </div>
          <SettingsToggle
            checked={draft.textToSpeechEnabled}
            onChange={(checked) => setField('textToSpeechEnabled', checked)}
            label="Toggle text to speech"
          />
        </div>

        <div className="settings-option-row">
          <div className="settings-option-copy">
            <div className="settings-option-title">
              <Check size={18} />
              <h3>Speech Speed</h3>
            </div>
            <p>Adjust how fast the app reads page content aloud.</p>
          </div>
          <span className="settings-inline-value">{speechRateLabel(draft.speechRate)}</span>
        </div>

        <div className="settings-slider-group">
          <div className="settings-slider-header">
            <div className="settings-option-title">
              <AudioLines size={18} />
              <h3>Speech Speed</h3>
            </div>
            <span>{speechRateLabel(draft.speechRate)}</span>
          </div>
          <SettingsRange
            value={draft.speechRate}
            onChange={(value) => setField('speechRate', value)}
            label="Speech speed"
          />
          <div className="settings-slider-labels">
            <span>Slow</span>
            <span>Normal</span>
            <span>Fast</span>
          </div>
        </div>

      </section>

      <section className="settings-panel">
        <div className="settings-section-header settings-section-header-visual">
          <Eye size={20} />
          <div>
            <h2>Visual Adjustments</h2>
            <p className="settings-section-copy">
              Improve readability, navigation, and motion comfort across the app.
            </p>
          </div>
        </div>

        <div className="settings-option-row">
          <div className="settings-option-copy">
            <div className="settings-option-title">
              <Type size={18} />
              <h3>Dyslexia-Friendly Font</h3>
            </div>
            <p>Use OpenDyslexic with wider spacing to improve scanning and readability.</p>
          </div>
          <SettingsToggle
            checked={draft.dyslexiaFriendlyFont}
            onChange={(checked) => setField('dyslexiaFriendlyFont', checked)}
            label="Toggle dyslexia-friendly font"
          />
        </div>

        <div className="settings-option-row">
          <div className="settings-option-copy">
            <div className="settings-option-title">
              <Eye size={18} />
              <h3>High Contrast Mode</h3>
            </div>
            <p>Strengthen foreground and background separation for clearer reading.</p>
          </div>
          <SettingsToggle
            checked={draft.highContrastMode}
            onChange={(checked) => setField('highContrastMode', checked)}
            label="Toggle high contrast mode"
          />
        </div>

        <div className="settings-option-row">
          <div className="settings-option-copy">
            <div className="settings-option-title">
              <Sparkles size={18} />
              <h3>Large UI Mode</h3>
            </div>
            <p>Increase the size of buttons, cards, and layout elements across the interface.</p>
          </div>
          <SettingsToggle
            checked={draft.largeUiMode}
            onChange={(checked) => setField('largeUiMode', checked)}
            label="Toggle large user interface mode"
          />
        </div>

        <div className="settings-option-row">
          <div className="settings-option-copy">
            <div className="settings-option-title">
              <Sparkles size={18} />
              <h3>Reduce Motion</h3>
            </div>
            <p>Minimize animations and transitions for a calmer browsing experience.</p>
          </div>
          <SettingsToggle
            checked={draft.reduceMotion}
            onChange={(checked) => setField('reduceMotion', checked)}
            label="Toggle reduced motion"
          />
        </div>

        <div className="settings-option-row">
          <div className="settings-option-copy">
            <div className="settings-option-title">
              <Check size={18} />
              <h3>Focus Highlight</h3>
            </div>
            <p>Show stronger keyboard focus outlines to make navigation easier to follow.</p>
          </div>
          <SettingsToggle
            checked={draft.focusHighlight}
            onChange={(checked) => setField('focusHighlight', checked)}
            label="Toggle focus highlight"
          />
        </div>

        <div className="settings-slider-group">
          <div className="settings-slider-header">
            <div className="settings-option-title">
              <Type size={18} />
              <h3>Font Size</h3>
            </div>
            <span>{fontScaleLabel(draft.fontScale)}</span>
          </div>
          <SettingsRange
            value={draft.fontScale}
            onChange={(value) => setField('fontScale', value)}
            label="Font size"
          />
          <div className="settings-slider-labels">
            <span>Small</span>
            <span>Medium</span>
            <span>Large</span>
          </div>
        </div>

        <div className="settings-preview-row">
          <button type="button" className="settings-inline-preview-button">
            Focus Test Button
          </button>
          <input
            type="text"
            className="settings-focus-test-input"
            placeholder="Tab here to test focus highlight"
            aria-label="Focus highlight test input"
            readOnly
          />
        </div>
      </section>

      <section className="settings-panel">
        <div className="settings-section-header settings-section-header-theme">
          <Palette size={20} />
          <div>
            <h2>Color Themes</h2>
            <p className="settings-section-copy">
              Pick a theme that feels comfortable while keeping the full app in sync.
            </p>
          </div>
        </div>

        <div className="settings-theme-grid">
          {themeCards.map((theme) => (
            <button
              key={theme.id}
              type="button"
              className={`settings-theme-card ${draft.colorTheme === theme.id ? 'active' : ''}`}
              onClick={() => setField('colorTheme', theme.id)}
              aria-pressed={draft.colorTheme === theme.id}
            >
              <span className={`settings-theme-preview ${theme.previewClassName}`} />
              <span className="settings-theme-card-copy">
                <span className="settings-theme-title-row">
                  <span className="settings-theme-title">{theme.title}</span>
                  <span
                    className={`settings-theme-badge ${
                      draft.colorTheme === theme.id ? 'selected' : ''
                    }`}
                  >
                    {draft.colorTheme === theme.id ? 'Selected' : theme.badge}
                  </span>
                </span>
                <span className="settings-theme-description">{theme.description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="settings-actions">
        <button type="button" className="settings-save-button" onClick={handleSave} disabled={isSaving}>
          <Save size={18} />
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
        <button type="button" className="settings-reset-button" onClick={handleReset}>
          <RotateCcw size={18} />
          Reset to Defaults
        </button>
      </div>

      {statusMessage ? <p className="settings-status-message">{statusMessage}</p> : null}
    </main>
  );
}
