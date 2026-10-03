import 'vui/shell';
import 'vui/toolbar';
import 'vui/status-bar';
import 'vui/data-grid';
import 'vui/button';
import 'vui/input';
import 'vui/dialog';
import 'vui/breadcrumbs';
import 'vui/text';
import 'vui/nav';
import 'vui/empty';
import 'vui/switch';
import 'vui/tabs';
import 'vui/menu';
import 'vui/icon';
import 'vui/icon-button';
import { CommandRegistry, ShortcutRegistry } from 'vui/interaction';
import type { VButton } from 'vui/button';
import type { VIconButton } from 'vui/icon-button';
import type { VDataGrid, VDataGridRow } from 'vui/data-grid';
import type { VDialog } from 'vui/dialog';
import type { VInput } from 'vui/input';
import type { VMenu, VMenuItem } from 'vui/menu';
import type { VSwitch } from 'vui/switch';
import { mountChrome, restoreTheme } from './chrome';
import {
  crumbs,
  formatModified,
  formatSize,
  iconFor,
  placeIcon,
  kindLabel,
  parentPath,
  pathTitle,
  type DirectoryPage,
  type FileEntry,
  type Place,
} from '../shared/files';
import type { OpenedSource, Result, SourceRequest } from '../shared/ipc';

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
  shell.setAttribute('aside-expand-label', 'Открыть панель');
  shell.setAttribute('aside-collapse-label', 'Закрыть панель');

  const navigate = document.createElement('vui-toolbar');
  navigate.setAttribute('slot', 'header');
  navigate.setAttribute('label', 'Навигация');
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

  const backButton = iconButton('Назад', 'arrow-left');
  const forwardButton = iconButton('Вперёд', 'arrow-right');
  const upButton = iconButton('Вверх', 'arrow-up');
  const refreshButton = iconButton('Обновить', 'refresh-cw');
  const renameButton = button('Переименовать', 'pencil');
  const copyButton = button('Копировать', 'copy');
  const moveButton = button('Переместить', 'folder');
  const deleteButton = button('Удалить', 'trash-2');
  deleteButton.setAttribute('variant', 'danger');
  const hiddenSwitch = document.createElement('vui-switch') as VSwitch;
  hiddenSwitch.setAttribute('slot', 'end');
  hiddenSwitch.setAttribute('label', 'Скрытые файлы');
  hiddenSwitch.textContent = 'Скрытые';

  const pathInput = document.createElement('vui-input') as VInput;
  pathInput.id = 'path';
  pathInput.setAttribute('label', '');
  pathInput.setAttribute('aria-label', 'Адрес');
  pathInput.setAttribute('type', 'text');
  pathInput.setAttribute('size', 'large');
  navigate.append(backButton, forwardButton, upButton, refreshButton, pathInput);
  commandBar.append(renameButton, copyButton, moveButton, deleteButton, hiddenSwitch);

  const nav = document.createElement('div');
  nav.setAttribute('slot', 'nav');
  nav.className = 'nav-block';
  const placesNav = document.createElement('vui-nav');
  placesNav.setAttribute('label', 'Быстрые ссылки');
  const rootsNav = document.createElement('vui-nav');
  rootsNav.setAttribute('label', 'Диски');
  const placesLabel = document.createElement('vui-text');
  placesLabel.setAttribute('variant', 'label');
  placesLabel.setAttribute('muted', '');
  placesLabel.textContent = 'Быстрые ссылки';
  const rootsLabel = document.createElement('vui-text');
  rootsLabel.setAttribute('variant', 'label');
  rootsLabel.setAttribute('muted', '');
  rootsLabel.textContent = 'Диски';
  nav.append(placesLabel, placesNav, rootsLabel, rootsNav);

  const stage = document.createElement('div');
  stage.className = 'stage';
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

  const trail = document.createElement('vui-breadcrumbs');
  trail.setAttribute('label', 'Путь');
  const grid = makeGrid('Файлы');
  const empty = document.createElement('vui-empty');
  empty.setAttribute('heading', 'Нет каталога');
  empty.setAttribute('label', 'Не удалось открыть расположение');
  stage.append(trail, grid, empty);
  empty.hidden = true;
  stage.toggleAttribute('data-active', true);

  const rightStage = document.createElement('div');
  rightStage.className = 'stage';
  rightStage.setAttribute('slot', 'aside');
  const rightTrail = document.createElement('vui-breadcrumbs');
  rightTrail.setAttribute('label', 'Путь второй панели');
  const rightGrid = makeGrid('Вторая панель');
  const rightEmpty = document.createElement('vui-empty');
  rightEmpty.setAttribute('heading', 'Нет каталога');
  rightEmpty.setAttribute('label', 'Не удалось открыть расположение');
  rightStage.append(rightTrail, rightGrid, rightEmpty);
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

  const fileMenu = document.createElement('vui-menu') as VMenu;
  fileMenu.setAttribute('label', 'Файл');
  const menuItems: Array<[string, string, string]> = [
    ['file.open', 'Открыть', 'folder-open'],
    ['file.rename', 'Переименовать', 'pencil'],
    ['file.copy', 'Копировать', 'copy'],
    ['file.move', 'Переместить', 'folder'],
    ['file.delete', 'Удалить', 'trash-2'],
  ];
  for (const [command, label, icon] of menuItems) {
    const item = document.createElement('vui-menu-item');
    item.setAttribute('command', command);
    item.setAttribute('label', label);
    item.setAttribute('icon', icon);
    fileMenu.append(item);
  }

  shell.append(navigate, commandBar, nav, stage, status, rightStage, dialog, fileMenu);
  app.append(shell);
  shell.addEventListener('aside-toggle', (event) => {
    const opening = event instanceof CustomEvent && event.detail?.opening === true;
    if (!opening) return;
    event.preventDefault();
    void window.vortex.openSources('pane');
  });

  const sessions: Session[] = [];
  let activeId = '';
  let page: DirectoryPage | null = null;
  let side: 'left' | 'right' = 'left';
  const right = { page: null as DirectoryPage | null, history: [] as string[], historyIndex: 0 };
  let showHidden = false;
  let busy = false;

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

  function selectedEntries(): FileEntry[] {
    const listing = currentPage();
    if (!listing) return [];
    const ids = new Set(currentGrid().selectedIds);
    return listing.entries.filter((entry) => ids.has(entry.path));
  }

  function syncCommands(): void {
    const session = active();
    const local = session?.kind === 'local';
    const onRight = side === 'right';
    const selected = selectedEntries();
    backButton.disabled = busy || (onRight ? right.historyIndex <= 0 : !local || !session || session.historyIndex <= 0);
    forwardButton.disabled = busy || (onRight
      ? right.historyIndex >= right.history.length - 1
      : !local || !session || session.historyIndex >= session.history.length - 1);
    upButton.disabled = busy || (onRight ? !right.page?.parent : !local || !page?.parent);
    renameButton.disabled = !local || selected.length !== 1 || busy;
    copyButton.disabled = !local || selected.length === 0 || busy;
    moveButton.disabled = !local || selected.length === 0 || busy;
    deleteButton.disabled = !local || selected.length === 0 || busy;
    refreshButton.disabled = busy || !currentPage() || (onRight ? false : !local);
    hiddenSwitch.disabled = busy || !local;
    pathInput.disabled = onRight ? !right.page : !local;
    const flags: Record<string, boolean> = {
      'file.open': Boolean(local && selected.length === 1 && !busy),
      'file.rename': !renameButton.disabled,
      'file.copy': !copyButton.disabled,
      'file.move': !moveButton.disabled,
      'file.delete': !deleteButton.disabled,
    };
    for (const [id, enabled] of Object.entries(flags)) {
      const command = commands.get(id);
      if (command) command.enabled = enabled;
    }
    fileMenu.querySelectorAll('vui-menu-item').forEach((item) => {
      if (item instanceof HTMLElement && 'refresh' in item) (item as VMenuItem).refresh();
    });
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

  function renderTrail(host: HTMLElement, target: string, follow: (path: string) => void): void {
    host.replaceChildren();
    const items = crumbs(target);
    for (const [index, item] of items.entries()) {
      if (index === items.length - 1) {
        const current = document.createElement('vui-text');
        current.setAttribute('variant', 'label');
        current.textContent = item.label;
        host.append(current);
        continue;
      }
      const link = button(item.label, 'folder', '');
      link.addEventListener('click', () => follow(item.path));
      host.append(link);
    }
  }

  function renderPlaces(host: HTMLElement, places: Place[], current: string): void {
    host.replaceChildren();
    for (const place of places) {
      const item = document.createElement('vui-nav-item');
      item.setAttribute('data-path', place.path);
      const icon = document.createElement('vui-icon');
      icon.setAttribute('name', placeIcon(place.id));
      item.append(icon, place.label);
      if (place.path === current) item.setAttribute('selected', '');
      host.append(item);
    }
  }

  function focusSide(next: 'left' | 'right'): void {
    side = next;
    stage.toggleAttribute('data-active', next === 'left');
    rightStage.toggleAttribute('data-active', next === 'right');
    const listing = currentPage();
    if (listing) pathInput.value = listing.path;
    fileMenu.bindTo(currentGrid());
    syncCommands();
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
    if (side === 'left') pathInput.value = next.path;
    renderTrail(trail, next.path, (path) => {
      focusSide('left');
      void openDirectory(path, true);
    });
    const rows: VDataGridRow[] = next.entries.map((entry) => ({
      id: entry.path,
      icon: iconFor(entry),
      name: entry.name,
      kind: kindLabel(entry.kind),
      size: formatSize(entry.size, entry.kind),
      modified: formatModified(entry.modified),
    }));
    grid.rows = rows;
    empty.hidden = true;
    grid.hidden = false;
    trail.hidden = false;
    const hiddenCount = next.entries.filter((entry) => entry.hidden).length;
    statusMain.textContent = `${next.entries.length} объектов${hiddenCount ? `, скрытых ${hiddenCount}` : ''}`;
    statusEnd.textContent = next.path;
    syncCommands();
  }

  function renderSide(next: DirectoryPage): void {
    right.page = next;
    if (side === 'right') pathInput.value = next.path;
    renderTrail(rightTrail, next.path, (path) => {
      focusSide('right');
      void openSide(path, true);
    });
    rightGrid.rows = next.entries.map((entry) => ({
      id: entry.path,
      icon: iconFor(entry),
      name: entry.name,
      kind: kindLabel(entry.kind),
      size: formatSize(entry.size, entry.kind),
      modified: formatModified(entry.modified),
    }));
    rightEmpty.hidden = true;
    rightGrid.hidden = false;
    rightTrail.hidden = false;
    if (side === 'right') {
      const hiddenCount = next.entries.filter((entry) => entry.hidden).length;
      statusMain.textContent = `${next.entries.length} объектов${hiddenCount ? `, скрытых ${hiddenCount}` : ''}`;
      statusEnd.textContent = next.path;
    }
    syncCommands();
  }

  function showRemote(session: Session): void {
    page = null;
    grid.rows = [];
    grid.hidden = true;
    trail.hidden = true;
    empty.hidden = false;
    empty.setAttribute('heading', session.label);
    empty.setAttribute(
      'label',
      `Источник ${session.kind.toUpperCase()} выбран. Каталог этой версии открывается только локально, провайдер ${session.user}@${session.host}:${session.port} подключится отдельно.`,
    );
    pathInput.value = session.path;
    statusMain.textContent = session.label;
    statusEnd.textContent = `${session.user}@${session.host}:${session.port}`;
    syncCommands();
  }

  function showError(message: string): void {
    statusMain.textContent = message;
    const view = side === 'right' ? rightEmpty : empty;
    const fileGrid = currentGrid();
    view.setAttribute('heading', 'Нет каталога');
    view.setAttribute('label', message);
    view.hidden = false;
    fileGrid.hidden = true;
    syncCommands();
  }

  async function openInPane(source: SourceRequest): Promise<void> {
    shell.removeAttribute('aside-collapsed');
    right.history = [];
    right.historyIndex = 0;
    right.page = null;
    focusSide('right');
    if (source.kind !== 'local') {
      rightGrid.rows = [];
      rightGrid.hidden = true;
      rightTrail.hidden = true;
      rightEmpty.hidden = false;
      rightEmpty.setAttribute('heading', source.label);
      rightEmpty.setAttribute(
        'label',
        `Источник ${source.kind.toUpperCase()} выбран. Каталог этой версии открывается только локально, провайдер ${source.user}@${source.host}:${source.port} подключится отдельно.`,
      );
      pathInput.value = source.path;
      statusMain.textContent = source.label;
      statusEnd.textContent = `${source.user}@${source.host}:${source.port}`;
      syncCommands();
      return;
    }
    await openSide(source.path, true);
  }

  async function openSide(target: string, record: boolean): Promise<void> {
    busy = true;
    syncCommands();
    if (side === 'right') statusMain.textContent = 'Чтение каталога…';
    try {
      const next = unwrap(await window.vortex.list(target, showHidden));
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
      focusSide('right');
      showError(error instanceof Error ? error.message : 'Не удалось открыть каталог');
    } finally {
      busy = false;
      syncCommands();
    }
  }

  async function openDirectory(target: string, record: boolean): Promise<void> {
    if (side === 'right') {
      await openSide(target, record);
      return;
    }
    const session = localSession();
    if (!session) return;
    busy = true;
    syncCommands();
    statusMain.textContent = 'Чтение каталога…';
    try {
      const next = unwrap(await window.vortex.list(target, showHidden));
      if (record && session.history[session.historyIndex] !== next.path) {
        session.history.splice(session.historyIndex + 1);
        session.history.push(next.path);
        session.historyIndex = session.history.length - 1;
      }
      renderPage(next);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Не удалось открыть каталог');
    } finally {
      busy = false;
      syncCommands();
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
    const listing = currentPage();
    const entry = listing?.entries.find((item) => item.path === currentGrid().selectedId);
    if (!entry) return;
    if (entry.kind === 'file' || entry.kind === 'other') {
      const result = await window.vortex.open(entry.path);
      if (!result.ok) statusMain.textContent = result.message;
      return;
    }
    await openDirectory(entry.path, true);
  }

  placesNav.addEventListener('change', () => {
    const target = placesNav.querySelector('[selected]')?.getAttribute('data-path');
    if (target) void openDirectory(target, true);
  });
  rootsNav.addEventListener('change', () => {
    const target = rootsNav.querySelector('[selected]')?.getAttribute('data-path');
    if (target) void openDirectory(target, true);
  });
  backButton.addEventListener('click', () => {
    if (side === 'right') {
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
  forwardButton.addEventListener('click', () => {
    if (side === 'right') {
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
  upButton.addEventListener('click', () => {
    const listing = currentPage();
    const parent = listing ? parentPath(listing.path) : null;
    if (parent) void openDirectory(parent, true);
  });
  refreshButton.addEventListener('click', () => {
    void reload();
  });
  addTab.addEventListener('click', () => {
    void window.vortex.openSources('tab');
  });
  hiddenSwitch.addEventListener('change', () => {
    showHidden = hiddenSwitch.checked;
    void reloadBoth();
  });
  pathInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    const next = pathInput.value.trim();
    if (next) void openDirectory(next, true);
  });
  renameButton.addEventListener('click', () => {
    const entry = selectedEntries()[0];
    if (!entry) return;
    void runAction(async () => {
      const name = await ask({ title: 'Переименовать', label: 'Новое имя', input: true, value: entry.name });
      if (!name) return false;
      unwrap(await window.vortex.rename(entry.path, name));
      return true;
    });
  });
  copyButton.addEventListener('click', () => {
    const entries = selectedEntries();
    if (!entries.length || !currentPage()) return;
    void runAction(async () => {
      const destination = await ask({ title: 'Копировать', label: 'Каталог назначения', input: true, value: currentPage()?.path ?? '' });
      if (!destination) return false;
      unwrap(await window.vortex.copy(entries.map((entry) => entry.path), destination));
      return true;
    });
  });
  moveButton.addEventListener('click', () => {
    const entries = selectedEntries();
    if (!entries.length || !currentPage()) return;
    void runAction(async () => {
      const destination = await ask({ title: 'Переместить', label: 'Каталог назначения', input: true, value: currentPage()?.path ?? '' });
      if (!destination) return false;
      unwrap(await window.vortex.move(entries.map((entry) => entry.path), destination));
      return true;
    });
  });
  deleteButton.addEventListener('click', () => {
    const entries = selectedEntries();
    if (!entries.length) return;
    void runAction(async () => {
      const accepted = await ask({
        title: 'Удалить',
        label: `Удалить объектов: ${entries.length}. Восстановление не предусмотрено.`,
        input: false,
        ok: 'Удалить',
      });
      if (!accepted) return false;
      unwrap(await window.vortex.remove(entries.map((entry) => entry.path)));
      return true;
    });
  });

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
      const listing = which === 'left' ? page : right.page;
      statusEnd.textContent = count ? `Выбрано: ${count}` : (listing?.path ?? '');
      syncCommands();
    });
    view.addEventListener('dblclick', () => {
      focusSide(which);
      void activate();
    });
    view.addEventListener(
      'contextmenu',
      (event) => {
        focusSide(which);
        const row = event.composedPath().find((node): node is HTMLElement => node instanceof HTMLElement && node.getAttribute('role') === 'row');
        const id = row?.dataset.id;
        if (id && !view.selectedIds.includes(id)) view.selectedIds = [id];
      },
      true,
    );
  }

  watchPane(grid, 'left');
  watchPane(rightGrid, 'right');
  fileMenu.bindTo(grid);

  const commands = new CommandRegistry();
  const shortcuts = new ShortcutRegistry(commands);
  fileMenu.commands = commands;
  commands.register({ id: 'go.back', label: 'Назад', execute: () => backButton.click() });
  commands.register({ id: 'go.forward', label: 'Вперёд', execute: () => forwardButton.click() });
  commands.register({ id: 'go.up', label: 'Вверх', execute: () => upButton.click() });
  commands.register({ id: 'file.rename', label: 'Переименовать', execute: () => renameButton.click() });
  commands.register({ id: 'file.copy', label: 'Копировать', execute: () => copyButton.click() });
  commands.register({ id: 'file.move', label: 'Переместить', execute: () => moveButton.click() });
  commands.register({ id: 'file.delete', label: 'Удалить', execute: () => deleteButton.click() });
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
    addSession(source);
  });

  void (async () => {
    try {
      const index = unwrap(await window.vortex.locations());
      renderPlaces(placesNav, index.places, index.places[0]?.path ?? '');
      renderPlaces(rootsNav, index.roots, '');
      const initial = index.places[0]?.path ?? index.roots[0]?.path;
      if (!initial) throw new Error('Нет доступных расположений');
      addSession({ kind: 'local', label: pathTitle(initial), path: initial, host: '', port: 0, user: '' });
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Vortex не запустился');
    }
  })();
}
