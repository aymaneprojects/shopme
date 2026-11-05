export interface SettingDef { type: string; id?: string; label?: string; default?: unknown; options?: { value: string; label: string }[]; [k: string]: unknown }

export interface BlockSchema { type: string; name?: string; settings?: SettingDef[]; limit?: number }

export interface FileSchema {
  name?: string;
  tag?: string | null;
  class?: string;
  settings?: SettingDef[];
  blocks?: BlockSchema[];
  presets?: unknown[];
  max_blocks?: number;
  [k: string]: unknown;
}

export interface BlockInstance {
  type: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, BlockInstance>;
  block_order?: string[];
  static?: boolean;
  disabled?: boolean;
  name?: string;
}

export interface SectionInstance extends BlockInstance { custom_css?: string[] }

export interface SectionsMap { sections?: Record<string, SectionInstance>; order?: string[] }

export interface TemplateJson extends SectionsMap { layout?: string | false }

export interface SectionGroupJson extends SectionsMap { type?: string; name?: string }

export interface ImageValue { id?: number; src: string; alt?: string | null; width?: number | null; height?: number | null; aspect_ratio?: number | null; [k: string]: unknown }

/** Data lookups the renderer needs while evaluating typed settings. Implemented by the server (database). */
export interface ResourceResolvers {
  collection?(handle: string): Promise<unknown>;
  product?(handle: string): Promise<unknown>;
  page?(handle: string): Promise<unknown>;
  blog?(handle: string): Promise<unknown>;
  /** `shopify://metaobjects/<type>/<handle>` (or `<type>/<handle>`, or a metaobject GID) to an entry. */
  metaobject?(ref: string): Promise<unknown>;
  linklist?(handle: string): Promise<unknown>;
  /** `shopify://shop_images/x.jpg` style value or URL to an image object. */
  image?(value: string): ImageValue | null;
}
