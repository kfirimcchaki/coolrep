#!/usr/bin/env node
/** Deletes the local JSON database (and generated session secret). */
import { rm } from 'node:fs/promises';
import path from 'node:path';

const dir = process.env.DATA_DIR || path.join(process.cwd(), '.data');
await rm(dir, { recursive: true, force: true });
console.log(`removed ${dir}`);
