import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  type AddNeeds,
  type AddPlanEntry,
  type ShoppingSelection,
  type UpdatePantry,
  type UpdatePlanEntry,
  addedListItemSchema,
  mealPlanSchema,
  pantrySchema,
  planEntrySchema,
  restockSuggestionSchema,
  shoppingNeedSchema,
} from '@opencook/schemas';
import { api } from './api';

const json = (body: unknown) => JSON.stringify(body);

export function usePlan(from: string, days = 7) {
  return useQuery({
    queryKey: ['plan', from, days],
    queryFn: () => api(`/plan?from=${from}&days=${days}`, mealPlanSchema),
  });
}

function useInvalidatePlan() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['plan'] });
}

export function useAddPlanEntry() {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: (body: AddPlanEntry) =>
      api('/plan', planEntrySchema, { method: 'POST', body: json(body) }),
    onSuccess: invalidate,
  });
}

export function useUpdatePlanEntry() {
  const invalidate = useInvalidatePlan();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdatePlanEntry }) =>
      api(`/plan/${id}`, planEntrySchema, {
        method: 'PATCH',
        body: json(patch),
      }),
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: ['recipe'] });
    },
  });
}

export function useRemovePlanEntry() {
  const invalidate = useInvalidatePlan();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/plan/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useShoppingPreview(selection: ShoppingSelection | null) {
  return useQuery({
    queryKey: ['shopping-preview', selection],
    queryFn: () =>
      api('/plan/shopping/preview', z.array(shoppingNeedSchema), {
        method: 'POST',
        body: json(selection),
      }),
    enabled: !!selection,
    staleTime: 0,
  });
}

export function useAddNeeds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AddNeeds) =>
      api('/plan/shopping/add', z.array(addedListItemSchema), {
        method: 'POST',
        body: json(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['list'] });
      void queryClient.invalidateQueries({ queryKey: ['shopping-preview'] });
    },
  });
}

export function usePantry() {
  return useQuery({
    queryKey: ['pantry'],
    queryFn: () => api('/pantry', pantrySchema),
  });
}

export function useUpdatePantry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePantry) =>
      api('/pantry', pantrySchema, { method: 'PATCH', body: json(body) }),
    onSuccess: (p) => queryClient.setQueryData(['pantry'], p),
  });
}

export function useRestock() {
  return useQuery({
    queryKey: ['restock'],
    queryFn: () => api('/pantry/restock', z.array(restockSuggestionSchema)),
  });
}
