import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, screen, type WebContents } from 'electron';
import source from './shell-menu.cs?raw';
import type { ContextAction, ContextMenuRequest } from '../../shared/ipc';

const compilers = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

function compiler(): string | null {
  return compilers.find((item) => existsSync(item)) ?? null;
}

async function helper(): Promise<string> {
  const directory = path.join(app.getPath('userData'), 'shell-menu');
  const stamp = createHash('sha256').update(source).digest('hex').slice(0, 16);
  const executable = path.join(directory, 'ShellMenu.exe');
  const marker = path.join(directory, 'source.sha');
  const current = existsSync(marker) ? await readFile(marker, 'utf8') : '';
  if (current === stamp && existsSync(executable)) return executable;
  const csc = compiler();
  if (!csc) throw new Error('Компилятор Windows для системного меню не найден');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, 'ShellMenu.cs');
  await writeFile(file, source, 'utf8');
  await run(csc, ['/nologo', '/optimize+', '/target:exe', `/out:${executable}`, file], directory);
  await writeFile(marker, stamp, 'utf8');
  return executable;
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true });
    let error = '';
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(error.trim() || 'Не удалось собрать системное меню'));
    });
  });
}

function point(sender: WebContents, x: number, y: number): { x: number; y: number } {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window) return { x, y };
  const bounds = window.getContentBounds();
  return screen.dipToScreenPoint({ x: Math.round(bounds.x + x), y: Math.round(bounds.y + y) });
}

function ownerHandle(sender: WebContents): string {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window) return '0';
  const handle = window.getNativeWindowHandle();
  const value = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  return BigInt.asIntN(64, value).toString();
}

export async function popupWindowsShellMenu(
  request: ContextMenuRequest,
  sender: WebContents,
): Promise<ContextAction | null | 'fallback'> {
  if (process.platform !== 'win32') return 'fallback';
  const paths = request.paths.filter((item) => item.trim().length > 0);
  const directory = request.directory.trim();
  if (!paths.length && !directory) return 'fallback';
  let executable: string;
  try {
    executable = await helper();
  } catch (error) {
    console.error(error);
    return 'fallback';
  }
  const where = point(sender, request.x, request.y);
  const mode = paths.length ? 'files' : 'folder';
  const targets = paths.length ? paths : [directory];
  const args = [String(where.x), String(where.y), request.extended ? '1' : '0', ownerHandle(sender), mode, ...targets];
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd: tmpdir(), windowsHide: true });
    let output = '';
    let error = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.on('error', (failure) => {
      console.error(failure);
      resolve('fallback');
    });
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(error.trim() || 'Системное меню закрылось с ошибкой');
        resolve('fallback');
        return;
      }
      resolve(output.includes('invoked') ? 'shell' : null);
    });
  });
}
