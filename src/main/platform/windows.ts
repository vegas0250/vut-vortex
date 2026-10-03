import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Place } from '../../shared/files';
import type { KnownPlaces, PlatformAdapter } from './types';

const execFileAsync = promisify(execFile);

async function readable(target: string): Promise<boolean> {
  try {
    await access(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function hiddenListing(directory: string, attributes: string): Promise<string[]> {
  const { stdout } = await execFileAsync('cmd.exe', ['/d', '/c', 'dir', attributes, '/b', directory], {
    windowsHide: true,
    timeout: 8000,
  });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export const windowsPlatform: PlatformAdapter = {
  id: 'windows',
  isHiddenName(name: string): boolean {
    return name.startsWith('.');
  },
  async hiddenNames(directory: string): Promise<ReadonlySet<string>> {
    try {
      const files = await hiddenListing(directory, '/a:h-d');
      const directories = await hiddenListing(directory, '/a:hd');
      return new Set([...files, ...directories]);
    } catch {
      return new Set();
    }
  },
  async roots(): Promise<Place[]> {
    const found: Place[] = [];
    for (let code = 65; code <= 90; code += 1) {
      const root = `${String.fromCharCode(code)}:\\`;
      if (await readable(root)) found.push({ id: root, label: root, path: root });
    }
    return found;
  },
  places(): KnownPlaces {
    const home = homedir();
    const profile = process.env.USERPROFILE || home;
    return {
      home,
      desktop: path.join(profile, 'Desktop'),
      documents: path.join(profile, 'Documents'),
      downloads: path.join(profile, 'Downloads'),
      temporary: tmpdir(),
    };
  },
};
