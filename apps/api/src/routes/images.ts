import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { schema } from '@opencook/db';
import { type AppEnv, requireUser } from '../context.js';
import { HttpError } from '../services/errors.js';
import { MAX_UPLOAD_BYTES, imagePath, saveImage } from '../services/images.js';

/** Uploading needs an account. Photos are served to anyone with the (unguessable) link. */
export const imageRoutes = new Hono<AppEnv>()
  .post('/', requireUser, async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File))
      throw new HttpError(422, 'Send the photo as "file".');
    if (file.size > MAX_UPLOAD_BYTES)
      throw new HttpError(413, 'That photo is too large (15 MB at most).');
    const image = await saveImage(
      c.get('db'),
      c.get('config').dataDir,
      (c.get('user') as { id: string }).id,
      new Uint8Array(await file.arrayBuffer()),
    );
    return c.json(image, 201);
  })
  .get('/:id', (c) => {
    const image = c
      .get('db')
      .select()
      .from(schema.image)
      .where(eq(schema.image.id, c.req.param('id')))
      .get();
    const path = image && imagePath(c.get('config').dataDir, image.hash);
    if (!path || !existsSync(path)) return c.json({ error: 'Not found' }, 404);
    c.header('Content-Type', 'image/webp');
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream);
  });
