import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type OutputInfo } from 'sharp';
import { type Db, schema } from '@opencook/db';
import { safeFetch } from '@opencook/recipe-import';
import type { ImageInfo } from '@opencook/schemas';
import { HttpError } from './errors.js';

const MAX_SIDE = 1600;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function imageUrl(imageId: string | null): string | null {
  return imageId ? `/api/images/${imageId}` : null;
}

export function uploadsDir(dataDir: string) {
  return join(dataDir, 'uploads');
}

export function imagePath(dataDir: string, hash: string) {
  return join(uploadsDir(dataDir), `${hash}.webp`);
}

/**
 * Stores a photo: turned the right way up, shrunk to at most 1600px, saved
 * as WebP without its metadata (so no location from the phone's camera).
 * Identical photos share one file.
 */
export async function saveImage(
  db: Db,
  dataDir: string,
  ownerId: string,
  bytes: Uint8Array,
  sourceUrl: string | null = null,
): Promise<ImageInfo> {
  let output: { data: Buffer; info: OutputInfo };
  try {
    output = await sharp(bytes, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new HttpError(422, 'That file is not an image openCook can read.');
  }
  const hash = createHash('sha256').update(output.data).digest('hex');
  const path = imagePath(dataDir, hash);
  if (!existsSync(path)) {
    mkdirSync(uploadsDir(dataDir), { recursive: true });
    writeFileSync(path, output.data);
  }
  const [row] = db
    .insert(schema.image)
    .values({
      ownerId,
      hash,
      width: output.info.width,
      height: output.info.height,
      sourceUrl,
    })
    .returning()
    .all();
  return {
    id: row.id,
    url: imageUrl(row.id) as string,
    width: row.width,
    height: row.height,
  };
}

/** Downloads a picture from the web (e.g. a recipe page's photo) and stores it. */
export async function downloadImage(
  db: Db,
  dataDir: string,
  ownerId: string,
  url: string,
  options: { allowPrivate?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<ImageInfo> {
  const res = await safeFetch(url, {
    accept: 'image/*',
    maxBytes: MAX_UPLOAD_BYTES,
    ...options,
  });
  return saveImage(db, dataDir, ownerId, res.body, url);
}
