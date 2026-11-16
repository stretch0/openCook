import { z } from 'zod';
import { editSchema } from './patch.js';

describe('editSchema', () => {
  it('makes every field optional without filling in defaults', () => {
    const schema = editSchema(
      z.object({ name: z.string(), servings: z.number().default(4) }),
    );
    expect(schema.parse({})).toEqual({});
    expect(schema.parse({ servings: 2 })).toEqual({ servings: 2 });
  });
});
