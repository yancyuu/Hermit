import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const EPERM_MAX_RETRIES = 3;
const EPERM_RETRY_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 0; attempt <= EPERM_MAX_RETRIES; attempt++) {
    try {
      await fs.promises.rename(src, dest);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EXDEV') {
        await fs.promises.copyFile(src, dest);
        await fs.promises.unlink(src).catch(() => undefined);
        return;
      }
      if (code === 'EPERM' && attempt < EPERM_MAX_RETRIES) {
        await sleep(EPERM_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

/**
 * Async atomic write: write tmp file then rename over target.
 * Uses best-effort fsync and EXDEV/EPERM fallback for safety.
 */
export async function atomicWriteAsync(targetPath: string, data: string): Promise<void> {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.tmp.${randomUUID()}`);

  try {
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tmpPath, data, 'utf8');

    let fd: fs.promises.FileHandle | null = null;
    try {
      fd = await fs.promises.open(tmpPath, 'r+');
      await fd.sync();
    } catch {
      // fsync is best-effort.
    } finally {
      await fd?.close();
    }

    await renameWithRetry(tmpPath, targetPath);
  } catch (error) {
    await fs.promises.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}
