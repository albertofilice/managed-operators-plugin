import './login';

const OWN_PLUGIN = 'managed-operators-plugin';

/**
 * Other plugins on the cluster (kubevirt, ...) log "Missing i18n key" errors that are not ours.
 * Ignore those, and fail on anything else (or on any i18n error of this plugin).
 */
export const ownErrors = (windowError?: string | null): string[] =>
  (windowError ?? '')
    .split('; ')
    .map((e) => e.trim())
    .filter(Boolean)
    .filter((e) => {
      const foreignI18n = /^Missing i18n key .* in namespace "plugin__/.test(e);
      return !(foreignI18n && !e.includes(`plugin__${OWN_PLUGIN}`));
    });

export const checkErrors = () =>
  cy.window().then((win) => {
    const errors = ownErrors(win.windowError);
    assert.isTrue(errors.length === 0, errors.join('; '));
  });
