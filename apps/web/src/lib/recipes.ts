import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { z } from 'zod';
import {
  type CookedInput,
  type RecipeInput,
  type RecipeListQuery,
  type UpdateRecipe,
  cookLogEntrySchema,
  imageSchema,
  importResultSchema,
  itemSchema,
  recipeSchema,
  recipeSummarySchema,
} from '@opencook/schemas';
import { api } from './api';

const json = (body: unknown) => JSON.stringify(body);

export function useRecipes(query: RecipeListQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, String(v));
  }
  return useQuery({
    queryKey: ['recipes', query],
    queryFn: () => api(`/recipes?${params}`, z.array(recipeSummarySchema)),
    placeholderData: keepPreviousData,
  });
}

export function useTags() {
  return useQuery({
    queryKey: ['recipes', 'tags'],
    queryFn: () =>
      api(
        '/recipes/tags',
        z.array(z.object({ tag: z.string(), count: z.number() })),
      ),
  });
}

export function useRecipe(id: string | undefined) {
  return useQuery({
    queryKey: ['recipe', id],
    queryFn: () => api(`/recipes/${id}`, recipeSchema),
    enabled: !!id,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return (id?: string) => {
    void queryClient.invalidateQueries({ queryKey: ['recipes'] });
    if (id) void queryClient.invalidateQueries({ queryKey: ['recipe', id] });
  };
}

export function useSaveRecipe(id?: string) {
  const invalidate = useInvalidate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RecipeInput | UpdateRecipe) =>
      id
        ? api(`/recipes/${id}`, recipeSchema, {
            method: 'PUT',
            body: json(body),
          })
        : api('/recipes', recipeSchema, { method: 'POST', body: json(body) }),
    onSuccess: (recipe) => {
      queryClient.setQueryData(['recipe', recipe.id], recipe);
      invalidate();
    },
  });
}

export function useDeleteRecipe() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/recipes/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => invalidate(),
  });
}

export function useForkRecipe() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/recipes/${id}/fork`, recipeSchema, { method: 'POST' }),
    onSuccess: () => invalidate(),
  });
}

export function useSaveNote(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (text: string) =>
      api(`/recipes/${id}/note`, z.object({ note: z.string().nullable() }), {
        method: 'PUT',
        body: json({ text }),
      }),
    onSuccess: () => invalidate(id),
  });
}

export function useLogCooked(id: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: CookedInput) =>
      api(`/recipes/${id}/cooked`, cookLogEntrySchema, {
        method: 'POST',
        body: json(body),
      }),
    onSuccess: () => invalidate(id),
  });
}

export function importRecipe(url: string) {
  return api('/recipes/import', importResultSchema, {
    method: 'POST',
    body: json({ url }),
  });
}

export function uploadImage(file: File) {
  const body = new FormData();
  body.append('file', file);
  return api('/images', imageSchema, { method: 'POST', body });
}

export function useItemSuggestions(text: string) {
  return useQuery({
    queryKey: ['items', text],
    queryFn: () =>
      api(`/items?q=${encodeURIComponent(text)}`, z.array(itemSchema)),
    enabled: text.trim().length >= 2,
    staleTime: 60_000,
  });
}
