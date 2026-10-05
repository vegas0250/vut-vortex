/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'vui/menu';
import { setTheme } from 'vui/theme';
import type { VMenu } from 'vui/menu';
import { clearOverlays, placeLayer } from 'vui/interaction';
import type { ContextMenuItem } from '../src/shared/context-menu';
import { commandFromMenuEvent, createContextMenuController, paintContextMenu } from '../src/renderer/context-menu';

const items: ContextMenuItem[] = [
  { id: 'vortex:open', label: 'Открыть', source: 'vortex', command: 'vortex:open', icon: 'file' },
  { id: 'vortex:delete', label: 'Удалить', source: 'vortex', command: 'vortex:delete', enabled: false, icon: 'trash-2' },
  {
    id: 'sys:zip',
    label: '7-Zip',
    source: 'windows-shell',
    children: [
      { id: 'sys:extract', label: 'Извлечь', source: 'windows-shell', command: 'sys:extract' },
    ],
  },
];

function menu(): VMenu {
  const host = document.createElement('vui-menu') as VMenu;
  host.setAttribute('label', 'Файл');
  document.body.append(host);
  return host;
}

describe('context menu view', () => {
  beforeEach(() => {
    clearOverlays();
    document.body.replaceChildren();
    document.documentElement.setAttribute('data-vui-theme', 'dark');
  });

  it('opens, closes, and opens again without leaving the previous menu', () => {
    const host = menu();
    const controller = createContextMenuController(host);
    const first = controller.openAt(12, 16, items);
    expect(host.hasAttribute('open')).toBe(true);
    expect(Array.from(host.children).filter((node) => node.tagName === 'VUI-MENU-ITEM').length).toBe(3);
    expect(controller.current(first)).toBe(true);
    controller.close();
    expect(host.hasAttribute('open')).toBe(false);
    expect(controller.current(first)).toBe(false);
    const second = controller.openAt(20, 24, items);
    expect(second).not.toBe(first);
    expect(host.hasAttribute('open')).toBe(true);
    controller.openAt(4, 8, items);
    expect(controller.current(second)).toBe(false);
    expect(host.hasAttribute('open')).toBe(true);
  });

  it('closes on Escape and on a pointer outside the menu', () => {
    const host = menu();
    const controller = createContextMenuController(host);
    const ticket = controller.openAt(10, 10, items);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(host.hasAttribute('open')).toBe(false);
    expect(controller.current(ticket)).toBe(false);

    const next = controller.openAt(10, 10, items);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(host.hasAttribute('open')).toBe(false);
    expect(controller.current(next)).toBe(false);
  });

  it('skips a disabled item, ignores its command, and opens a submenu from the keyboard', () => {
    const host = menu();
    const controller = createContextMenuController(host);
    controller.openAt(12, 16, items);
    const rows = Array.from(host.querySelectorAll('vui-menu-item'));
    expect(rows[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(rows[1]?.getAttribute('icon')).toBe('trash-2');
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(rows[2]);
    const disabled = new MouseEvent('click', { bubbles: true, composed: true });
    rows[1]?.dispatchEvent(disabled);
    expect(commandFromMenuEvent(disabled)).toBeNull();
    rows[2]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    const nested = rows[2]?.querySelector('vui-menu');
    expect(nested?.hasAttribute('open')).toBe(true);
    expect(nested?.querySelector('vui-menu-item')?.getAttribute('label')).toBe('Извлечь');
  });

  it('follows the VUI theme and does not grow a platform-specific menu element', () => {
    const host = menu();
    paintContextMenu(host, items);
    setTheme('light');
    setTheme('dark');
    expect(document.documentElement.getAttribute('data-vui-theme')).toBe('dark');
    expect(host.tagName).toBe('VUI-MENU');
    expect(host.innerHTML).not.toContain('win32');
    expect(host.innerHTML).not.toContain('linux');
    expect(host.style.backgroundColor).toBe('');
  });

  it('keeps a menu inside the viewport when the cursor is at the edge', () => {
    const layer = document.createElement('div');
    Object.defineProperty(layer, 'offsetWidth', { value: 240 });
    Object.defineProperty(layer, 'offsetHeight', { value: 320 });
    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
    placeLayer(layer, { x: 390, y: 280 });
    const left = Number.parseInt(layer.style.left, 10);
    const top = Number.parseInt(layer.style.top, 10);
    expect(left).toBeLessThanOrEqual(400 - 240);
    expect(top).toBeLessThanOrEqual(300 - 320 + 320);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(left + 240).toBeLessThanOrEqual(400);
  });
});
