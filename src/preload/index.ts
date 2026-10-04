import { contextBridge, ipcRenderer } from 'electron';
import {
  channels,
  type ContextAction,
  type ContextMenuRequest,
  type ShellMenuNode,
  type OpenedSource,
  type Result,
  type SourceRequest,
  type SourceTarget,
} from '../shared/ipc';
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
  contextMenu: (request: ContextMenuRequest): Promise<Result<ContextAction | null>> =>
    ipcRenderer.invoke(channels.contextMenu, request),
  shellMenu: (request: ContextMenuRequest): Promise<Result<ShellMenuNode[] | null>> =>
    ipcRenderer.invoke(channels.shellMenu, request),
  shellInvoke: (command: number): Promise<Result<boolean>> => ipcRenderer.invoke(channels.shellInvoke, command),
  shellDismiss: (): Promise<Result<void>> => ipcRenderer.invoke(channels.shellDismiss),
  minimize: (): void => ipcRenderer.send(channels.minimize),
  toggleMaximize: (): void => ipcRenderer.send(channels.toggleMaximize),
  close: (): void => ipcRenderer.send(channels.close),
  onMaximized: (listener: (maximized: boolean) => void): void => {
    ipcRenderer.on(channels.state, (_event, value: unknown) => listener(value === true));
  },
  openSources: (target: SourceTarget = 'tab'): Promise<void> => ipcRenderer.invoke(channels.openSources, target),
  chooseSource: (source: SourceRequest): void => ipcRenderer.send(channels.source, source),
  onSource: (listener: (source: OpenedSource) => void): void => {
    ipcRenderer.on(channels.source, (_event, value: OpenedSource) => listener(value));
  },
};

contextBridge.exposeInMainWorld('vortex', api);

export type VortexApi = typeof api;
