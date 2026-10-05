import 'vui/shell';
import 'vui/toolbar';
import 'vui/status-bar';
import 'vui/data-grid';
import 'vui/button';
import 'vui/input';
import 'vui/dialog';
import 'vui/text';
import 'vui/empty';
import 'vui/tabs';
import 'vui/menu';
import { registerIcon } from 'vui/icon';
import { registerMenuIcons } from './menu-icons';
import 'vui/icon-button';
import 'vui/toggle';
import 'vui/progress';
import 'vui/path-bar';
import { CommandRegistry, ShortcutRegistry, writeClipboard } from 'vui/interaction';
import type { VButton } from 'vui/button';
import type { VIconButton } from 'vui/icon-button';
import type { VDataGrid, VDataGridRow } from 'vui/data-grid';
import type { VDialog } from 'vui/dialog';
import type { VInput } from 'vui/input';
import type { VPathBar } from 'vui/path-bar';
import type { VMenu } from 'vui/menu';
import type { VToggle } from 'vui/toggle';
import { mountChrome, restoreTheme } from './chrome';
import {
  clipLabel,
  crumbs,
  displayName,
  formatModified,
  formatSize,
  iconFor,
  isNetworkRoot,
  placeIcon,
  kindLabel,
  parentPath,
  pathTitle,
  type DirectoryPage,
  type FileEntry,
  type Place,
} from '../shared/files';
import { classifySelection, systemMenuItems, type ContextMenuItem, type ContextMenuModel, type ContextMenuQuery } from '../shared/context-menu';
import type { OpenedSource, Result, SourceKind, SourceRequest } from '../shared/ipc';
import { commandFromMenuEvent, createContextMenuController, traceMenu } from './context-menu';

interface Session extends SourceRequest {
  id: string;
  history: string[];
  historyIndex: number;
}

const filledFolder = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 6.75A2.75 2.75 0 0 1 5.75 4h3.19c.6 0 1.17.24 1.59.66l1.06 1.06c.1.1.24.16.38.16h6.28A2.75 2.75 0 0 1 21 8.63v8.62A2.75 2.75 0 0 1 18.25 21H5.75A2.75 2.75 0 0 1 3 18.25V6.75Z"/></svg>`;
const windowsMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M2 3h9.2v8.2H2V3zm10.8 0H22v8.2h-9.2V3zM2 12.8h9.2V21H2v-8.2zm10.8 0H22V21h-9.2v-8.2z"/></svg>`;
const penguinMark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.6c-1.5.7-2.6 2.1-3 3.8-.2.8-.7 1.5-1.5 2-1.6 1-2.7 2.7-2.7 4.8 0 3.6 2.8 6.4 6.5 6.6l-.5 2c-.1.5.2.9.7.9h1c.5 0 .8-.4.7-.9l-.5-2c3.7-.2 6.5-3 6.5-6.6 0-2.1-1.1-3.8-2.7-4.8-.8-.5-1.3-1.2-1.5-2-.4-1.7-1.5-3.1-3-3.8-.4-.2-.8-.2-1.2 0z"/><path fill="currentColor" d="M7.1 7.4c1.1-1.5 2.6-2.3 4-2.2-.6 1.3-.4 2.6.3 3.6-1.4.3-2.7.9-3.8 1.8-.3-.9-.4-2-.5-3.2zM16.9 7.4c-1.1-1.5-2.6-2.3-4-2.2.6 1.3.4 2.6-.3 3.6 1.4.3 2.7.9 3.8 1.8.3-.9.4-2 .5-3.2z"/><circle cx="9.7" cy="10.6" r=".7" fill="var(--vui-color-background)"/><circle cx="14.3" cy="10.6" r=".7" fill="var(--vui-color-background)"/><path fill="var(--vui-color-background)" d="M12 12.4c1.5 0 2.6 1 2.9 2 .1.4-.2.7-.6.7h-4.6c-.4 0-.7-.3-.6-.7.3-1 1.4-2 2.9-2z"/></svg>`;
const osMark = navigator.userAgent.includes('Windows') ? 'os-windows' : 'os-linux';

function menuNotice(id: string, label: string, icon?: string): ContextMenuItem {
  return { id, label, source: 'extension', enabled: false, icon };
}

function visibleSystemMenu(items: readonly ContextMenuItem[]): ContextMenuItem[] {
  const system = systemMenuItems(items);
  return system.length ? system : [menuNotice('system-empty', 'Нет системных команд')];
}

export function mountManager(): void {
  registerMenuIcons();
  registerIcon('folder', filledFolder);
  registerIcon('os-windows', windowsMark);
  registerIcon('os-linux', penguinMark);
  restoreTheme();
  const app = document.querySelector('#app');
  if (!app) throw new Error('Не найдено окно приложения');
  const bar = mountChrome(app, 'Vortex', osMark, window.vortex);

  const shell = document.createElement('vui-shell');
  shell.setAttribute('label', 'Vortex');
  shell.setAttribute('collapsed', '');
  shell.setAttribute('nav-label', 'Места');
  shell.setAttribute('aside-label', 'Вторая панель');
  shell.setAttribute('skip-label', 'К списку файлов');
  shell.setAttribute('aside-collapsed', '');
  shell.setAttribute('resize-label', 'Ширина панели');
  shell.setAttribute('aside-resize-label', 'Ширина панелей');
  shell.setAttribute('aside-expand-label', 'Открыть панель');
  shell.setAttribute('aside-collapse-label', 'Закрыть панель');

  const commandBar = document.createElement('vui-toolbar');
  commandBar.setAttribute('slot', 'toolbar');
  commandBar.setAttribute('label', 'Команды');

  function button(label: string, icon: string, slot = 'start'): VButton {
    const element = document.createElement('vui-button') as VButton;
    element.setAttribute('variant', 'ghost');
    element.setAttribute('size', 'small');
    if (slot) element.setAttribute('slot', slot);
    const mark = document.createElement('vui-icon');
    mark.setAttribute('slot', 'icon');
    mark.setAttribute('name', icon);
    element.append(mark, document.createTextNode(label));
    return element;
  }

  function iconButton(label: string, icon: string): VIconButton {
    const element = document.createElement('vui-icon-button') as VIconButton;
    element.setAttribute('variant', 'ghost');
    element.setAttribute('size', 'medium');
    element.setAttribute('slot', 'start');
    element.setAttribute('label', label);
    element.setAttribute('name', icon);
    return element;
  }

  interface PaneNav {
    back: VIconButton;
    forward: VIconButton;
    up: VIconButton;
    refresh: VIconButton;
    links: HTMLElement;
    menus: Map<string, VMenu>;
    side: 'left' | 'right';
    path: VPathBar;
    bar: HTMLElement;
  }

  function makePaneNav(label: string, which: 'left' | 'right'): PaneNav {
    const bar = document.createElement('vui-toolbar');
    bar.setAttribute('label', label);
    const back = iconButton('Назад', 'arrow-left');
    const forward = iconButton('Вперёд', 'arrow-right');
    const up = iconButton('Вверх', 'arrow-up');
    const refresh = iconButton('Обновить', 'refresh-cw');
    const pathBox = document.createElement('vui-path-bar') as VPathBar;
    pathBox.setAttribute('label', 'Адрес');
    const links = document.createElement('div');
    links.className = 'nav-links';
    bar.append(back, forward, up, refresh, pathBox, links);
    return { back, forward, up, refresh, links, menus: new Map(), side: which, path: pathBox, bar };
  }

  const leftNav = makePaneNav('Навигация', 'left');
  const rightNav = makePaneNav('Навигация второй панели', 'right');
  const viewButton = button('Показать', 'eye', 'end');
  viewButton.setAttribute('aria-haspopup', 'menu');
  viewButton.setAttribute('aria-expanded', 'false');
  const caret = document.createElement('vui-icon');
  caret.setAttribute('name', 'chevron-down');
  caret.style.color = 'var(--vui-color-text-muted)';
  viewButton.append(caret);
  const viewMenu = document.createElement('vui-menu') as VMenu;
  viewMenu.setAttribute('label', 'Показать');
  const hiddenItem = document.createElement('vui-menu-item');
  hiddenItem.setAttribute('label', 'Скрытые');
  const systemItem = document.createElement('vui-menu-item');
  systemItem.setAttribute('label', 'Системные файлы');
  const extensionItem = document.createElement('vui-menu-item');
  extensionItem.setAttribute('label', 'Расширения файлов');
  extensionItem.setAttribute('checked', '');
  viewMenu.append(hiddenItem, systemItem, extensionItem);
  const previewToggle = document.createElement('vui-toggle') as VToggle;
  previewToggle.className = 'preview-toggle';
  previewToggle.setAttribute('slot', 'end');
  previewToggle.setAttribute('aria-label', 'Предпросмотр');
  const previewIcon = document.createElement('vui-icon');
  previewIcon.setAttribute('name', 'eye');
  previewToggle.append(previewIcon, document.createTextNode('Предпросмотр'));
  commandBar.append(previewToggle, viewButton);

  interface ResourceBar {
    bar: HTMLElement;
    icon: HTMLElement;
    name: HTMLElement;
    detail: HTMLElement;
  }

  function makeResource(which: 'left' | 'right'): ResourceBar {
    const bar = document.createElement('div');
    bar.className = 'resource';
    const icon = document.createElement('vui-icon');
    icon.setAttribute('name', 'hard-drive');
    const copy = document.createElement('div');
    copy.className = 'resource-copy';
    const name = document.createElement('span');
    name.className = 'resource-name';
    name.textContent = 'Источник не выбран';
    const detail = document.createElement('span');
    detail.className = 'resource-detail';
    copy.append(name, detail);
    const change = button('Сменить', 'refresh-cw', '');
    change.addEventListener('click', () => {
      void window.vortex.openSources(which === 'right' ? 'pane' : 'active');
    });
    bar.append(icon, copy, change);
    return { bar, icon, name, detail };
  }

  function makeHead(resource: ResourceBar, navigation: PaneNav): HTMLElement {
    const head = document.createElement('div');
    head.className = 'pane-head';
    head.append(resource.bar, navigation.bar);
    return head;
  }

  const leftResource = makeResource('left');
  const rightResource = makeResource('right');

  const stage = document.createElement('div');
  stage.className = 'stage file-stage';
  const tabs = document.createElement('vui-tabs');
  tabs.setAttribute('slot', 'tabs');
  tabs.setAttribute('label', 'Вкладки');
  const addTab = document.createElement('vui-icon-button');
  addTab.setAttribute('slot', 'action');
  addTab.setAttribute('name', 'plus');
  addTab.setAttribute('label', 'Новая вкладка');
  addTab.setAttribute('variant', 'ghost');
  addTab.setAttribute('size', 'small');
  tabs.append(addTab);
  bar.append(tabs);
  function makeGrid(label: string): VDataGrid {
    const view = document.createElement('vui-data-grid') as VDataGrid;
    view.setAttribute('label', label);
    view.setAttribute('empty-label', 'Каталог пуст');
    view.multiple = true;
    view.fill = true;
    view.columns = [
      { key: 'name', title: 'Имя', iconKey: 'icon' },
      { key: 'kind', title: 'Тип', priority: 'secondary' },
      { key: 'size', title: 'Размер', align: 'end', priority: 'secondary' },
      { key: 'modified', title: 'Изменён', priority: 'secondary' },
    ];
    return view;
  }

  function makeOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'pane-overlay';
    overlay.hidden = true;
    const label = document.createElement('span');
    label.textContent = 'Чтение каталога…';
    overlay.append(label);
    return overlay;
  }

  const leftProgress = document.createElement('vui-progress');
  leftProgress.setAttribute('label', 'Загрузка сети');
  leftProgress.hidden = true;
  const leftOverlay = makeOverlay();
  const grid = makeGrid('Файлы');
  const listing = document.createElement('div');
  listing.className = 'listing';
  const preview = document.createElement('aside');
  preview.className = 'preview';
  preview.setAttribute('aria-label', 'Предпросмотр');
  preview.hidden = true;
  listing.append(grid, preview);
  const empty = document.createElement('vui-empty');
  empty.setAttribute('heading', 'Нет каталога');
  empty.setAttribute('label', 'Не удалось открыть расположение');
  const leftBody = document.createElement('div');
  leftBody.className = 'pane-body';
  leftBody.append(listing, empty, leftOverlay);
  stage.append(makeHead(leftResource, leftNav), leftProgress, leftBody);
  empty.hidden = true;
  stage.toggleAttribute('data-active', true);

  const rightStage = document.createElement('div');
  rightStage.className = 'stage file-stage';
  rightStage.setAttribute('slot', 'aside');
  const rightProgress = document.createElement('vui-progress');
  rightProgress.setAttribute('label', 'Загрузка сети');
  rightProgress.hidden = true;
  const rightOverlay = makeOverlay();
  const rightGrid = makeGrid('Вторая панель');
  const rightListing = document.createElement('div');
  rightListing.className = 'listing';
  const rightPreview = document.createElement('aside');
  rightPreview.className = 'preview';
  rightPreview.setAttribute('aria-label', 'Предпросмотр');
  rightPreview.hidden = true;
  rightListing.append(rightGrid, rightPreview);
  const rightEmpty = document.createElement('vui-empty');
  rightEmpty.setAttribute('heading', 'Нет каталога');
  rightEmpty.setAttribute('label', 'Не удалось открыть расположение');
  const rightBody = document.createElement('div');
  rightBody.className = 'pane-body';
  rightBody.append(rightListing, rightEmpty, rightOverlay);
  rightStage.append(makeHead(rightResource, rightNav), rightProgress, rightBody);
  rightEmpty.hidden = true;

  const status = document.createElement('vui-status-bar');
  status.setAttribute('slot', 'footer');
  status.setAttribute('label', 'Состояние');
  const statusMain = document.createElement('span');
  const statusEnd = document.createElement('span');
  statusEnd.setAttribute('slot', 'end');
  status.append(statusMain, statusEnd);

  const dialog = document.createElement('vui-dialog') as VDialog;
  const dialogText = document.createElement('vui-text');
  const dialogInput = document.createElement('vui-input') as VInput;
  const dialogCancel = button('Отмена', 'x', 'footer');
  dialogCancel.setAttribute('variant', 'secondary');
  const dialogOk = button('ОК', 'check', 'footer');
  dialogOk.setAttribute('variant', 'primary');
  dialog.append(dialogText, dialogInput, dialogCancel, dialogOk);

  shell.append(commandBar, stage, status, rightStage, dialog);
  document.body.append(viewMenu);
  app.append(shell);
  shell.addEventListener('aside-toggle', (event) => {
    const opening = event instanceof CustomEvent && event.detail?.opening === true;
    if (!opening || right.source) return;
    event.preventDefault();
    void window.vortex.openSources('pane');
  });

  const sessions: Session[] = [];
  let activeId = '';
  let page: DirectoryPage | null = null;
  let side: 'left' | 'right' = 'left';
  const right = {
    page: null as DirectoryPage | null,
    history: [] as string[],
    historyIndex: 0,
    source: null as SourceRequest | null,
  };
  let showHidden = false;
  let showSystem = false;
  let showExtensions = true;
  let showPreview = false;
  let busy = false;
  let loadSerial = 0;
  let blocking = 0;
  let leftTicket = 0;
  let rightTicket = 0;
  let held: { mode: 'copy' | 'move'; paths: string[] } | null = null;
  let menuMemory: { key: string; at: number; model: ContextMenuModel } | null = null;
  let menuSerial = 0;
  let menuAction: { which: 'left' | 'right'; entries: FileEntry[]; session: string; x: number; y: number } | null = null;
  let closeContextMenu = (): void => undefined;
  let leaveMenuContext = (): void => undefined;
  let openFileMenu: (x: number, y: number, items: ContextMenuModel['items']) => number = () => 0;
  let replaceFileMenu: (ticket: number, items: ContextMenuModel['items']) => void = () => undefined;
  const overlayTimer = { left: 0, right: 0 };
  let computerName = 'Этот компьютер';

  function active(): Session | undefined {
    return sessions.find((session) => session.id === activeId);
  }

  function localSession(): Session | undefined {
    const session = active();
    return session?.kind === 'local' ? session : undefined;
  }

  function unwrap<T>(result: Result<T>): T {
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }

  function currentPage(): DirectoryPage | null {
    return side === 'right' ? right.page : page;
  }

  function currentGrid(): VDataGrid {
    return side === 'right' ? rightGrid : grid;
  }

  function canChange(entry: FileEntry): boolean {
    return entry.name !== '.' && entry.name !== '..';
  }

  function selectedEntries(): FileEntry[] {
    const current = currentPage();
    if (!current) return [];
    const ids = new Set(currentGrid().selectedIds);
    return current.entries.filter((entry) => ids.has(entry.path));
  }

  function syncCommands(): void {
    const session = active();
    const local = session?.kind === 'local';
    const selected = selectedEntries();
    const mutable = selected.filter(canChange);
    leftNav.back.disabled = busy || !local || !session || session.historyIndex <= 0;
    leftNav.forward.disabled = busy || !local || !session || session.historyIndex >= session.history.length - 1;
    leftNav.up.disabled = busy || !local || !page?.parent;
    leftNav.refresh.disabled = busy || !local || !page;
    leftNav.path.disabled = !local;
    rightNav.back.disabled = busy || right.historyIndex <= 0;
    rightNav.forward.disabled = busy || right.historyIndex >= right.history.length - 1;
    rightNav.up.disabled = busy || !right.page?.parent;
    rightNav.refresh.disabled = busy || !right.page;
    rightNav.path.disabled = !right.page;
    for (const link of Array.from(leftNav.links.querySelectorAll('vui-button'))) link.toggleAttribute('disabled', busy || !local);
    for (const link of Array.from(rightNav.links.querySelectorAll('vui-button'))) link.toggleAttribute('disabled', busy);
    viewButton.disabled = busy || !local;
    previewToggle.disabled = busy || !local;
    const flags: Record<string, boolean> = {
      'file.open': Boolean(local && selected.length === 1 && !busy),
      'file.rename': Boolean(local && mutable.length === 1 && !busy),
      'file.copy': Boolean(local && mutable.length > 0 && !busy),
      'file.move': Boolean(local && mutable.length > 0 && !busy),
      'file.delete': Boolean(local && mutable.length > 0 && !busy),
    };
    for (const [id, enabled] of Object.entries(flags)) {
      const command = commands.get(id);
      if (command) command.enabled = enabled;
    }
  }

  function tabIcon(kind: Session['kind']): string {
    if (kind === 'local') return osMark;
    if (kind === 'ssh') return 'terminal';
    if (kind === 'ftp') return 'globe';
    return 'server';
  }

  function fillTab(tab: HTMLElement, session: Session): void {
    const icon = document.createElement('vui-icon');
    icon.setAttribute('name', tabIcon(session.kind));
    const label = document.createElement('span');
    label.textContent = session.kind === 'local' ? pathTitle(session.path) : session.label;
    tab.replaceChildren(icon, label);
  }

  function renderTabs(): void {
    tabs.replaceChildren();
    for (const session of sessions) {
      const tab = document.createElement('vui-tab');
      tab.dataset.id = session.id;
      fillTab(tab, session);
      tab.setAttribute('close-label', 'Закрыть');
      tab.setAttribute('closable', '');
      if (session.id === activeId) tab.setAttribute('selected', '');
      tabs.append(tab);
    }
    tabs.append(addTab);
  }

  function showAddress(field: VPathBar, target: string): void {
    field.value = target;
    field.crumbs = crumbs(target);
    paintQuickLinks();
  }

  interface LinkGroup {
    id: string;
    label: string;
    icon: string;
    places: Place[];
  }

  let linkGroups: LinkGroup[] = [];

  function fillPlacesMenu(menu: VMenu, current: string): void {
    menu.replaceChildren();
    if (!linkGroups.length) {
      const empty = document.createElement('vui-menu-item');
      empty.setAttribute('label', 'Нет ссылок');
      empty.setAttribute('disabled', '');
      menu.append(empty);
      return;
    }
    linkGroups.forEach((group, index) => {
      if (index > 0) menu.append(document.createElement('hr'));
      const heading = document.createElement('vui-menu-item');
      heading.className = 'nav-heading';
      heading.setAttribute('label', group.label);
      heading.setAttribute('icon', group.icon);
      heading.setAttribute('disabled', '');
      heading.dataset.heading = group.id;
      menu.append(heading);
      for (const place of group.places) {
        const item = document.createElement('vui-menu-item');
        item.setAttribute('label', place.label);
        item.dataset.path = place.path;
        const icon = placeIcon(place.id);
        if (icon) item.setAttribute('icon', icon);
        if (place.path === current) item.setAttribute('checked', '');
        menu.append(item);
      }
    });
  }

  function markCurrentPlace(menu: VMenu, current: string): void {
    for (const item of Array.from(menu.querySelectorAll<HTMLElement>('vui-menu-item'))) {
      const path = item.dataset.path ?? '';
      item.toggleAttribute('checked', path.length > 0 && path === current);
    }
  }

  function closeLinkMenus(): void {
    for (const nav of [leftNav, rightNav]) {
      for (const menu of nav.menus.values()) {
        if (menu.hasAttribute('open')) menu.close();
      }
    }
  }

  function paintPaneLinks(nav: PaneNav, current: string): void {
    const signature = linkGroups.map((group) => `${group.id}:${group.label}:${group.places.map((place) => `${place.path}\u0000${place.label}`).join('|')}`).join(';');
    let menu = nav.menus.get('places');
    if (nav.links.dataset.signature !== signature || !menu) {
      nav.links.dataset.signature = signature;
      for (const open of nav.menus.values()) open.remove();
      nav.menus.clear();
      nav.links.replaceChildren();
      const trigger = document.createElement('vui-button') as VButton;
      trigger.setAttribute('variant', 'ghost');
      trigger.setAttribute('size', 'small');
      trigger.setAttribute('aria-label', 'Переходы');
      trigger.setAttribute('title', 'Переходы');
      trigger.setAttribute('aria-haspopup', 'menu');
      trigger.setAttribute('aria-expanded', 'false');
      const mark = document.createElement('vui-icon');
      mark.setAttribute('slot', 'icon');
      mark.setAttribute('name', osMark);
      const caret = document.createElement('vui-icon');
      caret.setAttribute('name', 'chevron-down');
      caret.style.color = 'var(--vui-color-text-muted)';
      trigger.append(mark, caret);
      menu = document.createElement('vui-menu') as VMenu;
      menu.setAttribute('label', 'Переходы');
      document.body.append(menu);
      nav.menus.set('places', menu);
      menu.addEventListener('close', () => trigger.setAttribute('aria-expanded', 'false'));
      menu.addEventListener('click', (event) => {
        const item = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === 'VUI-MENU-ITEM');
        const target = item?.dataset.path;
        if (!target || item.dataset.heading || item.hasAttribute('disabled')) return;
        focusSide(nav.side);
        void openDirectory(target, true);
      });
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeContextMenu();
        closeLinkMenus();
        trigger.setAttribute('aria-expanded', 'true');
        const rect = trigger.getBoundingClientRect();
        window.setTimeout(() => menu?.showAt(rect.left, rect.bottom), 0);
      });
      nav.links.append(trigger);
      fillPlacesMenu(menu, current);
      return;
    }
    markCurrentPlace(menu, current);
  }

  function paintQuickLinks(): void {
    paintPaneLinks(leftNav, page?.path ?? '');
    paintPaneLinks(rightNav, right.page?.path ?? '');
  }

  function renderSidebar(index: { places: Place[]; roots: Place[]; computer: string }, current: string): void {
    computerName = index.computer;
    const quick = index.places.filter((place) => !place.group && place.id !== 'network' && place.id !== 'yandex');
    linkGroups = [
      { id: 'quick', label: 'Быстрые ссылки', icon: 'pin', places: quick },
      { id: 'computer', label: index.computer || 'Компьютер', icon: 'hard-drive', places: index.roots },
      { id: 'network', label: 'Сеть', icon: 'globe', places: index.places.filter((place) => place.id === 'network') },
      { id: 'linux', label: 'Linux', icon: 'terminal', places: index.places.filter((place) => place.group === 'linux') },
      { id: 'yandex', label: 'Яндекс.Диск', icon: 'server', places: index.places.filter((place) => place.id === 'yandex') },
    ].filter((group) => group.places.length > 0);
    paintPaneLinks(leftNav, page?.path || current);
    paintPaneLinks(rightNav, right.page?.path ?? '');
  }

  function focusSide(next: 'left' | 'right'): void {
    side = next;
    stage.toggleAttribute('data-active', next === 'left');
    rightStage.toggleAttribute('data-active', next === 'right');
    syncCommands();
  }

  function rowsFor(entries: readonly FileEntry[]): VDataGridRow[] {
    return entries.map((entry) => {
      const shown = clipLabel(displayName(entry.name, entry.kind, showExtensions));
      return {
        id: entry.path,
        icon: iconFor(entry),
        name: shown,
        nameTitle: entry.name,
        kind: kindLabel(entry.kind),
        size: formatSize(entry.size, entry.kind),
        modified: formatModified(entry.modified),
      };
    });
  }

  function previewText(value: string, caption = false): HTMLElement {
    const node = document.createElement('vui-text');
    if (caption) {
      node.setAttribute('variant', 'label');
      node.setAttribute('muted', '');
    } else {
      node.className = 'preview-value';
    }
    node.textContent = value;
    return node;
  }

  function paintPreview(host: HTMLElement, entries: readonly FileEntry[], directory: string): void {
    host.replaceChildren();
    if (!showPreview) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    if (!entries.length) {
      host.append(previewText('Нет выбранного файла', true));
      return;
    }
    if (entries.length > 1) {
      host.append(previewText(`Выбрано: ${entries.length}`, true));
      for (const entry of entries) host.append(previewText(entry.name));
      return;
    }
    const entry = entries[0];
    if (!entry) return;
    host.append(previewText('Имя', true), previewText(entry.name));
    host.append(previewText('Тип', true), previewText(kindLabel(entry.kind)));
    const size = formatSize(entry.size, entry.kind);
    if (size) host.append(previewText('Размер', true), previewText(size));
    const modified = formatModified(entry.modified);
    if (modified) host.append(previewText('Изменён', true), previewText(modified));
    host.append(previewText('Путь', true), previewText(entry.name === '.' ? directory : entry.path));
  }

  function syncPreview(which: 'left' | 'right'): void {
    const host = which === 'right' ? rightPreview : preview;
    const pane = which === 'right' ? rightListing : listing;
    const view = which === 'right' ? rightGrid : grid;
    const source = which === 'right' ? right.page : page;
    if (pane.hidden || view.hidden || !source) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    const ids = new Set(view.selectedIds);
    paintPreview(
      host,
      source.entries.filter((entry) => ids.has(entry.path)),
      source.path,
    );
  }

  function describeResource(source: SourceRequest | null): { icon: string; name: string; detail: string } {
    if (!source) return { icon: 'hard-drive', name: 'Источник не выбран', detail: 'Выберите ресурс' };
    if (source.kind === 'local') return { icon: 'hard-drive', name: 'Локальный', detail: computerName };
    const title = source.kind === 'ssh' ? 'SSH' : source.kind === 'ftp' ? 'FTP' : 'SFTP';
    const icon = source.kind === 'ssh' ? 'terminal' : source.kind === 'ftp' ? 'globe' : 'server';
    return { icon, name: title, detail: source.user ? `${source.user}@${source.host}` : source.host };
  }

  function paintResource(which: 'left' | 'right'): void {
    const view = which === 'right' ? rightResource : leftResource;
    const source = which === 'right' ? right.source : (active() ?? null);
    const described = describeResource(source);
    view.icon.setAttribute('name', described.icon);
    view.name.textContent = described.name;
    view.detail.textContent = described.detail;
  }

  function renderPage(next: DirectoryPage): void {
    page = next;
    const session = localSession();
    if (session) {
      session.path = next.path;
      const tab = tabs.querySelector(`vui-tab[data-id="${CSS.escape(session.id)}"]`);
      const label = tab?.querySelector('span');
      if (label) label.textContent = pathTitle(next.path);
    }
    showAddress(leftNav.path, next.path);
    grid.rows = rowsFor(next.entries);
    empty.hidden = true;
    listing.hidden = false;
    grid.hidden = false;
    const hiddenCount = next.entries.filter((entry) => entry.hidden).length;
    statusMain.textContent = `${next.entries.length} объектов${hiddenCount ? `, скрытых ${hiddenCount}` : ''}`;
    statusEnd.textContent = next.path;
    syncPreview('left');
    paintResource('left');
    syncCommands();
  }

  function renderSide(next: DirectoryPage): void {
    right.page = next;
    showAddress(rightNav.path, next.path);
    rightGrid.rows = rowsFor(next.entries);
    rightEmpty.hidden = true;
    rightListing.hidden = false;
    rightGrid.hidden = false;
    if (side === 'right') {
      const hiddenCount = next.entries.filter((entry) => entry.hidden).length;
      statusMain.textContent = `${next.entries.length} объектов${hiddenCount ? `, скрытых ${hiddenCount}` : ''}`;
      statusEnd.textContent = next.path;
    }
    syncPreview('right');
    paintResource('right');
    syncCommands();
  }

  function showRemote(session: Session): void {
    page = null;
    grid.rows = [];
    listing.hidden = true;
    grid.hidden = true;
    preview.hidden = true;
    empty.hidden = false;
    empty.setAttribute('heading', session.label);
    empty.setAttribute(
      'label',
      `Источник ${session.kind.toUpperCase()} выбран. Каталог этой версии открывается только локально, провайдер ${session.user}@${session.host}:${session.port} подключится отдельно.`,
    );
    showAddress(leftNav.path, session.path);
    paintResource('left');
    statusMain.textContent = session.label;
    statusEnd.textContent = `${session.user}@${session.host}:${session.port}`;
    syncCommands();
  }

  function showError(message: string): void {
    statusMain.textContent = message;
    const view = side === 'right' ? rightEmpty : empty;
    const fileGrid = currentGrid();
    const pane = side === 'right' ? rightListing : listing;
    view.setAttribute('heading', 'Нет каталога');
    view.setAttribute('label', message);
    view.hidden = false;
    pane.hidden = true;
    fileGrid.hidden = true;
    syncPreview(side);
    syncCommands();
  }

  async function openInPane(source: SourceRequest): Promise<void> {
    shell.removeAttribute('aside-collapsed');
    right.history = [];
    right.historyIndex = 0;
    right.page = null;
    right.source = source;
    focusSide('right');
    if (source.kind !== 'local') {
      rightGrid.rows = [];
      rightListing.hidden = true;
      rightGrid.hidden = true;
      rightPreview.hidden = true;
      rightEmpty.hidden = false;
      rightEmpty.setAttribute('heading', source.label);
      rightEmpty.setAttribute(
        'label',
        `Источник ${source.kind.toUpperCase()} выбран. Каталог этой версии открывается только локально, провайдер ${source.user}@${source.host}:${source.port} подключится отдельно.`,
      );
      showAddress(rightNav.path, source.path);
      paintResource('right');
      statusMain.textContent = source.label;
      statusEnd.textContent = `${source.user}@${source.host}:${source.port}`;
      syncCommands();
      return;
    }
    await openSide(source.path, true);
  }

  function beginLoad(which: 'left' | 'right', target: string): number {
    const network = isNetworkRoot(target);
    const bar = which === 'right' ? rightProgress : leftProgress;
    const overlay = which === 'right' ? rightOverlay : leftOverlay;
    window.clearTimeout(overlayTimer[which]);
    overlay.hidden = network;
    const ticket = ++loadSerial;
    if (which === 'right') rightTicket = ticket;
    else leftTicket = ticket;
    if (network) {
      bar.hidden = false;
      if (side === which) statusMain.textContent = 'Чтение сети…';
      if (blocking !== 0) {
        blocking = 0;
        busy = false;
        syncCommands();
      }
      return ticket;
    }
    bar.hidden = true;
    blocking = ticket;
    busy = true;
    syncCommands();
    if (side === which) statusMain.textContent = 'Чтение каталога…';
    overlay.hidden = false;
    return ticket;
  }

  function finishLoad(which: 'left' | 'right', ticket: number, network: boolean): boolean {
    const current = which === 'right' ? rightTicket : leftTicket;
    if (ticket !== current) return false;
    (which === 'right' ? rightProgress : leftProgress).hidden = true;
    window.clearTimeout(overlayTimer[which]);
    (which === 'right' ? rightOverlay : leftOverlay).hidden = true;
    if (!network && blocking === ticket) {
      blocking = 0;
      busy = false;
      syncCommands();
    }
    return true;
  }

  async function openSide(target: string, record: boolean): Promise<void> {
    leaveMenuContext();
    const network = isNetworkRoot(target);
    const ticket = beginLoad('right', target);
    let failed = '';
    try {
      const next = unwrap(await window.vortex.list(target, showHidden, showSystem));
      if (ticket !== rightTicket) return;
      const current = right.source;
      right.source = {
        kind: 'local',
        label: current?.kind === 'local' ? current.label : 'Локальный',
        path: next.path,
        host: '',
        port: 0,
        user: '',
      };
      if (record && right.history[right.historyIndex] !== next.path) {
        right.history.splice(right.historyIndex + 1);
        right.history.push(next.path);
        right.historyIndex = right.history.length - 1;
      } else if (!right.history.length) {
        right.history = [next.path];
        right.historyIndex = 0;
      }
      renderSide(next);
    } catch (error) {
      if (ticket !== rightTicket) return;
      focusSide('right');
      failed = error instanceof Error ? error.message : 'Не удалось открыть каталог';
    } finally {
      finishLoad('right', ticket, network);
    }
    if (failed) await reportOpenError('right', failed);
  }

  async function openDirectory(target: string, record: boolean): Promise<void> {
    leaveMenuContext();
    if (side === 'right') {
      await openSide(target, record);
      return;
    }
    const session = localSession();
    if (!session) return;
    const network = isNetworkRoot(target);
    const ticket = beginLoad('left', target);
    let failed = '';
    try {
      const next = unwrap(await window.vortex.list(target, showHidden, showSystem));
      if (ticket !== leftTicket) return;
      if (record && session.history[session.historyIndex] !== next.path) {
        session.history.splice(session.historyIndex + 1);
        session.history.push(next.path);
        session.historyIndex = session.history.length - 1;
      }
      renderPage(next);
    } catch (error) {
      if (ticket !== leftTicket) return;
      failed = error instanceof Error ? error.message : 'Не удалось открыть каталог';
    } finally {
      finishLoad('left', ticket, network);
    }
    if (failed) await reportOpenError('left', failed);
  }

  async function reportOpenError(which: 'left' | 'right', message: string): Promise<void> {
    const current = which === 'right' ? right.page : page;
    statusMain.textContent = message;
    if (!current) showError(message);
    await ask({ title: 'Не удалось открыть', label: message, input: false, ok: 'Закрыть', alert: true });
  }

  async function showActive(): Promise<void> {
    leaveMenuContext();
    const session = active();
    if (!session) return;
    side = 'left';
    if (session.kind !== 'local') {
      showRemote(session);
      focusSide('left');
      return;
    }
    await openDirectory(session.history[session.historyIndex] ?? session.path, false);
    focusSide('left');
  }

  function replaceActive(request: SourceRequest): void {
    const session = active();
    if (!session) {
      addSession(request);
      return;
    }
    session.kind = request.kind;
    session.label = request.label;
    session.path = request.path;
    session.host = request.host;
    session.port = request.port;
    session.user = request.user;
    session.history = request.kind === 'local' ? [request.path] : [];
    session.historyIndex = 0;
    renderTabs();
    void showActive();
  }

  function addSession(request: SourceRequest): void {
    const session: Session = {
      ...request,
      id: crypto.randomUUID(),
      history: request.kind === 'local' ? [request.path] : [],
      historyIndex: 0,
    };
    sessions.push(session);
    activeId = session.id;
    renderTabs();
    void showActive();
  }

  async function reload(): Promise<void> {
    if (!localSession()) return;
    if (side === 'right') {
      if (right.page) await openSide(right.page.path, false);
      return;
    }
    if (!page) return;
    await openDirectory(page.path, false);
  }

  async function reloadBoth(): Promise<void> {
    const leftPath = page?.path;
    const rightPath = right.page?.path;
    const restore = side;
    if (leftPath) {
      side = 'left';
      await openDirectory(leftPath, false);
    }
    if (rightPath && !shell.hasAttribute('aside-collapsed')) await openSide(rightPath, false);
    focusSide(restore);
  }

  function ask(options: { title: string; label: string; value?: string; input: boolean; ok?: string; alert?: boolean }): Promise<string | null> {
    dialog.label = options.title;
    dialogText.textContent = options.label;
    dialogInput.hidden = !options.input;
    dialogInput.label = options.label;
    dialogInput.value = options.value ?? '';
    dialogOk.textContent = options.ok ?? 'ОК';
    dialogCancel.hidden = Boolean(options.alert);
    return new Promise((resolve) => {
      let answer: string | null = null;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        dialogCancel.hidden = false;
        dialogOk.removeEventListener('click', onOk);
        dialogCancel.removeEventListener('click', onCancel);
        dialog.removeEventListener('close', onClose);
        resolve(answer);
      };
      const onOk = (): void => {
        answer = options.input ? dialogInput.value.trim() : 'ok';
        dialog.close();
      };
      const onCancel = (): void => {
        answer = null;
        dialog.close();
      };
      const onClose = (): void => finish();
      dialogOk.addEventListener('click', onOk);
      dialogCancel.addEventListener('click', onCancel);
      dialog.addEventListener('close', onClose);
      dialog.show();
      if (options.input) dialogInput.focus();
    });
  }

  async function runAction(action: () => Promise<boolean>): Promise<void> {
    try {
      busy = true;
      syncCommands();
      const changed = await action();
      if (changed) await reloadBoth();
    } catch (error) {
      statusMain.textContent = error instanceof Error ? error.message : 'Операция не выполнена';
    } finally {
      busy = false;
      syncCommands();
    }
  }

  async function activate(): Promise<void> {
    const current = currentPage();
    const entry = current?.entries.find((item) => item.path === currentGrid().selectedId);
    if (entry) await openEntry(entry);
  }

  function bindNav(nav: PaneNav, which: 'left' | 'right'): void {
    nav.back.addEventListener('click', () => {
      focusSide(which);
      if (which === 'right') {
        if (right.historyIndex <= 0) return;
        right.historyIndex -= 1;
        const target = right.history[right.historyIndex];
        if (target) void openSide(target, false);
        return;
      }
      const session = localSession();
      if (!session || session.historyIndex <= 0) return;
      session.historyIndex -= 1;
      const target = session.history[session.historyIndex];
      if (target) void openDirectory(target, false);
    });
    nav.forward.addEventListener('click', () => {
      focusSide(which);
      if (which === 'right') {
        if (right.historyIndex >= right.history.length - 1) return;
        right.historyIndex += 1;
        const target = right.history[right.historyIndex];
        if (target) void openSide(target, false);
        return;
      }
      const session = localSession();
      if (!session || session.historyIndex >= session.history.length - 1) return;
      session.historyIndex += 1;
      const target = session.history[session.historyIndex];
      if (target) void openDirectory(target, false);
    });
    nav.up.addEventListener('click', () => {
      focusSide(which);
      const listing = which === 'right' ? right.page : page;
      const parent = listing ? parentPath(listing.path) : null;
      if (parent) void openDirectory(parent, true);
    });
    nav.refresh.addEventListener('click', () => {
      focusSide(which);
      void reload();
    });
    nav.path.addEventListener('change', () => {
      const next = nav.path.value.trim();
      focusSide(which);
      if (next) void openDirectory(next, true);
    });
  }

  bindNav(leftNav, 'left');
  bindNav(rightNav, 'right');
  addTab.addEventListener('click', () => {
    void window.vortex.openSources('tab');
  });
  viewMenu.addEventListener('close', () => viewButton.setAttribute('aria-expanded', 'false'));
  viewButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    hiddenItem.toggleAttribute('checked', showHidden);
    systemItem.toggleAttribute('checked', showSystem);
    extensionItem.toggleAttribute('checked', showExtensions);
    viewButton.setAttribute('aria-expanded', 'true');
    closeContextMenu();
    const rect = viewButton.getBoundingClientRect();
    window.setTimeout(() => viewMenu.showAt(rect.left, rect.bottom), 0);
  });
  previewToggle.addEventListener('change', () => {
    showPreview = previewToggle.pressed;
    syncPreview('left');
    syncPreview('right');
  });
  hiddenItem.addEventListener('click', () => {
    showHidden = !showHidden;
    void reloadBoth();
  });
  systemItem.addEventListener('click', () => {
    showSystem = !showSystem;
    void reloadBoth();
  });
  extensionItem.addEventListener('click', () => {
    showExtensions = !showExtensions;
    if (page) renderPage(page);
    if (right.page) renderSide(right.page);
  });
  function renameEntries(entries: readonly FileEntry[]): void {
    const entry = entries.filter(canChange)[0];
    if (!entry || entries.filter(canChange).length !== 1) return;
    void runAction(async () => {
      const name = await ask({ title: 'Переименовать', label: 'Новое имя', input: true, value: entry.name });
      if (!name) return false;
      unwrap(await window.vortex.rename(entry.path, name));
      return true;
    });
  }

  function transferPaths(mode: 'copy' | 'move', paths: readonly string[], destination: string): void {
    if (!paths.length || !destination) return;
    void runAction(async () => {
      if (mode === 'copy') unwrap(await window.vortex.copy([...paths], destination));
      else unwrap(await window.vortex.move([...paths], destination));
      return true;
    });
  }

  function copyEntries(entries: readonly FileEntry[]): void {
    const targets = entries.filter(canChange);
    if (!targets.length || !currentPage()) return;
    void runAction(async () => {
      const destination = await ask({ title: 'Копировать', label: 'Каталог назначения', input: true, value: currentPage()?.path ?? '' });
      if (!destination) return false;
      unwrap(await window.vortex.copy(targets.map((entry) => entry.path), destination));
      return true;
    });
  }

  function moveEntries(entries: readonly FileEntry[]): void {
    const targets = entries.filter(canChange);
    if (!targets.length || !currentPage()) return;
    void runAction(async () => {
      const destination = await ask({ title: 'Переместить', label: 'Каталог назначения', input: true, value: currentPage()?.path ?? '' });
      if (!destination) return false;
      unwrap(await window.vortex.move(targets.map((entry) => entry.path), destination));
      return true;
    });
  }

  function deleteEntries(entries: readonly FileEntry[]): void {
    const targets = entries.filter(canChange);
    if (!targets.length) return;
    void runAction(async () => {
      const accepted = await ask({
        title: 'Удалить',
        label: `Удалить объектов: ${targets.length}. Восстановление не предусмотрено.`,
        input: false,
        ok: 'Удалить',
      });
      if (!accepted) return false;
      unwrap(await window.vortex.remove(targets.map((entry) => entry.path)));
      return true;
    });
  }

  async function openEntry(entry: FileEntry): Promise<void> {
    if (entry.kind === 'file' || entry.kind === 'other') {
      const result = await window.vortex.open(entry.path);
      if (!result.ok) statusMain.textContent = result.message;
      return;
    }
    await openDirectory(entry.path, true);
  }

  function menuKey(query: ContextMenuQuery): string {
    return JSON.stringify(query);
  }

  function cachedMenu(key: string): ContextMenuModel | null {
    if (!menuMemory || menuMemory.key !== key) return null;
    if (performance.now() - menuMemory.at > 15_000) {
      menuMemory = null;
      return null;
    }
    return menuMemory.model;
  }

  function queryFor(
    which: 'left' | 'right',
    entries: readonly FileEntry[],
    extended: boolean,
    classic = false,
  ): ContextMenuQuery {
    const kind = paneKind(which);
    const directory = (which === 'right' ? right.page : page)?.path ?? '';
    const chosen = entries.filter((entry) => entry.name !== '.' && entry.name !== '..');
    const target = classifySelection(chosen, directory);
    const mutable = chosen.filter(canChange);
    const intact = chosen.length > 0 && mutable.length === chosen.length;
    const single = chosen.length === 1 ? chosen[0] : undefined;
    return {
      target,
      folders: chosen.filter((entry) => entry.kind === 'directory').map((entry) => entry.path),
      directory,
      extended,
      classic,
      kind,
      flags: {
        open: Boolean(single),
        openTab: Boolean(kind === 'local' && single?.kind === 'directory'),
        copy: kind === 'local' && intact,
        cut: kind === 'local' && intact,
        paste: kind === 'local' && Boolean(held?.paths.length) && Boolean(directory),
        rename: kind === 'local' && chosen.length === 1 && intact,
        remove: kind === 'local' && intact,
        create: kind === 'local' && Boolean(directory),
        transfer: intact,
      },
    };
  }

  function runMenuCommand(command: string, which: 'left' | 'right', entries: readonly FileEntry[]): void {
    const chosen = entries.filter((entry) => entry.name !== '.' && entry.name !== '..');
    if (command === 'vortex:open') {
      const entry = chosen[0];
      if (entry) void openEntry(entry);
      return;
    }
    if (command === 'vortex:open-tab') {
      const entry = chosen[0];
      if (!entry || entry.kind !== 'directory') return;
      addSession({ kind: 'local', label: entry.name, path: entry.path, host: '', port: 0, user: '' });
      return;
    }
    if (command === 'vortex:copy' || command === 'vortex:cut') {
      const paths = chosen.filter(canChange).map((entry) => entry.path);
      if (!paths.length) return;
      held = { mode: command === 'vortex:cut' ? 'move' : 'copy', paths };
      statusMain.textContent = command === 'vortex:cut' ? 'Вырезано' : 'Скопировано';
      return;
    }
    if (command === 'vortex:paste') {
      const clip = held;
      const destination = (which === 'right' ? right.page : page)?.path;
      if (!clip || !destination) return;
      if (clip.mode === 'move') held = null;
      transferPaths(clip.mode, clip.paths, destination);
      return;
    }
    if (command === 'vortex:rename') {
      renameEntries(chosen);
      return;
    }
    if (command === 'vortex:delete') {
      deleteEntries(chosen);
      return;
    }
    if (command === 'vortex:create') {
      const parent = (which === 'right' ? right.page : page)?.path;
      if (!parent) return;
      void runAction(async () => {
        const name = await ask({ title: 'Создать папку', label: 'Имя', input: true, value: '' });
        if (!name) return false;
        unwrap(await window.vortex.mkdir(parent, name));
        return true;
      });
      return;
    }
    if (command === 'vortex:properties') {
      const entry = chosen[0];
      const directory = (which === 'right' ? right.page : page)?.path ?? '';
      const label = entry
        ? `Имя: ${entry.name} · Путь: ${entry.path} · Тип: ${kindLabel(entry.kind)} · Размер: ${formatSize(entry.size, entry.kind) || '—'}`
        : `Путь: ${directory}`;
      void ask({ title: 'Свойства', label, input: false, ok: 'Закрыть' });
      return;
    }
    if (command === 'vortex:copy-address') {
      const source = paneSource(which);
      if (!source) return;
      void writeClipboard({ text: resourceAddress(source) }).then(() => {
        statusMain.textContent = 'Адрес скопирован';
      });
      return;
    }
    if (command === 'vortex:disconnect') {
      disconnectPane(which);
      return;
    }
    const pending: Record<string, string> = {
      'vortex:terminal': 'Открыть терминал',
      'vortex:download': 'Скачать',
      'vortex:upload': 'Загрузить',
      'vortex:move': 'Переместить',
    };
    const title = pending[command];
    if (!title) return;
    statusMain.textContent = `${paneKind(which).toUpperCase()}: «${title}» выполнится после подключения провайдера`;
  }

  function paneKind(which: 'left' | 'right'): SourceKind {
    if (which === 'left') return active()?.kind ?? 'local';
    return right.source?.kind ?? 'local';
  }

  function paneSource(which: 'left' | 'right'): SourceRequest | undefined {
    if (which === 'right') return right.source ?? undefined;
    const session = active();
    return session?.kind === 'local' ? undefined : session;
  }

  function resourceAddress(source: SourceRequest): string {
    const auth = source.user ? `${source.user}@` : '';
    return `${source.kind}://${auth}${source.host}:${source.port}${source.path}`;
  }

  function disconnectPane(which: 'left' | 'right'): void {
    if (which === 'right') {
      right.source = null;
      right.page = null;
      right.history = [];
      right.historyIndex = 0;
      rightGrid.rows = [];
      rightListing.hidden = true;
      rightGrid.hidden = true;
      rightPreview.hidden = true;
      rightEmpty.hidden = false;
      rightEmpty.setAttribute('heading', 'Нет каталога');
      rightEmpty.setAttribute('label', 'Источник отключён');
      showAddress(rightNav.path, '');
      paintResource('right');
      statusMain.textContent = 'Источник отключён';
      syncCommands();
      return;
    }
    const session = active();
    if (!session || session.kind === 'local') return;
    showRemote(session);
    paintResource('left');
    empty.setAttribute('label', 'Сессия отключена. Провайдер подключится отдельно.');
    statusMain.textContent = 'Сессия отключена';
  }

  let prefetchTimer = 0;

  function schedulePrefetch(which: 'left' | 'right'): void {
    window.clearTimeout(prefetchTimer);
    prefetchTimer = window.setTimeout(() => {
      const view = which === 'right' ? rightGrid : grid;
      const source = which === 'right' ? right.page : page;
      const ids = new Set(view.selectedIds);
      const entries = source?.entries.filter((entry) => ids.has(entry.path)) ?? [];
      const query = queryFor(which, entries, false);
      if (query.kind !== 'local') return;
      const key = menuKey(query);
      if (cachedMenu(key)) return;
      const serial = ++menuSerial;
      void window.vortex.contextMenuGet(query).then((listed) => {
        if (serial !== menuSerial || !listed.ok) return;
        menuMemory = { key, at: performance.now(), model: listed.value };
      });
    }, 150);
  }

  async function openContextMenu(
    which: 'left' | 'right',
    entries: readonly FileEntry[],
    x: number,
    y: number,
    extended = false,
    classic = false,
  ): Promise<void> {
    if (busy) return;
    window.clearTimeout(prefetchTimer);
    const directory = (which === 'right' ? right.page : page)?.path ?? '';
    if (!entries.length && !directory) return;
    const started = performance.now();
    traceMenu('requested', started);
    const query = queryFor(which, entries, extended, classic);
    const key = menuKey(query);
    const cached = cachedMenu(key);
    const ticket = openFileMenu(x, y, cached ? visibleSystemMenu(cached.items) : [menuNotice('menu-loading', 'Загрузка…', 'loader')]);
    menuAction = { which, entries: [...entries], session: cached?.session ?? '', x, y };
    if (cached) {
      traceMenu('total duration', started);
      return;
    }
    const serial = ++menuSerial;
    const listed = await window.vortex.contextMenuGet(query);
    if (serial !== menuSerial) return;
    if (!listed.ok) {
      statusMain.textContent = listed.message;
      replaceFileMenu(ticket, [menuNotice('system-error', listed.message || 'Меню недоступно')]);
      return;
    }
    menuMemory = { key, at: performance.now(), model: listed.value };
    menuAction = { which, entries: [...entries], session: listed.value.session, x, y };
    replaceFileMenu(ticket, visibleSystemMenu(listed.value.items));
    traceMenu('total duration', started);
  }

  function openPaneMenu(which: 'left' | 'right', entries: readonly FileEntry[], x: number, y: number, extended = false): void {
    void openContextMenu(which, entries, x, y, extended);
  }


  tabs.addEventListener('click', () => {
    const selected = tabs.querySelector('vui-tab[selected]');
    const id = selected instanceof HTMLElement ? selected.dataset.id : '';
    if (!id || id === activeId) return;
    activeId = id;
    void showActive();
  });
  tabs.addEventListener('close', (event) => {
    event.stopPropagation();
    const tab = event.target;
    if (!(tab instanceof HTMLElement) || !tab.dataset.id) return;
    const index = sessions.findIndex((session) => session.id === tab.dataset.id);
    if (index < 0) return;
    if (sessions.length < 2) {
      window.vortex.close();
      return;
    }
    const removed = sessions[index];
    sessions.splice(index, 1);
    if (removed?.id === activeId) activeId = (sessions[index] ?? sessions[index - 1])?.id ?? '';
    renderTabs();
    void showActive();
  });

  function watchPane(view: VDataGrid, which: 'left' | 'right'): void {
    view.addEventListener('pointerdown', () => focusSide(which));
    view.addEventListener('change', () => {
      if (side !== which) focusSide(which);
      const count = view.selectedIds.length;
      const current = which === 'left' ? page : right.page;
      statusEnd.textContent = count ? `Выбрано: ${count}` : (current?.path ?? '');
      syncPreview(which);
      syncCommands();
      closeContextMenu();
      schedulePrefetch(which);
    });
    view.addEventListener('dblclick', () => {
      focusSide(which);
      void activate();
    });
    view.addEventListener(
      'contextmenu',
      (event) => {
        event.preventDefault();
        const row = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.getAttribute('role') === 'row');
        const id = row?.dataset.id;
        if (!id) {
          focusSide(which);
          openPaneMenu(which, [], event.clientX, event.clientY, event.shiftKey);
          return;
        }
        focusSide(which);
        if (!view.selectedIds.includes(id)) view.selectedIds = [id];
        syncPreview(which);
        syncCommands();
        const source = which === 'left' ? page : right.page;
        const ids = new Set(view.selectedIds);
        const entries = source?.entries.filter((entry) => ids.has(entry.path)) ?? [];
        openPaneMenu(which, entries, event.clientX, event.clientY, event.shiftKey);
      },
      true,
    );
  }

  watchPane(grid, 'left');
  watchPane(rightGrid, 'right');

  function bindResourceMenu(host: HTMLElement, which: 'left' | 'right'): void {
    host.addEventListener('contextmenu', (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      focusSide(which);
      openPaneMenu(which, [], event.clientX, event.clientY, event.shiftKey);
    });
  }

  bindResourceMenu(leftBody, 'left');
  bindResourceMenu(rightBody, 'right');

  const fileMenuHost = document.createElement('vui-menu') as VMenu;
  fileMenuHost.setAttribute('label', 'Файл');
  document.body.append(fileMenuHost);
  const fileMenu = createContextMenuController(fileMenuHost);
  openFileMenu = (x, y, items) => fileMenu.openAt(x, y, items);
  replaceFileMenu = (ticket, items) => fileMenu.replace(ticket, items);
  closeContextMenu = () => fileMenu.close();
  leaveMenuContext = () => {
    menuSerial += 1;
    menuMemory = null;
    menuAction = null;
    fileMenu.close();
    void window.vortex.contextMenuDismiss();
  };
  fileMenuHost.addEventListener('click', (event) => {
    const command = commandFromMenuEvent(event);
    const action = menuAction;
    if (!command || !action) return;
    if (command.startsWith('vortex:')) {
      runMenuCommand(command, action.which, action.entries);
      return;
    }
    if (command === 'shell:classic') {
      event.preventDefault();
      event.stopPropagation();
      void openContextMenu(action.which, action.entries, action.x, action.y, false, true);
      return;
    }
    if (!action.session) return;
    menuMemory = null;
    void (async () => {
      const invoked = await window.vortex.contextMenuExecute({ session: action.session, commandId: command });
      if (!invoked.ok) {
        statusMain.textContent = invoked.message;
        return;
      }
      if (!invoked.value) {
        statusMain.textContent = 'Команда недоступна';
        return;
      }
      await reload();
    })();
  }, true);

  const dropMenu = document.createElement('vui-menu') as VMenu;
  dropMenu.setAttribute('label', 'Перенос');
  const dropCopy = document.createElement('vui-menu-item');
  dropCopy.setAttribute('label', 'Копировать');
  const dropMove = document.createElement('vui-menu-item');
  dropMove.setAttribute('label', 'Переместить');
  dropMenu.append(dropCopy, dropMove);
  document.body.append(dropMenu);
  let pendingDrop: { paths: string[]; destination: string } | null = null;
  dropCopy.addEventListener('click', () => {
    const drop = pendingDrop;
    pendingDrop = null;
    if (drop) transferPaths('copy', drop.paths, drop.destination);
  });
  dropMove.addEventListener('click', () => {
    const drop = pendingDrop;
    pendingDrop = null;
    if (drop) transferPaths('move', drop.paths, drop.destination);
  });
  dropMenu.addEventListener('close', () => {
    pendingDrop = null;
  });

  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.hidden = true;
  document.body.append(ghost);

  interface FileDrag {
    pointerId: number;
    button: number;
    from: 'left' | 'right';
    paths: string[];
    startX: number;
    startY: number;
    moved: boolean;
  }
  let fileDrag: FileDrag | null = null;
  let eatContextMenu = false;

  function sameConnection(from: 'left' | 'right', to: 'left' | 'right'): boolean {
    const sourceOf = (which: 'left' | 'right'): SourceRequest | null => (which === 'right' ? right.source : (active() ?? null));
    const leftSource = sourceOf(from);
    const rightSource = sourceOf(to);
    const leftKind = leftSource?.kind ?? 'local';
    const rightKind = rightSource?.kind ?? 'local';
    if (leftKind !== rightKind) return false;
    if (leftKind === 'local') return true;
    return leftSource?.host === rightSource?.host && leftSource?.port === rightSource?.port && leftSource?.user === rightSource?.user;
  }

  function pathsForDrag(which: 'left' | 'right', id: string): string[] {
    const listing = which === 'right' ? right.page : page;
    if (!listing) return [];
    const view = which === 'right' ? rightGrid : grid;
    const selected = new Set(view.selectedIds);
    const ids = selected.has(id) ? [...selected] : [id];
    return listing.entries.filter((entry) => ids.includes(entry.path) && canChange(entry)).map((entry) => entry.path);
  }

  function paneFromPoint(x: number, y: number): 'left' | 'right' | null {
    const hit = (host: HTMLElement): boolean => {
      const rect = host.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    if (!shell.hasAttribute('aside-collapsed') && hit(rightStage)) return 'right';
    if (hit(stage)) return 'left';
    return null;
  }

  function deepest(x: number, y: number): Element | null {
    let node: Element | null = document.elementFromPoint(x, y);
    const seen = new Set<Element>();
    while (node && !seen.has(node)) {
      seen.add(node);
      const root = node.shadowRoot;
      if (!root) return node;
      const inner = root.elementFromPoint(x, y);
      if (!inner || inner === node) return node;
      node = inner;
    }
    return node;
  }

  function destinationFor(which: 'left' | 'right', x: number, y: number): string | null {
    const listing = which === 'right' ? right.page : page;
    if (!listing) return null;
    const node = deepest(x, y);
    const row = node?.closest('tr[data-id]');
    const id = row instanceof HTMLElement ? row.dataset.id : undefined;
    const entry = id ? listing.entries.find((item) => item.path === id) : undefined;
    if (entry?.kind === 'directory' && entry.name !== '.') return entry.path;
    return listing.path;
  }

  function clearDragVisual(): void {
    ghost.hidden = true;
    stage.classList.remove('is-drop');
    rightStage.classList.remove('is-drop');
  }

  function onPointerMove(event: PointerEvent): void {
    if (!fileDrag || event.pointerId !== fileDrag.pointerId) return;
    if (!fileDrag.moved && Math.hypot(event.clientX - fileDrag.startX, event.clientY - fileDrag.startY) < 8) return;
    fileDrag.moved = true;
    const listing = fileDrag.from === 'right' ? right.page : page;
    const single = fileDrag.paths.length === 1 ? listing?.entries.find((entry) => entry.path === fileDrag?.paths[0])?.name : '';
    ghost.hidden = false;
    ghost.textContent = single || `Объектов: ${fileDrag.paths.length}`;
    ghost.style.left = `${event.clientX + 14}px`;
    ghost.style.top = `${event.clientY + 14}px`;
    const over = paneFromPoint(event.clientX, event.clientY);
    stage.classList.toggle('is-drop', over === 'left' && fileDrag.from !== 'left');
    rightStage.classList.toggle('is-drop', over === 'right' && fileDrag.from !== 'right');
  }

  function endDrag(event: PointerEvent, commit: boolean): void {
    const drag = fileDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    fileDrag = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
    clearDragVisual();
    if (!commit || !drag.moved) return;
    if (drag.button === 2) eatContextMenu = true;
    const target = paneFromPoint(event.clientX, event.clientY);
    if (!target || target === drag.from) return;
    const destination = destinationFor(target, event.clientX, event.clientY);
    if (!destination) {
      statusMain.textContent = 'Панель назначения не открыта';
      return;
    }
    const fromKind = (drag.from === 'right' ? right.source?.kind : active()?.kind) ?? 'local';
    const toKind = (target === 'right' ? right.source?.kind : active()?.kind) ?? 'local';
    if (fromKind !== 'local' || toKind !== 'local') {
      statusMain.textContent = 'Копирование между ресурсами выполнится после подключения провайдера';
      return;
    }
    if (!sameConnection(drag.from, target)) {
      transferPaths('copy', drag.paths, destination);
      return;
    }
    if (drag.button === 2) {
      pendingDrop = { paths: drag.paths, destination };
      closeContextMenu();
      dropMenu.showAt(event.clientX, event.clientY);
      return;
    }
    transferPaths('move', drag.paths, destination);
  }

  function onPointerUp(event: PointerEvent): void {
    endDrag(event, true);
  }

  function onPointerCancel(event: PointerEvent): void {
    endDrag(event, false);
  }

  function beginFileDrag(which: 'left' | 'right', event: PointerEvent): void {
    if (busy || (event.button !== 0 && event.button !== 2) || fileDrag) return;
    const row = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.getAttribute('role') === 'row' && Boolean(node.dataset.id));
    if (!row?.dataset.id) return;
    const paths = pathsForDrag(which, row.dataset.id);
    if (!paths.length) return;
    fileDrag = {
      pointerId: event.pointerId,
      button: event.button,
      from: which,
      paths,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  stage.addEventListener('pointerdown', (event) => beginFileDrag('left', event));
  rightStage.addEventListener('pointerdown', (event) => beginFileDrag('right', event));
  window.addEventListener('contextmenu', (event) => {
    if (!eatContextMenu) return;
    eatContextMenu = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  const commands = new CommandRegistry();
  const shortcuts = new ShortcutRegistry(commands);
  commands.register({ id: 'go.back', label: 'Назад', execute: () => (side === 'right' ? rightNav : leftNav).back.click() });
  commands.register({ id: 'go.forward', label: 'Вперёд', execute: () => (side === 'right' ? rightNav : leftNav).forward.click() });
  commands.register({ id: 'go.up', label: 'Вверх', execute: () => (side === 'right' ? rightNav : leftNav).up.click() });
  commands.register({ id: 'file.rename', label: 'Переименовать', execute: () => renameEntries(selectedEntries()) });
  commands.register({ id: 'file.copy', label: 'Копировать', execute: () => copyEntries(selectedEntries()) });
  commands.register({ id: 'file.move', label: 'Переместить', execute: () => moveEntries(selectedEntries()) });
  commands.register({ id: 'file.delete', label: 'Удалить', execute: () => deleteEntries(selectedEntries()) });
  commands.register({ id: 'file.open', label: 'Открыть', execute: () => void activate() });
  shortcuts.register({ keys: 'Alt+ArrowLeft', command: 'go.back' });
  shortcuts.register({ keys: 'Alt+ArrowRight', command: 'go.forward' });
  shortcuts.register({ keys: 'Alt+ArrowUp', command: 'go.up' });
  shortcuts.register({ keys: 'F2', command: 'file.rename' });
  shortcuts.register({ keys: 'Delete', command: 'file.delete' });
  shortcuts.register({ keys: 'Enter', command: 'file.open' });
  shortcuts.attach(window);

  window.vortex.onSource((source: OpenedSource) => {
    if (source.target === 'pane') {
      void openInPane(source);
      return;
    }
    if (source.target === 'active') {
      replaceActive(source);
      return;
    }
    addSession(source);
  });

  void (async () => {
    try {
      const index = unwrap(await window.vortex.locations());
      renderSidebar(index, index.places.find((place) => !place.group && place.id !== 'network' && place.id !== 'yandex')?.path ?? index.roots[0]?.path ?? '');
      const initial = index.places[0]?.path ?? index.roots[0]?.path;
      if (!initial) throw new Error('Нет доступных расположений');
      addSession({ kind: 'local', label: pathTitle(initial), path: initial, host: '', port: 0, user: '' });
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Vortex не запустился');
    }
  })();
}
