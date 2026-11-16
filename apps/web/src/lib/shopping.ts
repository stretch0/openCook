import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { z } from 'zod';
import {
  type ListEntry,
  type RecipeToList,
  type ShoppingList,
  type UpdateListItem,
  addedListItemSchema,
  householdInviteSchema,
  householdSchema,
  invitePreviewSchema,
  itemSchema,
  listItemSchema,
  shoppingListSchema,
  shoppingListSummarySchema,
} from '@opencook/schemas';
import { api } from './api';

const json = (body: unknown) => JSON.stringify(body);

export function useLists() {
  return useQuery({
    queryKey: ['lists'],
    queryFn: () => api('/lists', z.array(shoppingListSummarySchema)),
  });
}

export function useShoppingList(listId: string) {
  return useQuery({
    queryKey: ['list', listId],
    queryFn: () => api(`/lists/${listId}`, shoppingListSchema),
  });
}

/**
 * Refetches the list whenever anyone in the household changes it, so a
 * partner's ticks show up straight away. EventSource reconnects by itself.
 */
export function useLiveList(listId: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/lists/${listId}/events`, {
      withCredentials: true,
    });
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['list', listId] });
      void queryClient.invalidateQueries({ queryKey: ['lists'] });
    };
    source.addEventListener('changed', refresh);
    // After a dropped connection, catch up on anything missed.
    source.addEventListener('ready', refresh);
    return () => source.close();
  }, [listId, queryClient]);
}

function useRefresh(listId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['list', listId] }),
      queryClient.invalidateQueries({ queryKey: ['lists'] }),
    ]);
}

export function useAddToList(listId: string) {
  const refresh = useRefresh(listId);
  return useMutation({
    mutationFn: (items: ListEntry[]) =>
      api(`/lists/${listId}/items`, z.array(addedListItemSchema), {
        method: 'POST',
        body: json({ items }),
      }),
    onSettled: refresh,
  });
}

/** Ticks lines off (or on) at once on screen; the server catches up. */
export function useCheckItems(listId: string) {
  const queryClient = useQueryClient();
  const refresh = useRefresh(listId);
  return useMutation({
    mutationFn: ({ ids, checked }: { ids: string[]; checked: boolean }) =>
      api(`/lists/${listId}/check`, shoppingListSchema, {
        method: 'POST',
        body: json({ ids, checked }),
      }),
    onMutate: async ({ ids, checked }) => {
      await queryClient.cancelQueries({ queryKey: ['list', listId] });
      const before = queryClient.getQueryData<ShoppingList>(['list', listId]);
      if (before) {
        const now = new Date().toISOString();
        const all = [...before.items, ...before.recentlyBought];
        const moved = all
          .filter((i) => ids.includes(i.id))
          .map((i) => ({ ...i, checkedAt: checked ? now : null }));
        queryClient.setQueryData<ShoppingList>(['list', listId], {
          ...before,
          items: checked
            ? before.items.filter((i) => !ids.includes(i.id))
            : [...before.items, ...moved],
          recentlyBought: checked
            ? [...moved, ...before.recentlyBought]
            : before.recentlyBought.filter((i) => !ids.includes(i.id)),
        });
      }
      return { before };
    },
    onError: (_e, _v, context) => {
      if (context?.before)
        queryClient.setQueryData(['list', listId], context.before);
    },
    onSettled: refresh,
  });
}

export function useUpdateListItem(listId: string) {
  const refresh = useRefresh(listId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateListItem }) =>
      api(`/lists/${listId}/items/${id}`, listItemSchema, {
        method: 'PATCH',
        body: json(patch),
      }),
    onSettled: refresh,
  });
}

export function useRemoveListItem(listId: string) {
  const refresh = useRefresh(listId);
  return useMutation({
    mutationFn: (id: string) =>
      api(`/lists/${listId}/items/${id}`, z.undefined(), { method: 'DELETE' }),
    onSettled: refresh,
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api('/lists', shoppingListSummarySchema, {
        method: 'POST',
        body: json({ name }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lists'] }),
  });
}

export function useDeleteList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api(`/lists/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lists'] }),
  });
}

export function useMergeItems(listId: string) {
  const refresh = useRefresh(listId);
  return useMutation({
    mutationFn: (body: { from: string; into: string }) =>
      api('/items/merge', itemSchema, { method: 'POST', body: json(body) }),
    onSettled: refresh,
  });
}

export function useRecipeToList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ recipeId, ...body }: RecipeToList & { recipeId: string }) =>
      api(`/recipes/${recipeId}/to-list`, z.array(addedListItemSchema), {
        method: 'POST',
        body: json(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['list'] }),
  });
}

export function useHousehold() {
  return useQuery({
    queryKey: ['household'],
    queryFn: () => api('/household', householdSchema),
  });
}

export function useRenameHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api('/household', householdSchema, {
        method: 'PATCH',
        body: json({ name }),
      }),
    onSuccess: (h) => queryClient.setQueryData(['household'], h),
  });
}

export function createHouseholdInvite() {
  return api('/household/invites', householdInviteSchema, { method: 'POST' });
}

export function useInvitePreview(code: string) {
  return useQuery({
    queryKey: ['invite', code],
    queryFn: () =>
      api(
        `/household/invites/${encodeURIComponent(code)}`,
        invitePreviewSchema,
      ),
    retry: false,
  });
}

/** Joining or leaving changes everything the household shares. */
export function useHouseholdChange() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { code: string } | 'leave') =>
      body === 'leave'
        ? api('/household/leave', householdSchema, { method: 'POST' })
        : api('/household/join', householdSchema, {
            method: 'POST',
            body: json(body),
          }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
