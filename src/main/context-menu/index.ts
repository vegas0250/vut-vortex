import { app } from 'electron';
import type { WebContents } from 'electron';
import type { ContextMenuQuery } from '../../shared/context-menu';
import { LinuxContextMenuProvider } from './linux';
import { createContextMenuService, createTracer, traceEnabled, type ContextMenuService, type SystemMenuProvider } from './service';
import { WindowsContextMenuProvider } from './windows';

class EmptyMenuProvider implements SystemMenuProvider {
  readonly id = 'none' as const;
  readonly replacesSession = false;
  warm(): Promise<void> {
    return Promise.resolve();
  }
  get(): Promise<never[]> {
    return Promise.resolve([]);
  }
  execute(): Promise<boolean> {
    return Promise.resolve(false);
  }
  forget(): void {
    return undefined;
  }
  release(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

let windows: WindowsContextMenuProvider | null = null;
let service: ContextMenuService | null = null;

function provider(): SystemMenuProvider {
  if (process.platform === 'win32') {
    windows = new WindowsContextMenuProvider();
    return windows;
  }
  if (process.platform === 'linux') return new LinuxContextMenuProvider();
  return new EmptyMenuProvider();
}

export function contextMenuService(): ContextMenuService {
  if (!service) {
    service = createContextMenuService(
      provider(),
      process.platform,
      process.env,
      createTracer(traceEnabled(app.isPackaged, process.env)),
    );
  }
  return service;
}

export function warmContextMenu(): Promise<void> {
  return contextMenuService().warm();
}

export function shutdownContextMenu(): Promise<void> {
  return contextMenuService().shutdown();
}

export function readContextMenu(query: ContextMenuQuery, sender: WebContents | null): ReturnType<ContextMenuService['get']> {
  const current = contextMenuService();
  windows?.bind(sender);
  return current.get(query);
}
