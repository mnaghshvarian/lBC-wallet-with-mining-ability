import { Globe } from 'lucide-react';
import { LANGUAGES } from '../i18n';
import { useApp, useT } from '../store';

/** Language selector; "auto" follows the operating system. */
export function LanguagePicker({ compact }: { compact?: boolean }) {
  const t = useT();
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  if (!settings) return null;
  return (
    <label className={`language-picker ${compact ? 'compact' : ''}`}>
      <Globe size={16} aria-hidden />
      <select className="select" aria-label={t('settings.language')} value={settings.language} onChange={(e) => void updateSettings({ language: e.target.value })}>
        <option value="auto">{t('settings.languageAuto')}</option>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
            {l.name !== l.english ? ` — ${l.english}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
