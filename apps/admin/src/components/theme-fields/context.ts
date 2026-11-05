import { createContext } from 'react';
import type { SchemeSet } from '../../lib/settings-schema';

/** The theme's color schemes, so a `color_scheme` setting can list them. */
export const SchemesContext = createContext<SchemeSet>({});

/** The template the preview shows (its dynamic sources), or null where a setting cannot read page data (theme settings). */
export const SourcesContext = createContext<string | null>(null);
