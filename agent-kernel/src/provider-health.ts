import type { ProviderBridge, ProviderId } from './providers/types';

export const DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS = 2_000;

export interface ProviderStatus {
  id: ProviderId;
  authenticated: boolean;
  detail: string;
}

interface ProviderProbe {
  result: Promise<ProviderStatus>;
}

export class ProviderHealthMonitor {
  private readonly probes = new Map<ProviderId, ProviderProbe>();

  constructor(private readonly timeoutMs: number) {}

  status(id: ProviderId, provider: ProviderBridge): Promise<ProviderStatus> {
    const existing = this.probes.get(id);
    if (existing !== undefined) return existing.result;
    const unavailable: ProviderStatus = { id, authenticated: false, detail: 'unavailable' };
    const raw = Promise.resolve()
      .then(() => provider.health())
      .then((health) => {
        if (typeof health?.authenticated !== 'boolean') throw new Error('invalid health');
        return {
          id,
          authenticated: health.authenticated,
          detail: health.authenticated ? 'available' : 'authentication_required',
        } satisfies ProviderStatus;
      })
      .catch(() => unavailable);
    const result = new Promise<ProviderStatus>((resolveStatus) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolveStatus(unavailable);
        }
      }, this.timeoutMs);
      void raw.then((status) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolveStatus(status);
        }
      });
    });
    const probe = { result };
    this.probes.set(id, probe);
    void raw.then(() => {
      if (this.probes.get(id) === probe) this.probes.delete(id);
    });
    return result;
  }
}
