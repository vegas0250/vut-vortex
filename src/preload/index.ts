import { contextBridge, ipcRenderer } from 'electron';
import { channels, type Result } from '../shared/ipc';
import type { DirectoryPage, LocationIndex } from '../shared/files';


const api = {
  list: (target: string, showHidden: boolean): Promise<Result<DirectoryPage>> =>
    ipcRenderer.invoke(channels.list, target, showHidden),
  locations: (): Promise<Result<LocationIndex>> => ipcRenderer.invoke(channels.locations),
  mkdir: (parent: string, name: string): Promise<Result<string>> => ipcRenderer.invoke(channels.mkdir, parent, name),
  rename: (target: string, name: string): Promise<Result<string>> => ipcRenderer.invoke(channels.rename, target, name),
  remove: (targets: string[]): Promise<Result<void>> => ipcRenderer.invoke(channels.remove, targets),
  copy: (targets: string[], destination: string): Promise<Result<void>> =>
    ipcRenderer.invoke(channels.copy, targets, destination),
  move: (targets: string[], destination: string): Promise<Result<void>> =>
    ipcRenderer.invoke(channels.move, targets, destination),
  open: (target: string): Promise<Result<void>> => ipcRenderer.invoke(channels.open, target),
};

contextBridge.exposeInMainWorld('vortex', api);

export type VortexApi = typeof api;
