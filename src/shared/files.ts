export type FileKind = 'file' | 'directory' | 'symlink' | 'other';

export interface FileEntry {
  name: string;
  path: string;
  kind: FileKind;
  size: number | null;
  modified: number | null;
  hidden: boolean;
}

export interface DirectoryPage {
  path: string;
  parent: string | null;
  separator: '/' | '\\';
  entries: FileEntry[];
}

export interface Place {
  id: string;
  label: string;
  path: string;
}

export interface LocationIndex {
  places: Place[];
  roots: Place[];
}

export interface Crumb {
  label: string;
  path: string;
}

export function separatorOf(target: string): '/' | '\\' {
  return target.includes('\\') ? '\\' : '/';
}

export function parentPath(target: string): string | null {
  const trimmed = target.replace(/[\\/]+$/, '');
  if (!trimmed || trimmed === '/' || /^[A-Za-z]:$/.test(trimmed)) return null;
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (index < 0) return null;
  if (index === 0) return '/';
  const parent = trimmed.slice(0, index);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent;
}

export function crumbs(target: string): Crumb[] {
  const separator = separatorOf(target);
  const rootMatch = target.match(/^[A-Za-z]:\\/) ?? (target.startsWith('/') ? ['/'] : null);
  const root = rootMatch ? rootMatch[0] : '';
  const rest = (root ? target.slice(root.length) : target).split(/[\\/]/).filter(Boolean);
  const items: Crumb[] = [];
  if (root) items.push({ label: root, path: root });
  let current = root;
  for (const part of rest) {
    current = current ? (current.endsWith(separator) ? `${current}${part}` : `${current}${separator}${part}`) : part;
    items.push({ label: part, path: current });
  }
  if (!items.length && target) items.push({ label: target, path: target });
  return items;
}

export function singleSegment(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/\0]/.test(trimmed)) {
    throw new Error('Недопустимое имя');
  }
  return trimmed;
}

export function sortEntries(entries: readonly FileEntry[]): FileEntry[] {
  return [...entries].sort((left, right) => {
    const leftDir = left.kind === 'directory' ? 0 : 1;
    const rightDir = right.kind === 'directory' ? 0 : 1;
    if (leftDir !== rightDir) return leftDir - rightDir;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function formatSize(size: number | null, kind: FileKind): string {
  if (kind === 'directory' || size === null) return '';
  if (size < 1024) return `${size} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatModified(modified: number | null): string {
  if (modified === null) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(modified);
}

export function kindLabel(kind: FileKind): string {
  if (kind === 'directory') return 'Каталог';
  if (kind === 'symlink') return 'Ссылка';
  if (kind === 'file') return 'Файл';
  return 'Объект';
}

const imageExt = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const audioExt = new Set(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac']);
const videoExt = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi']);
const archiveExt = new Set(['zip', '7z', 'tar', 'gz', 'tgz', 'rar', 'bz2', 'xz']);
const textExt = new Set(['txt', 'md', 'json', 'log', 'csv', 'xml', 'yml', 'yaml', 'ini']);
const codeExt = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'css', 'html', 'vue']);

export function iconFor(entry: Pick<FileEntry, 'kind' | 'name'>): string {
  if (entry.kind === 'directory') return 'folder';
  const ext = entry.name.includes('.') ? (entry.name.split('.').pop() ?? '').toLowerCase() : '';
  if (imageExt.has(ext)) return 'file-image';
  if (audioExt.has(ext)) return 'file-audio';
  if (videoExt.has(ext)) return 'file-play';
  if (archiveExt.has(ext)) return 'file-archive';
  if (codeExt.has(ext)) return 'file-code';
  if (textExt.has(ext)) return 'file-text';
  return 'file';
}

export function placeIcon(id: string): string {
  if (id === 'home') return 'house';
  if (id === 'desktop') return 'monitor';
  if (id === 'documents') return 'file-text';
  if (id === 'downloads') return 'download';
  if (id === 'temporary') return 'clock';
  return 'hard-drive';
}

export function pathTitle(target: string): string {
  const trimmed = target.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? target;
}
