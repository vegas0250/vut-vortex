import 'vui/shell';
import 'vui/toolbar';
import 'vui/status-bar';
import 'vui/data-grid';
import 'vui/button';
import 'vui/input';
import 'vui/dialog';
import 'vui/text';
import 'vui/nav';
import 'vui/empty';
import 'vui/tabs';
import 'vui/menu';
import 'vui/icon';
import 'vui/icon-button';
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
import type { ContextAction, OpenedSource, Result, SourceKind, SourceRequest } from '../shared/ipc';

interface Session extends SourceRequest {
  id: string;
  history: string[];
  historyIndex: number;
}

export function mountManager(): void {
  restoreTheme();
  const app = document.querySelector('#app');
  if (!app) throw new Error('Не найдено окно приложения');
  const bar = mountChrome(app, 'Vortex', 'folder', window.vortex);

  const shell = document.createElement('vui-shell');
  shell.setAttribute('label', 'Vortex');
  shell.setAttribute('nav-label', 'Быстрые ссылки');
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
    element.setAttribute('size', 'large');
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
    path: VPathBar;
    bar: HTMLElement;
  }

  function makePaneNav(label: string): PaneNav {
    const bar = document.createElement('vui-toolbar');
    bar.setAttribute('label', label);
    const back = iconButton('Назад', 'arrow-left');
    const forward = iconButton('Вперёд', 'arrow-right');
    const up = iconButton('Вверх', 'arrow-up');
    const refresh = iconButton('Обновить', 'refresh-cw');
    const pathBox = document.createElement('vui-path-bar') as VPathBar;
    pathBox.setAttribute('label', 'Адрес');
    bar.append(back, forward, up, refresh, pathBox);
    return { back, forward, up, refresh, path: pathBox, bar };
  }

  const leftNav = makePaneNav('Навигация');
  const rightNav = makePaneNav('Навигация второй панели');
  const viewButton = button('Показать', 'eye', 'end');
  viewButton.setAttribute('aria-haspopup', 'menu');
  viewButton.setAttribute('aria-expanded', 'false');
  const caret = document.createElement('vui-icon');
  caret.setAttribute('name', 'chevron-down');
  caret.style.color = 'var(--vui-color-text-muted)';
  viewButton.append(caret);
  const viewMenu = document.createElement('vui-menu') as VMenu;
  viewMenu.setAttribute('label', 'Показать');
  const previewItem = document.createElement('vui-menu-item');
  previewItem.setAttribute('label', 'Предпросмотр');
  const viewSplit = document.createElement('hr');
  const hiddenItem = document.createElement('vui-menu-item');
  hiddenItem.setAttribute('label', 'Скрытые');
  const extensionItem = document.createElement('vui-menu-item');
  extensionItem.setAttribute('label', 'Расширения файлов');
  extensionItem.setAttribute('checked', '');
  viewMenu.append(previewItem, viewSplit, hiddenItem, extensionItem);
  commandBar.append(viewButton);

  const nav = document.createElement('div');
  nav.setAttribute('slot', 'nav');
  nav.className = 'nav-block';
  const placesLabel = document.createElement('vui-text');
  placesLabel.setAttribute('variant', 'label');
  placesLabel.setAttribute('muted', '');
  placesLabel.textContent = 'Быстрые ссылки';
  const placesNav = document.createElement('vui-nav');
  placesNav.setAttribute('label', 'Быстрые ссылки');
  const navSplit = document.createElement('hr');
  const navPlaces = document.createElement('div');
  navPlaces.className = 'nav-places';

  function makeDisclosure(icon: string, id: string): { block: HTMLElement; nav: HTMLElement; label: HTMLElement } {
    const block = document.createElement('div');
    block.className = 'nav-group';
    block.hidden = true;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-group-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', id);
    const caret = document.createElement('vui-icon');
    caret.setAttribute('name', 'chevron-right');
    caret.className = 'caret';
    const mark = document.createElement('vui-icon');
    mark.setAttribute('name', icon);
    const label = document.createElement('span');
    toggle.append(caret, mark, label);
    const list = document.createElement('vui-nav');
    list.id = id;
    list.hidden = true;
    block.append(toggle, list);
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      list.hidden = !open;
    });
    return { block, nav: list, label };
  }

  const computer = makeDisclosure('hard-drive', 'vortex-computer');
  const linux = makeDisclosure('terminal', 'vortex-linux');
  const networkNav = document.createElement('vui-nav');
  networkNav.setAttribute('label', 'Сеть');
  networkNav.hidden = true;
  const yandexNav = document.createElement('vui-nav');
  yandexNav.setAttribute('label', 'Яндекс.Диск');
  yandexNav.hidden = true;
  navPlaces.append(computer.block, networkNav, linux.block, yandexNav);
  nav.append(placesLabel, placesNav, navSplit, navPlaces);
  const linuxNav = linux.nav;
  const rootsNav = computer.nav;

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

  const leftProgress = document.createElement('vui-progress');
  leftProgress.setAttribute('label', 'Загрузка сети');
  leftProgress.hidden = true;
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
  stage.append(makeHead(leftResource, leftNav), leftProgress, listing, empty);
  empty.hidden = true;
  stage.toggleAttribute('data-active', true);

  const rightStage = document.createElement('div');
  rightStage.className = 'stage file-stage';
  rightStage.setAttribute('slot', 'aside');
  const rightProgress = document.createElement('vui-progress');
  rightProgress.setAttribute('label', 'Загрузка сети');
  rightProgress.hidden = true;
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
  rightStage.append(makeHead(rightResource, rightNav), rightProgress, rightListing, rightEmpty);
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

  shell.append(commandBar, nav, stage, status, rightStage, dialog);
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
  let showExtensions = true;
  let showPreview = false;
  let busy = false;
  let loadSerial = 0;
  let blocking = 0;
  let leftTicket = 0;
  let rightTicket = 0;
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
    viewButton.disabled = busy || !local;
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
    if (kind === 'local') return 'folder';
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
      if (sessions.length > 1) tab.setAttribute('closable', '');
      if (session.id === activeId) tab.setAttribute('selected', '');
      tabs.append(tab);
    }
    tabs.append(addTab);
  }

  function showAddress(field: VPathBar, target: string): void {
    field.value = target;
    field.crumbs = crumbs(target);
  }

  function placeItem(place: Place, selected: boolean, pinned = false): HTMLElement {
    const item = document.createElement('vui-nav-item');
    item.setAttribute('data-path', place.path);
    const icon = document.createElement('vui-icon');
    icon.setAttribute('name', placeIcon(place.id));
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = place.label;
    item.append(icon, label);
    if (pinned) {
      const pin = document.createElement('vui-icon');
      pin.setAttribute('name', 'pin');
      pin.className = 'nav-pin';
      pin.setAttribute('label', 'Закреплено');
      item.append(pin);
    }
    if (selected) item.setAttribute('selected', '');
    return item;
  }

  function fillNav(host: HTMLElement, places: Place[], current: string, pinned = false): void {
    host.replaceChildren();
    host.hidden = places.length === 0;
    for (const place of places) host.append(placeItem(place, place.path === current, pinned));
  }

  function fillGroup(
    group: { block: HTMLElement; nav: HTMLElement; label: HTMLElement },
    title: string,
    places: Place[],
    current: string,
  ): void {
    group.label.textContent = title;
    group.nav.setAttribute('label', title);
    group.block.hidden = places.length === 0;
    const open = group.block.querySelector('.nav-group-toggle')?.getAttribute('aria-expanded') === 'true';
    group.nav.replaceChildren();
    for (const place of places) group.nav.append(placeItem(place, place.path === current));
    group.nav.hidden = places.length === 0 || !open;
  }

  function renderSidebar(index: { places: Place[]; roots: Place[]; computer: string }, current: string): void {
    const pins = index.places.filter((place) => !place.group && place.id !== 'network' && place.id !== 'yandex');
    fillNav(placesNav, pins, current, true);
    navSplit.hidden = pins.length === 0;
    computerName = index.computer;
    fillGroup(computer, index.computer, index.roots, current);
    fillNav(networkNav, index.places.filter((place) => place.id === 'network'), current);
    fillGroup(linux, 'Linux', index.places.filter((place) => place.group === 'linux'), current);
    fillNav(yandexNav, index.places.filter((place) => place.id === 'yandex'), current);
  }

  function clearNavSelection(host: HTMLElement): void {
    host.querySelectorAll('[selected]').forEach((item) => item.removeAttribute('selected'));
  }

  function focusSide(next: 'left' | 'right'): void {
    side = next;
    stage.toggleAttribute('data-active', next === 'left');
    rightStage.toggleAttribute('data-active', next === 'right');
    const current = currentPage();
    const field = side === 'right' ? rightNav.path : leftNav.path;
    if (current) showAddress(field, current.path);
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
    return ticket;
  }

  function finishLoad(which: 'left' | 'right', ticket: number, network: boolean): boolean {
    const current = which === 'right' ? rightTicket : leftTicket;
    if (ticket !== current) return false;
    (which === 'right' ? rightProgress : leftProgress).hidden = true;
    if (!network && blocking === ticket) {
      blocking = 0;
      busy = false;
      syncCommands();
    }
    return true;
  }

  async function openSide(target: string, record: boolean): Promise<void> {
    const network = isNetworkRoot(target);
    const ticket = beginLoad('right', target);
    try {
      const next = unwrap(await window.vortex.list(target, showHidden));
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
      showError(error instanceof Error ? error.message : 'Не удалось открыть каталог');
    } finally {
      finishLoad('right', ticket, network);
    }
  }

  async function openDirectory(target: string, record: boolean): Promise<void> {
    if (side === 'right') {
      await openSide(target, record);
      return;
    }
    const session = localSession();
    if (!session) return;
    const network = isNetworkRoot(target);
    const ticket = beginLoad('left', target);
    try {
      const next = unwrap(await window.vortex.list(target, showHidden));
      if (ticket !== leftTicket) return;
      if (record && session.history[session.historyIndex] !== next.path) {
        session.history.splice(session.historyIndex + 1);
        session.history.push(next.path);
        session.historyIndex = session.history.length - 1;
      }
      renderPage(next);
    } catch (error) {
      if (ticket !== leftTicket) return;
      showError(error instanceof Error ? error.message : 'Не удалось открыть каталог');
    } finally {
      finishLoad('left', ticket, network);
    }
  }

  async function showActive(): Promise<void> {
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

  function ask(options: { title: string; label: string; value?: string; input: boolean; ok?: string }): Promise<string | null> {
    dialog.label = options.title;
    dialogText.textContent = options.label;
    dialogInput.hidden = !options.input;
    dialogInput.label = options.label;
    dialogInput.value = options.value ?? '';
    dialogOk.textContent = options.ok ?? 'ОК';
    return new Promise((resolve) => {
      let answer: string | null = null;
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
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

  function openFromSidebar(target: string, host: HTMLElement): void {
    for (const nav of [placesNav, rootsNav, networkNav, linuxNav, yandexNav]) {
      if (nav !== host) clearNavSelection(nav);
    }
    focusSide('left');
    void openDirectory(target, true);
  }

  placesNav.addEventListener('change', () => {
    const target = placesNav.querySelector('[selected]')?.getAttribute('data-path');
    if (target) openFromSidebar(target, placesNav);
  });
  networkNav.addEventListener('change', () => {
    const target = networkNav.querySelector('[selected]')?.getAttribute('data-path');
    if (target) openFromSidebar(target, networkNav);
  });
  linuxNav.addEventListener('change', () => {
    const target = linuxNav.querySelector('[selected]')?.getAttribute('data-path');
    if (target) openFromSidebar(target, linuxNav);
  });
  rootsNav.addEventListener('change', () => {
    const target = rootsNav.querySelector('[selected]')?.getAttribute('data-path');
    if (target) openFromSidebar(target, rootsNav);
  });
  yandexNav.addEventListener('change', () => {
    const target = yandexNav.querySelector('[selected]')?.getAttribute('data-path');
    if (target) openFromSidebar(target, yandexNav);
  });
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
      focusSide(which);
      const next = nav.path.value.trim();
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
    previewItem.toggleAttribute('checked', showPreview);
    hiddenItem.toggleAttribute('checked', showHidden);
    extensionItem.toggleAttribute('checked', showExtensions);
    viewButton.setAttribute('aria-expanded', 'true');
    const rect = viewButton.getBoundingClientRect();
    window.setTimeout(() => viewMenu.showAt(rect.left, rect.bottom), 0);
  });
  previewItem.addEventListener('click', () => {
    showPreview = !showPreview;
    syncPreview('left');
    syncPreview('right');
  });
  hiddenItem.addEventListener('click', () => {
    showHidden = !showHidden;
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

  async function openSystemMenu(entries: readonly FileEntry[], x: number, y: number): Promise<void> {
    if (!entries.length || busy) return;
    const mutable = entries.filter(canChange);
    const intact = mutable.length === entries.length;
    const result = await window.vortex.contextMenu({
      x,
      y,
      kind: 'local',
      open: entries.length === 1,
      rename: entries.length === 1 && intact,
      transfer: intact && mutable.length > 0,
      remove: intact && mutable.length > 0,
    });
    if (!result.ok) {
      statusMain.textContent = result.message;
      return;
    }
    const action: ContextAction | null = result.value;
    const entry = entries[0];
    if (action === 'open' && entry) await openEntry(entry);
    if (action === 'rename') renameEntries(entries);
    if (action === 'copy') copyEntries(entries);
    if (action === 'move') moveEntries(entries);
    if (action === 'delete') deleteEntries(entries);
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

  async function openResourceMenu(
    which: 'left' | 'right',
    kind: Exclude<SourceKind, 'local'>,
    entries: readonly FileEntry[],
    x: number,
    y: number,
  ): Promise<void> {
    if (busy) return;
    const mutable = entries.filter(canChange);
    const intact = entries.length > 0 && mutable.length === entries.length;
    const result = await window.vortex.contextMenu({
      x,
      y,
      kind,
      open: entries.length === 1,
      rename: entries.length === 1 && intact,
      transfer: intact && mutable.length > 0,
      remove: intact && mutable.length > 0,
    });
    if (!result.ok) {
      statusMain.textContent = result.message;
      return;
    }
    const action = result.value;
    if (!action) return;
    if (action === 'copy-address') {
      const source = paneSource(which);
      if (!source) return;
      await writeClipboard({ text: resourceAddress(source) });
      statusMain.textContent = 'Адрес скопирован';
      return;
    }
    if (action === 'disconnect') {
      disconnectPane(which);
      return;
    }
    const names: Partial<Record<ContextAction, string>> = {
      terminal: 'Открыть терминал',
      download: 'Скачать',
      upload: 'Загрузить',
      open: 'Открыть',
      rename: 'Переименовать',
      copy: 'Копировать',
      move: 'Переместить',
      delete: 'Удалить',
    };
    statusMain.textContent = `${kind.toUpperCase()}: «${names[action] ?? action}» выполнится после подключения провайдера`;
  }

  function openPaneMenu(which: 'left' | 'right', entries: readonly FileEntry[], x: number, y: number): void {
    const kind = paneKind(which);
    if (kind === 'local') {
      void openSystemMenu(entries, x, y);
      return;
    }
    void openResourceMenu(which, kind, entries, x, y);
  }


  tabs.addEventListener('click', () => {
    const selected = tabs.querySelector('vui-tab[selected]');
    const id = selected instanceof HTMLElement ? selected.dataset.id : '';
    if (!id || id === activeId) return;
    activeId = id;
    void showActive();
  });
  tabs.addEventListener('close', (event) => {
    const tab = event.target;
    if (!(tab instanceof HTMLElement) || !tab.dataset.id) return;
    if (sessions.length < 2) return;
    const index = sessions.findIndex((session) => session.id === tab.dataset.id);
    if (index < 0) return;
    const removed = sessions[index];
    if (!removed) return;
    sessions.splice(index, 1);
    if (removed.id === activeId) activeId = sessions[Math.max(0, index - 1)]?.id ?? '';
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
    });
    view.addEventListener('dblclick', () => {
      focusSide(which);
      void activate();
    });
    view.addEventListener(
      'contextmenu',
      (event) => {
        const row = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.getAttribute('role') === 'row');
        const id = row?.dataset.id;
        if (!id) return;
        event.preventDefault();
        focusSide(which);
        if (!view.selectedIds.includes(id)) view.selectedIds = [id];
        syncPreview(which);
        syncCommands();
        const source = which === 'left' ? page : right.page;
        const ids = new Set(view.selectedIds);
        const entries = source?.entries.filter((entry) => ids.has(entry.path)) ?? [];
        openPaneMenu(which, entries, event.clientX, event.clientY);
      },
      true,
    );
  }

  watchPane(grid, 'left');
  watchPane(rightGrid, 'right');

  function bindResourceMenu(host: HTMLElement, which: 'left' | 'right'): void {
    host.addEventListener('contextmenu', (event) => {
      if (paneKind(which) === 'local' || event.defaultPrevented) return;
      event.preventDefault();
      focusSide(which);
      openPaneMenu(which, [], event.clientX, event.clientY);
    });
  }

  bindResourceMenu(stage, 'left');
  bindResourceMenu(rightStage, 'right');

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
