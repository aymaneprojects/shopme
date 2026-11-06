import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readThemeDir } from '@shopme/core';

/** The premium themes shipped in `packages/themes/<handle>`. */
export const THEME_HANDLES = ['nocturne', 'terroir'] as const;
export type ThemeHandle = (typeof THEME_HANDLES)[number];

export const themeDir = (handle: string) => fileURLToPath(new URL(`../../../../packages/themes/${handle}`, import.meta.url));
export const loadThemeFiles = (handle: string) => readThemeDir(themeDir(handle));
export const loadJson = (handle: string, file: string): Record<string, unknown> | unknown[] => JSON.parse(readFileSync(path.join(themeDir(handle), file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''));
