import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ContextMenuItem, ContextMenuQuery } from '../../shared/context-menu';
import { desktopId } from '../../shared/context-menu';
import type { SystemMenuProvider } from './service';
import { systemCommandId } from './shell-nodes';
import {
  linuxCapabilities,
  linuxMenuItems,
  parseDesktopEntry,
  parseMimeGlobs,
  parseServiceMenu,
  selectionFiles,
  type DesktopEntry,
  type LinuxCapabilities,
  type LinuxIndex,
  type ServiceEntry,
} from './linux-menu';

const indexTtlMs = 60_000;

export interface LinuxProbe {
  env: Readonly<Record<string, string | undefined>>;
  exists(file: string): boolean;
  read(file: string): Promise<string>;
  list(directory: string): Promise<string[]>;
}

export function nodeLinuxProbe(): LinuxProbe {
  return {
    env: process.env,
    exists: (file) => existsSync(file),
    read: (file) => readFile(file, 'utf8'),
    list: async (directory) => {
      try {
        return await readdir(directory);
      } catch {
        return [];
      }
    },
  };
}

function dataDirs(env: Readonly<Record<string, string | undefined>>): string[] {
  const home = env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), '.local', 'share');
  const rest = (env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':').filter(Boolean);
  return [home, ...rest];
}

async function readDesktopFiles(probe: LinuxProbe, directory: string): Promise<string[]> {
  const names = await probe.list(directory);
  const texts: string[] = [];
  for (const name of names) {
    if (!name.endsWith('.desktop')) continue;
    try {
      texts.push(await probe.read(path.join(directory, name)));
    } catch {
      // A desktop file that cannot be read is skipped. The menu still opens.
    }
  }
  return texts;
}

export class LinuxContextMenuProvider implements SystemMenuProvider {
  readonly id = 'linux' as const;
  readonly replacesSession = false;
  private commands = new Map<string, string[]>();
  private index: LinuxIndex | null = null;
  private globs = new Map<string, string>();
  private indexedAt = 0;
  private capabilitiesCache: LinuxCapabilities | null = null;

  constructor(private readonly probe: LinuxProbe = nodeLinuxProbe()) {}

  capabilities(): LinuxCapabilities {
    return this.capabilitiesCache ?? linuxCapabilities({
      desktop: desktopId(this.probe.env),
      applicationCount: 0,
      serviceCount: 0,
      gio: false,
      xdgOpen: false,
      mimeGlobs: false,
    });
  }

  async warm(): Promise<void> {
    await this.refresh();
  }

  async get(query: ContextMenuQuery): Promise<ContextMenuItem[]> {
    const index = await this.refresh();
    const files = selectionFiles(query, this.globs);
    if (!files.length) return [];
    return linuxMenuItems(query, index, this.capabilities().desktop, files, systemCommandId, (id, argv) => {
      this.commands.set(id, argv);
    });
  }

  async execute(commandId: string): Promise<boolean> {
    const argv = this.commands.get(commandId);
    const command = argv?.[0];
    if (!argv || !command || argv.some((part) => part.includes('\0'))) return false;
    const child = spawn(command, argv.slice(1), { detached: true, stdio: 'ignore' });
    child.on('error', (error) => console.error(error));
    child.unref();
    return true;
  }

  forget(commandIds: readonly string[]): void {
    for (const id of commandIds) this.commands.delete(id);
  }

  async release(): Promise<void> {
    this.commands.clear();
  }

  async shutdown(): Promise<void> {
    await this.release();
  }

  private async refresh(): Promise<LinuxIndex> {
    if (this.index && Date.now() - this.indexedAt < indexTtlMs) return this.index;
    const dirs = dataDirs(this.probe.env);
    const applications: DesktopEntry[] = [];
    const services: ServiceEntry[] = [];
    for (const root of dirs) {
      for (const text of await readDesktopFiles(this.probe, path.join(root, 'applications'))) {
        const entry = parseDesktopEntry(text);
        if (entry) applications.push(entry);
      }
      const serviceDirs = [
        path.join(root, 'kio', 'servicemenus'),
        path.join(root, 'kservices5', 'ServiceMenus'),
        path.join(root, 'kservices6', 'ServiceMenus'),
      ];
      for (const directory of serviceDirs) {
        for (const text of await readDesktopFiles(this.probe, directory)) {
          services.push(...parseServiceMenu(text));
        }
      }
    }
    const globFile = ['/usr/share/mime/globs2', '/usr/share/mime/globs'].find((file) => this.probe.exists(file));
    this.globs = globFile ? parseMimeGlobs(await this.probe.read(globFile)) : new Map();
    const xdgOpen = ['/usr/bin/xdg-open', '/bin/xdg-open'].some((file) => this.probe.exists(file));
    const gio = ['/usr/bin/gio', '/bin/gio'].some((file) => this.probe.exists(file));
    this.index = { applications, services, xdgOpen };
    this.indexedAt = Date.now();
    this.capabilitiesCache = linuxCapabilities({
      desktop: desktopId(this.probe.env),
      applicationCount: applications.length,
      serviceCount: services.length,
      gio,
      xdgOpen,
      mimeGlobs: this.globs.size > 0,
    });
    return this.index;
  }
}
