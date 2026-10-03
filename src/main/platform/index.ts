import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import type { Place } from '../../shared/files';
import { linuxPlaces, posixPlatform } from './posix';
import type { PlatformAdapter } from './types';
import { windowsPlatform } from './windows';

export function platform(): PlatformAdapter {
  return process.platform === 'win32' ? windowsPlatform : posixPlatform;
}

async function readable(target: string): Promise<boolean> {
  try {
    await access(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export async function locationPlaces(adapter: PlatformAdapter = platform()): Promise<Place[]> {
  if (adapter.id === 'linux') return linuxPlaces(adapter);
  const known = adapter.places();
  const candidates: Place[] = [
    { id: 'home', label: 'Домой', path: known.home },
    ...(known.desktop ? [{ id: 'desktop', label: 'Рабочий стол', path: known.desktop }] : []),
    ...(known.documents ? [{ id: 'documents', label: 'Документы', path: known.documents }] : []),
    ...(known.downloads ? [{ id: 'downloads', label: 'Загрузки', path: known.downloads }] : []),
    { id: 'temporary', label: 'Временные', path: known.temporary },
  ];
  const places: Place[] = [];
  for (const candidate of candidates) {
    if (candidate.id === 'home' || (await readable(candidate.path))) places.push(candidate);
  }
  return places;
}
