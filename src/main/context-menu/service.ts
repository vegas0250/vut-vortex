import {
  collectCommands,
  composeMenu,
  contextCacheKey,
  desktopId,
  isVortexCommand,
  vortexItems,
  type ContextMenuItem,
  type ContextMenuModel,
  type ContextMenuQuery,
} from '../../shared/context-menu';
import { sessionId } from './shell-nodes';

const ttlMs = 15_000;
const cacheLimit = 32;

export interface SystemMenuProvider {
  readonly id: 'windows' | 'linux' | 'none';
  /** Windows keeps a single shell session. A new selection replaces it. */
  readonly replacesSession: boolean;
  warm(): Promise<void>;
  get(query: ContextMenuQuery): Promise<ContextMenuItem[]>;
  execute(commandId: string): Promise<boolean>;
  forget(commandIds: readonly string[]): void;
  release(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ContextMenuTrace {
  (phase: string, extra?: Record<string, string | number>): void;
}

interface CacheEntry {
  key: string;
  model: ContextMenuModel;
  at: number;
  ids: string[];
}

export interface ContextMenuService {
  warm(): Promise<void>;
  get(query: ContextMenuQuery): Promise<ContextMenuModel>;
  execute(session: string, commandId: string): Promise<boolean>;
  dismiss(): Promise<void>;
  shutdown(): Promise<void>;
}

function now(): number {
  return Date.now();
}

export function createContextMenuService(
  provider: SystemMenuProvider,
  os: string,
  env: Readonly<Record<string, string | undefined>>,
  trace: ContextMenuTrace = () => undefined,
  clock: () => number = now,
): ContextMenuService {
  const desktop = os === 'win32' ? 'windows' : desktopId(env);
  const cache: CacheEntry[] = [];
  let chain: Promise<unknown> = Promise.resolve();

  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = chain.then(run, run);
    chain = next.then(() => undefined, () => undefined);
    return next;
  }

  function drop(entry: CacheEntry): void {
    provider.forget(entry.ids);
  }

  function prune(forceKey?: string): void {
    const alive: CacheEntry[] = [];
    const current = clock();
    for (const entry of cache) {
      const expired = current - entry.at > ttlMs;
      const replaced = provider.replacesSession && forceKey !== undefined && entry.key !== forceKey;
      if (expired || replaced) drop(entry);
      else alive.push(entry);
    }
    cache.length = 0;
    cache.push(...alive);
  }

  function remember(entry: CacheEntry): void {
    prune(entry.key);
    const rest = cache.filter((item) => item.key !== entry.key);
    rest.push(entry);
    while (rest.length > cacheLimit) {
      const removed = rest.shift();
      if (removed) drop(removed);
    }
    cache.length = 0;
    cache.push(...rest);
  }

  function find(key: string): CacheEntry | null {
    prune();
    return cache.find((entry) => entry.key === key) ?? null;
  }

  async function get(query: ContextMenuQuery): Promise<ContextMenuModel> {
    return exclusive(async () => {
      const started = clock();
      trace('requested');
      const key = contextCacheKey(os, desktop, query);
      const cached = find(key);
      if (cached) {
        const totalMs = Math.max(0, clock() - started);
        trace('normalized', { cached: 1 });
        trace('total duration', { ms: totalMs });
        return {
          ...cached.model,
          timing: { cached: true, providerMs: 0, systemMs: 0, normalizeMs: 0, totalMs },
        };
      }
      trace('provider started');
      const providerStarted = clock();
      let system: ContextMenuItem[] = [];
      let failed = false;
      if (query.kind === 'local') {
        try {
          system = await provider.get(query);
        } catch (error) {
          console.error(error);
          failed = true;
          system = [];
        }
      }
      const systemMs = Math.max(0, clock() - providerStarted);
      trace('system menu obtained', { ms: systemMs });
      const normalizeStarted = clock();
      const items = composeMenu(vortexItems(query), system);
      const normalizeMs = Math.max(0, clock() - normalizeStarted);
      const ids = collectCommands(items).filter((id) => !isVortexCommand(id));
      const totalMs = Math.max(0, clock() - started);
      const model: ContextMenuModel = {
        items,
        session: sessionId(),
        timing: {
          cached: false,
          providerMs: systemMs,
          systemMs,
          normalizeMs,
          totalMs,
        },
      };
      if (!failed) remember({ key, model, at: clock(), ids });
      trace('normalized', { cached: 0, ms: normalizeMs });
      trace('total duration', { ms: totalMs });
      return model;
    });
  }

  async function execute(session: string, commandId: string): Promise<boolean> {
    return exclusive(async () => {
      if (!session || !commandId || isVortexCommand(commandId) || commandId.length > 80) return false;
      const entry = cache.find((item) => item.model.session === session);
      if (!entry || !entry.ids.includes(commandId)) return false;
      const ran = await provider.execute(commandId);
      if (ran) {
        drop(entry);
        const index = cache.indexOf(entry);
        if (index >= 0) cache.splice(index, 1);
      }
      return ran;
    });
  }

  async function dismiss(): Promise<void> {
    return exclusive(async () => {
      for (const entry of cache) drop(entry);
      cache.length = 0;
      await provider.release();
    });
  }

  return {
    warm: () => provider.warm(),
    get,
    execute,
    dismiss,
    shutdown: () => provider.shutdown(),
  };
}

export function traceEnabled(packaged: boolean, env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.VORTEX_CONTEXT_MENU_TRACE === '0') return false;
  if (env.VORTEX_CONTEXT_MENU_TRACE === '1') return true;
  return !packaged;
}

export function createTracer(enabled: boolean): ContextMenuTrace {
  if (!enabled) return () => undefined;
  return (phase, extra) => {
    if (extra) console.info(`context-menu ${phase}`, extra);
    else console.info(`context-menu ${phase}`);
  };
}
