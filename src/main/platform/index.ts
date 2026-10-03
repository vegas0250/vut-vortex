import type { Place } from '../../shared/files';
import { posixPlatform } from './posix';
import type { PlatformAdapter } from './types';
import { windowsPlatform } from './windows';

export function platform(): PlatformAdapter {
  return process.platform === 'win32' ? windowsPlatform : posixPlatform;
}

export function locationPlaces(adapter: PlatformAdapter = platform()): Promise<Place[]> {
  return adapter.quickLinks();
}
