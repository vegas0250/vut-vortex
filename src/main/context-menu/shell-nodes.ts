import { randomBytes } from 'node:crypto';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { ShellMenuNode } from '../../shared/ipc';

export function systemCommandId(): string {
  return `sys:${randomBytes(8).toString('hex')}`;
}

export function sessionId(): string {
  return `ses:${randomBytes(8).toString('hex')}`;
}

/** Turns a shell tree into the shared model. Command indexes never leave this process. */
export function shellNodesToItems(
  nodes: readonly ShellMenuNode[],
  bind: (command: number) => string,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  for (const node of nodes) {
    if (node.separator) {
      if (items.length === 0 || items[items.length - 1]?.separator) continue;
      items.push({
        id: systemCommandId(),
        label: '',
        separator: true,
        source: 'windows-shell',
      });
      continue;
    }
    const children = node.children.length > 0 ? shellNodesToItems(node.children, bind) : [];
    const command = children.length === 0 && node.command !== null ? bind(node.command) : undefined;
    if (!node.label && children.length === 0) continue;
    if (!command && children.length === 0) continue;
    items.push({
      id: command ?? systemCommandId(),
      label: node.label,
      shortcut: node.shortcut || undefined,
      source: 'windows-shell',
      enabled: !node.disabled,
      checked: node.checked || undefined,
      command,
      verb: node.verb || undefined,
      children: children.length > 0 ? children : undefined,
    });
  }
  while (items.at(-1)?.separator) items.pop();
  return items;
}
