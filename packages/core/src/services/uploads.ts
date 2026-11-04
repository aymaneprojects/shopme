import { files } from '../db/schema';
import type { Executor } from '../db/client';
import { makeStorageKey, type Storage } from './storage';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Store bytes and record a `files` row. Returns the row plus its public URL. */
export async function saveUpload(db: Executor, storage: Storage, shopId: number, input: { filename: string; data: Buffer; mimeType?: string; alt?: string }) {
  if (input.data.length > MAX_UPLOAD_BYTES) throw new Error('File too large');
  const storageKey = makeStorageKey(input.filename);
  await storage.put(storageKey, input.data);
  const [row] = await db.insert(files).values({ shopId, filename: input.filename.slice(0, 255), storageKey, mimeType: input.mimeType, byteSize: input.data.length, alt: input.alt }).returning();
  return { ...row!, url: storage.url(storageKey) };
}
