import { createHash } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, type WebContents } from 'electron';
import source from './shell-menu.cs?raw';
import type { ContextMenuRequest, ShellMenuNode } from '../../shared/ipc';

const compilers = [
  'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
  'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
];

interface ShellSession {
  child: ChildProcessWithoutNullStreams;
  nextLine: () => Promise<string | null>;
  error: string;
}

let active: ShellSession | null = null;

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

function lines(child: ChildProcessWithoutNullStreams): () => Promise<string | null> {
  let buffer = '';
  let ended = false;
  const ready: string[] = [];
  const waiters: Array<(line: string | null) => void> = [];
  const push = (line: string | null): void => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else if (line !== null) ready.push(line);
  };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    let index = buffer.indexOf('\n');
    while (index >= 0) {
      push(buffer.slice(0, index).replace(/\r$/, ''));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf('\n');
    }
  });
  child.stdout.on('end', () => {
    ended = true;
    if (buffer.length > 0) push(buffer);
    push(null);
  });
  return () => {
    const line = ready.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (ended) return Promise.resolve(null);
    return new Promise((resolve) => waiters.push(resolve));
  };
}

function ownerHandle(sender: WebContents): string {
  const window = BrowserWindow.fromWebContents(sender);
  if (!window) return '0';
  const handle = window.getNativeWindowHandle();
  const value = handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0));
  return BigInt.asIntN(64, value).toString();
}

function nodesFrom(value: unknown): ShellMenuNode[] {
  if (!Array.isArray(value)) return [];
  const nodes: ShellMenuNode[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Partial<ShellMenuNode>;
    const children = nodesFrom(record.children);
    const command = typeof record.command === 'number' && Number.isInteger(record.command) && record.command >= 0
      ? record.command
      : null;
    const separator = record.separator === true;
    const label = typeof record.label === 'string' ? record.label : '';
    const shortcut = typeof record.shortcut === 'string' ? record.shortcut : '';
    if (separator) {
      if (nodes.length === 0 || nodes[nodes.length - 1]?.separator) continue;
      nodes.push({ label: '', shortcut: '', separator: true, disabled: false, checked: false, command: null, children: [] });
      continue;
    }
    if (!label && children.length === 0) continue;
    if (command === null && children.length === 0) continue;
    nodes.push({
      label,
      shortcut,
      separator: false,
      disabled: record.disabled === true,
      checked: record.checked === true,
      command: children.length > 0 ? null : command,
      children,
    });
  }
  while (nodes.at(-1)?.separator) nodes.pop();
  return nodes;
}

function release(session: ShellSession | null): void {
  if (!session) return;
  try {
    session.child.stdin.write('cancel\n');
  } catch {
    session.child.kill();
  }
}

export async function readWindowsShellMenu(
  request: ContextMenuRequest,
  sender: WebContents,
): Promise<ShellMenuNode[] | null> {
  release(active);
  active = null;
  if (process.platform !== 'win32') return null;
  const paths = request.paths.filter((item) => item.trim().length > 0);
  const directory = request.directory.trim();
  if (!paths.length && !directory) return null;
  let executable: string;
  try {
    executable = await helper();
  } catch (error) {
    console.error(error);
    return null;
  }
  const mode = paths.length ? 'files' : 'folder';
  const targets = paths.length ? paths : [directory];
  const child = spawn(executable, ['list'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const session: ShellSession = { child, nextLine: lines(child), error: '' };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    session.error += chunk;
  });
  child.stdin.setDefaultEncoding('utf8');
  child.stdin.write([
    `extended ${request.extended ? '1' : '0'}`,
    `owner ${ownerHandle(sender)}`,
    `mode ${mode}`,
    ...targets.map((item) => `path ${item}`),
    '.',
    '',
  ].join('\n'));
  const line = await session.nextLine();
  if (!line) {
    console.error(session.error.trim() || 'Системное меню не вернуло пункты');
    child.kill();
    return null;
  }
  try {
    const nodes = nodesFrom(JSON.parse(line) as unknown);
    if (!nodes.length) {
      release(session);
      return null;
    }
    active = session;
    return nodes;
  } catch (error) {
    console.error(error);
    child.kill();
    return null;
  }
}

export async function invokeWindowsShellMenu(command: number): Promise<boolean> {
  const session = active;
  active = null;
  if (!session || !Number.isInteger(command) || command < 0) return false;
  try {
    session.child.stdin.write(`invoke ${command}\n`);
  } catch {
    return false;
  }
  const line = await session.nextLine();
  return line === 'invoked';
}

export async function dismissWindowsShellMenu(): Promise<void> {
  const session = active;
  active = null;
  release(session);
}
