import type { DirectoryPage, Place } from '../../shared/files';

/** OS differences stay behind this adapter. Callers do not branch on the host OS. */
export interface PlatformAdapter {
  id: 'windows' | 'linux';
  isHiddenName(name: string): boolean;
  hiddenNames(directory: string): Promise<ReadonlySet<string>>;
  roots(): Promise<Place[]>;
  quickLinks(): Promise<Place[]>;
  specialList(target: string, showHidden: boolean): Promise<DirectoryPage | null>;
}
