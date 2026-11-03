import * as React from 'react';

/** Runtime config published by the Helm chart as `config.json` next to the plugin assets. */
export type PluginConfig = { readOnly: boolean };

const CONFIG_URL = '/api/plugins/managed-operators-plugin/config.json';

/**
 * - 404 (older chart, no config.json) → writable, as before.
 * - any other failure → read-only: never expose write actions because the config was unreadable.
 */
export function parsePluginConfig(status: number, body: unknown): PluginConfig {
  if (status === 404) return { readOnly: false };
  if (status < 200 || status >= 300) return { readOnly: true };
  const ro = (body as { readOnly?: unknown } | null)?.readOnly;
  return { readOnly: ro === true || ro === 'true' };
}

let cached: Promise<PluginConfig> | undefined;

function loadPluginConfig(): Promise<PluginConfig> {
  if (!cached) {
    cached = fetch(CONFIG_URL, { cache: 'no-store' })
      .then(async (res) => {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          // 404 pages and empty bodies are not JSON
        }
        return parsePluginConfig(res.status, body);
      })
      .catch(() => ({ readOnly: true }));
  }
  return cached;
}

/**
 * Read-only is a UI-level mode chosen at install time (`plugin.readOnly` in the Helm chart). It
 * hides every write action; real enforcement still belongs to RBAC. Until the config is loaded we
 * report read-only so write buttons never flash.
 */
export function usePluginConfig(): PluginConfig & { loaded: boolean } {
  const [state, setState] = React.useState<{ config: PluginConfig; loaded: boolean }>({
    config: { readOnly: true },
    loaded: false,
  });
  React.useEffect(() => {
    let alive = true;
    void loadPluginConfig().then((config) => {
      if (alive) setState({ config, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, []);
  return { ...state.config, loaded: state.loaded };
}
