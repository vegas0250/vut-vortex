import type { Place } from '../../shared/files';

export interface KnownPlaces {
  home: string;
  desktop: string | null;
  documents: string | null;
  downloads: string | null;
  temporary: string;
}

/** OS differences stay behind this adapter. Callers do not branch on the host OS. */
export interface PlatformAdapter {
  id: 'windows' | 'linux';
  isHiddenName(name: string): boolean;
  hiddenNames(directory: string): Promise<ReadonlySet<string>>;
  roots(): Promise<Place[]>;
  places(): KnownPlaces;
}
