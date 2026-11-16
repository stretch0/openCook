import { z } from 'zod';

export const itemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  /** Whether it's in the shared catalogue or this household's own. */
  shared: z.boolean(),
});
export type Item = z.infer<typeof itemSchema>;

export const itemSearchSchema = z.object({
  /** An exact match (same normal key or alias), if there is one. */
  match: itemSchema.nullable(),
  /** Close spellings, for "Did you mean…?". */
  suggestions: z.array(itemSchema),
});
export type ItemSearch = z.infer<typeof itemSearchSchema>;
