import { app } from 'electron';
import { createTranslator, resolveLanguage, type Params } from '@lbcwallet/ui/i18n';

/** The UI language for a settings value ("auto" follows the operating system). */
export function uiLanguage(setting: string): string {
  return resolveLanguage(setting, app.getPreferredSystemLanguages());
}

/** Translates main-process texts (dialogs, menus) with the same dictionaries as the UI. */
export function tr(languageSetting: string, key: string, params?: Params): string {
  return createTranslator(uiLanguage(languageSetting))(key, params);
}
