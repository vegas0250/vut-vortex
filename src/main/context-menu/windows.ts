import type { WebContents } from 'electron';
import type { ContextMenuItem, ContextMenuQuery } from '../../shared/context-menu';
import { selectionPaths } from '../../shared/context-menu';
import {
  invokeShellHost,
  ownerHandle,
  queryShellHost,
  releaseShellHost,
  shutdownShellHost,
  warmShellHost,
} from '../platform/shell-menu';
import { classicMenuItem, compactShellMenu, paintMenuIcons, windowsUsesModernMenu, withCommandBar } from './modern';
import type { SystemMenuProvider } from './service';
import { shellNodesToItems, systemCommandId } from './shell-nodes';

/** Classic shell menu. One helper process stays up for the life of the app. */
export class WindowsContextMenuProvider implements SystemMenuProvider {
  readonly id = 'windows' as const;
  readonly replacesSession = true;
  private commands = new Map<string, number>();
  private owner: WebContents | null = null;

  bind(sender: WebContents | null): void {
    this.owner = sender;
  }

  async warm(): Promise<void> {
    await warmShellHost();
  }

  async get(query: ContextMenuQuery): Promise<ContextMenuItem[]> {
    this.commands.clear();
    const nodes = await queryShellHost({
      paths: selectionPaths(query.target),
      directory: query.directory,
      extended: query.extended,
      owner: ownerHandle(this.owner),
    });
    if (!nodes) return [];
    const modern = !query.classic && !query.extended && (await windowsUsesModernMenu());
    const shown = modern ? compactShellMenu(nodes) : nodes;
    const items = shellNodesToItems(shown, (command) => {
      const id = systemCommandId();
      this.commands.set(id, command);
      return id;
    });
    if (!modern) return paintMenuIcons(items);
    if (items.length > 0 && !items[items.length - 1]?.separator) {
      items.push({ id: systemCommandId(), label: '', separator: true, source: 'windows-shell' });
    }
    items.push(classicMenuItem());
    return withCommandBar(paintMenuIcons(items));
  }

  async execute(commandId: string): Promise<boolean> {
    const command = this.commands.get(commandId);
    if (command === undefined) return false;
    return invokeShellHost(command);
  }

  forget(commandIds: readonly string[]): void {
    for (const id of commandIds) this.commands.delete(id);
  }

  async release(): Promise<void> {
    this.commands.clear();
    await releaseShellHost();
  }

  async shutdown(): Promise<void> {
    this.commands.clear();
    await shutdownShellHost();
  }
}
