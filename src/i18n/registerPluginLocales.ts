import type { i18n } from 'i18next';
import { getI18n } from 'react-i18next';
import * as enNs from '../../locales/en/plugin__managed-operators-plugin.json';

const NS = 'plugin__managed-operators-plugin';
const en = enNs as unknown as Record<string, unknown>;

/**
 * Injects plugin strings into the host Console i18next instance when this chunk loads.
 * Do not import the default `i18next` package here: it is not a Console shared module, so you
 * would get a second instance and `useTranslation` would still miss keys. `getI18n()` comes
 * from shared `react-i18next` and points at the same instance the shell uses.
 */
function mergeEnglishInto(instance: i18n, lng: string): void {
  instance.addResourceBundle(lng, NS, en, true, true);
}

function register(): void {
  const instance = getI18n();
  if (!instance) {
    return;
  }
  const langs = new Set<string>(['en', 'en-US']);
  const current = instance.language;
  if (current) {
    langs.add(current);
    const short = current.split('-')[0];
    if (short) {
      langs.add(short);
    }
  }
  for (const lng of langs) {
    mergeEnglishInto(instance, lng);
  }
}

function attachWhenReady(): void {
  const instance = getI18n();
  if (!instance) {
    setTimeout(attachWhenReady, 0);
    return;
  }
  if (instance.isInitialized) {
    register();
  } else {
    instance.on('initialized', register);
  }
}

attachWhenReady();
