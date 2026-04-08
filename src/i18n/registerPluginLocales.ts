import i18next from 'i18next';
import * as enNs from '../../locales/en/plugin__managed-operators-plugin.json';

const NS = 'plugin__managed-operators-plugin';
const en = enNs as unknown as Record<string, unknown>;

/**
 * Injects plugin strings into the host Console i18next instance when this chunk loads.
 * Relying only on copied `dist/locales/` is not enough on some ACM/OCP builds: without this,
 * `useTranslation(NS)` returns raw keys (overview_heading, …).
 */
function mergeEnglishInto(lng: string): void {
  i18next.addResourceBundle(lng, NS, en, true, true);
}

function register(): void {
  const langs = new Set<string>(['en', 'en-US']);
  const current = i18next.language;
  if (current) {
    langs.add(current);
    const short = current.split('-')[0];
    if (short) {
      langs.add(short);
    }
  }
  for (const lng of langs) {
    mergeEnglishInto(lng);
  }
}

if (i18next.isInitialized) {
  register();
} else {
  i18next.on('initialized', register);
}
