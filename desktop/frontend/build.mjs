import { mkdir, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
await mkdir(resolve(root, 'dist'), { recursive: true });
await copyFile(resolve(root, 'index.html'), resolve(root, 'dist/index.html'));
