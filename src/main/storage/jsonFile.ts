import { promises as fs } from 'node:fs';
import path from 'node:path';

/** 原子写入：先写临时文件再改名，避免断电/崩溃留下半个文件。 */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, file);
}

export async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function removeFile(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch {
    // 文件本来不存在就算达成目标
  }
}
