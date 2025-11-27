import fs from 'fs-extra';
import path from 'path';
import { CraftDeskJson } from '../types/craftdesk-json';
import { CraftDeskLock } from '../types/craftdesk-lock';

export async function readCraftDeskJson(dir: string = process.cwd()): Promise<CraftDeskJson | null> {
  const filePath = path.join(dir, 'craftdesk.json');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function writeCraftDeskJson(data: CraftDeskJson, dir: string = process.cwd()): Promise<void> {
  const filePath = path.join(dir, 'craftdesk.json');
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function readCraftDeskLock(dir: string = process.cwd()): Promise<CraftDeskLock | null> {
  const filePath = path.join(dir, 'craftdesk.lock');

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function writeCraftDeskLock(data: CraftDeskLock, dir: string = process.cwd()): Promise<void> {
  const filePath = path.join(dir, 'craftdesk.lock');
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.ensureDir(dirPath);
}

export async function removeDir(dirPath: string): Promise<void> {
  await fs.remove(dirPath);
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}