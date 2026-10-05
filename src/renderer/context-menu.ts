import type { VMenu } from 'vui/menu';
import { placeLayer } from 'vui/interaction';
import { menuIcon, type ContextMenuItem } from '../shared/context-menu';

const trace = import.meta.env.DEV;

export function traceMenu(phase: string, started?: number): void {
  if (!trace) return;
  const extra = started === undefined ? '' : ` ${Math.round(performance.now() - started)}ms`;
  console.info(`context-menu ${phase}${extra}`);
}

function paintItem(item: ContextMenuItem): HTMLElement {
  const row = document.createElement('vui-menu-item');
  row.setAttribute('label', item.label);
  if (item.enabled === false) row.setAttribute('disabled', '');
  if (item.checked) row.setAttribute('checked', '');
  if (item.shortcut) row.setAttribute('shortcut', item.shortcut);
  const icon = menuIcon(item.icon);
  if (icon) row.setAttribute('icon', icon);
  if (item.command) row.dataset.command = item.command;
  if (item.bar) {
    row.setAttribute('slot', 'bar');
    row.setAttribute('layout', 'stack');
  }
  if (item.children?.length) {
    const nested = document.createElement('vui-menu');
    nested.setAttribute('slot', 'submenu');
    nested.setAttribute('label', item.label);
    paintContextMenu(nested, item.children);
    row.append(nested);
  }
  return row;
}

/** Paints the shared model with VUI menu items. Platform names never become element types. */
export function paintContextMenu(host: ParentNode, items: readonly ContextMenuItem[]): void {
  const nodes: Node[] = [];
  for (const item of items) {
    if (item.bar) continue;
    nodes.push(item.separator ? document.createElement('hr') : paintItem(item));
  }
  for (const item of items) {
    if (!item.bar || item.separator) continue;
    nodes.push(paintItem(item));
  }
  host.replaceChildren(...nodes);
}

export function commandFromMenuEvent(event: Event): string | null {
  const item = event.composedPath().find((node): node is HTMLElement =>
    node instanceof HTMLElement && node.tagName === 'VUI-MENU-ITEM',
  );
  if (!item || item.hasAttribute('disabled')) return null;
  if (item.querySelector(':scope > vui-menu')) return null;
  const command = item.dataset.command;
  return command || null;
}

export interface ContextMenuController {
  openAt(x: number, y: number, items: readonly ContextMenuItem[]): number;
  replace(ticket: number, items: readonly ContextMenuItem[]): void;
  close(): void;
  current(ticket: number): boolean;
}

/** One menu. A new open closes the previous one. Coordinates go to VUI unchanged. */
export function createContextMenuController(host: VMenu): ContextMenuController {
  let generation = 0;
  let point = { x: 0, y: 0 };

  return {
    openAt(x: number, y: number, items: readonly ContextMenuItem[]): number {
      generation += 1;
      const ticket = generation;
      point = { x, y };
      if (host.hasAttribute('open')) host.close();
      paintContextMenu(host, items);
      host.showAt(x, y);
      traceMenu('rendered');
      return ticket;
    },
    replace(ticket: number, items: readonly ContextMenuItem[]): void {
      if (ticket !== generation || !host.hasAttribute('open')) return;
      paintContextMenu(host, items);
      placeLayer(host, { x: point.x, y: point.y });
      traceMenu('rendered');
    },
    close(): void {
      generation += 1;
      if (host.hasAttribute('open')) host.close();
    },
    current(ticket: number): boolean {
      return ticket === generation && host.hasAttribute('open');
    },
  };
}
