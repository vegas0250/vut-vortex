import 'vui/shell';
import 'vui/text';
import 'vui/button';
import 'vui/input';
import 'vui/nav';
import 'vui/icon';
import { mountChrome, restoreTheme } from './chrome';
import type { VInput } from 'vui/input';
import type { SourceKind, SourceRequest } from '../shared/ipc';
import type { Place } from '../shared/files';

const kinds: Array<{ kind: SourceKind; label: string; detail: string; icon: string; port: number }> = [
  { kind: 'local', label: 'Локальный', detail: 'Диски и папки этого компьютера', icon: 'hard-drive', port: 0 },
  { kind: 'ssh', label: 'SSH', detail: 'Оболочка на удалённой машине', icon: 'terminal', port: 22 },
  { kind: 'sftp', label: 'SFTP', detail: 'Файлы по SSH', icon: 'server', port: 22 },
  { kind: 'ftp', label: 'FTP', detail: 'Файлы по FTP', icon: 'globe', port: 21 },
];

export function mountSources(): void {
  restoreTheme();
  const app = document.querySelector('#app');
  if (!app) throw new Error('Не найдено окно приложения');
  mountChrome(app, 'Источник', 'hard-drive', window.vortex);

  const shell = document.createElement('vui-shell');
  shell.setAttribute('label', 'Источник');
  shell.setAttribute('nav-label', 'Тип источника');
  const nav = document.createElement('div');
  nav.setAttribute('slot', 'nav');
  const list = document.createElement('vui-nav');
  list.setAttribute('label', 'Тип источника');
  for (const [index, source] of kinds.entries()) {
    const item = document.createElement('vui-nav-item');
    item.setAttribute('data-kind', source.kind);
    item.textContent = source.label;
    if (index === 0) item.setAttribute('selected', '');
    list.append(item);
  }
  nav.append(list);

  const stage = document.createElement('div');
  stage.className = 'stage source-stage';
  const scroll = document.createElement('div');
  scroll.className = 'source-scroll';
  const heading = document.createElement('vui-text');
  heading.setAttribute('variant', 'heading');
  heading.setAttribute('level', '2');
  const detail = document.createElement('vui-text');
  detail.setAttribute('muted', '');
  const places = document.createElement('vui-nav');
  places.setAttribute('label', 'Расположения');
  const host = document.createElement('vui-input') as VInput;
  host.setAttribute('label', 'Хост');
  const port = document.createElement('vui-input') as VInput;
  port.setAttribute('label', 'Порт');
  port.setAttribute('type', 'number');
  const user = document.createElement('vui-input') as VInput;
  user.setAttribute('label', 'Пользователь');
  const remotePath = document.createElement('vui-input') as VInput;
  remotePath.setAttribute('label', 'Путь');
  remotePath.value = '/';
  const connect = document.createElement('vui-button');
  connect.setAttribute('variant', 'primary');
  connect.textContent = 'Открыть';
  scroll.append(heading, detail, places, host, port, user, remotePath);
  stage.append(scroll, connect);
  shell.append(nav, stage);
  app.append(shell);

  let kind: SourceKind = 'local';
  let locations: Place[] = [];

  function selectedPlace(): string {
    return places.querySelector('[selected]')?.getAttribute('data-path') ?? '';
  }

  function paint(): void {
    const source = kinds.find((item) => item.kind === kind) ?? kinds[0];
    if (!source) return;
    heading.textContent = source.label;
    detail.textContent = source.detail;
    const local = source.kind === 'local';
    places.hidden = !local;
    host.hidden = local;
    port.hidden = local;
    user.hidden = local;
    remotePath.hidden = local;
    if (!local && !port.value) port.value = String(source.port);
  }

  list.addEventListener('change', () => {
    const next = list.querySelector('[selected]')?.getAttribute('data-kind');
    if (next === 'local' || next === 'ssh' || next === 'sftp' || next === 'ftp') kind = next;
    paint();
  });

  connect.addEventListener('click', () => {
    const source = kinds.find((item) => item.kind === kind);
    if (!source) return;
    if (source.kind === 'local') {
      const path = selectedPlace();
      if (!path) return;
      const place = locations.find((item) => item.path === path);
      const request: SourceRequest = {
        kind: 'local',
        label: place?.label || path,
        path,
        host: '',
        port: 0,
        user: '',
      };
      window.vortex.chooseSource(request);
      return;
    }
    const hostName = host.value.trim();
    const userName = user.value.trim();
    if (!hostName || !userName) return;
    const request: SourceRequest = {
      kind: source.kind,
      label: `${source.label} ${userName}@${hostName}`,
      path: remotePath.value.trim() || '/',
      host: hostName,
      port: Number(port.value) || source.port,
      user: userName,
    };
    window.vortex.chooseSource(request);
  });

  void (async () => {
    const index = await window.vortex.locations();
    if (!index.ok) {
      detail.textContent = index.message;
      return;
    }
    locations = [...index.value.places, ...index.value.roots];
    places.replaceChildren();
    for (const [indexPlace, place] of locations.entries()) {
      const item = document.createElement('vui-nav-item');
      item.setAttribute('data-path', place.path);
      item.textContent = place.label;
      if (indexPlace === 0) item.setAttribute('selected', '');
      places.append(item);
    }
    paint();
  })();
}
