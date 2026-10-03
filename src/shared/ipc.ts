export const channels = {
  list: 'fs:list',
  locations: 'fs:locations',
  mkdir: 'fs:mkdir',
  rename: 'fs:rename',
  remove: 'fs:remove',
  copy: 'fs:copy',
  move: 'fs:move',
  open: 'fs:open',
} as const;

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export function failure(error: unknown): Result<never> {
  return { ok: false, message: error instanceof Error ? error.message : 'Неизвестная ошибка' };
}
