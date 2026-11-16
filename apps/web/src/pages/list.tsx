import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AISLE_NAMES,
  formatQuantity,
  groupByAisle,
  parseIngredientLine,
} from '@opencook/domain';
import type { AddedListItem, ListItem } from '@opencook/schemas';
import { FormError } from '../components/auth-card';
import { formatAgo } from '../lib/format';
import { useItemSuggestions } from '../lib/recipes';
import {
  useAddToList,
  useCheckItems,
  useCreateList,
  useDeleteList,
  useLists,
  useLiveList,
  useMergeItems,
  useRemoveListItem,
  useShoppingList,
  useUpdateListItem,
} from '../lib/shopping';
import { useRestock } from '../lib/planner';

/**
 * The household's shopping list: add things, tick them off in the shop.
 * Changes from anyone else in the household appear live.
 */
export function ListPage() {
  const { listId = 'ongoing' } = useParams();
  const list = useShoppingList(listId);
  useLiveList(listId);
  const [editing, setEditing] = useState<ListItem | null>(null);
  const [showBought, setShowBought] = useState(false);
  const check = useCheckItems(listId);

  if (list.isPending) return <p className="text-stone-500">Loading…</p>;
  if (list.error || !list.data) return <p>This list doesn't exist.</p>;
  const data = list.data;
  const groups = groupByAisle(data.items);

  return (
    <>
      <ListSwitcher current={data.id} kind={data.kind} name={data.name} />
      <AddBox listId={listId} />
      {data.kind === 'ongoing' && <RestockBanner />}

      {data.items.length === 0 ? (
        <div className="card text-center text-stone-500">
          <p className="text-4xl" aria-hidden>
            🛒
          </p>
          <p className="mt-2">
            Nothing to buy. Add something above, or add a recipe's ingredients
            from its page.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.category} className="card p-0" aria-label={g.name}>
              <h2 className="border-b border-stone-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:border-stone-800">
                {g.name}
              </h2>
              <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                {g.items.map((item) => (
                  <ListRow
                    key={item.id}
                    item={item}
                    onToggle={() =>
                      check.mutate({ ids: [item.id], checked: true })
                    }
                    onEdit={() => setEditing(item)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {data.recentlyBought.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            className="text-sm font-medium text-stone-500"
            aria-expanded={showBought}
            onClick={() => setShowBought((v) => !v)}
          >
            {showBought ? '▾' : '▸'} Recently bought (
            {data.recentlyBought.length})
          </button>
          {showBought && (
            <ul className="card divide-y divide-stone-100 p-0 dark:divide-stone-800">
              {data.recentlyBought.map((item) => (
                <li key={item.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="flex-1 text-stone-500 line-through">
                    {amountOf(item)} {item.name}
                  </span>
                  <span className="text-xs text-stone-400">
                    {item.checkedAt ? formatAgo(item.checkedAt) : ''}
                  </span>
                  <button
                    type="button"
                    className="text-sm text-brand-600"
                    onClick={() =>
                      check.mutate({ ids: [item.id], checked: false })
                    }
                  >
                    Put back
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editing && (
        <EditSheet
          listId={listId}
          item={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

/** "You usually buy milk every 6 days; it's been 7." */
function RestockBanner() {
  const restock = useRestock();
  const add = useAddToList('ongoing');
  const due = restock.data ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {due.slice(0, 3).map((r) => (
        <button
          key={r.itemId}
          type="button"
          className="rounded-full border border-dashed border-brand-500 px-3 py-1 text-brand-700 dark:text-brand-500"
          title={`Usually every ${r.intervalDays} days; it's been ${r.daysSince}`}
          onClick={() =>
            add.mutate(
              [
                {
                  name: r.name,
                  itemId: r.itemId,
                  quantity: r.lastQuantity,
                  unit: r.lastUnit,
                },
              ],
              { onSuccess: () => void restock.refetch() },
            )
          }
        >
          + {r.name}
          <span className="text-xs text-stone-500">
            {' '}
            · {r.daysSince}d since
          </span>
        </button>
      ))}
      <Link to="/pantry" className="ml-auto text-brand-600">
        {due.length > 3 ? `${due.length - 3} more running low · ` : ''}Pantry
      </Link>
    </div>
  );
}

function amountOf(item: ListItem) {
  return formatQuantity(item.quantity, item.unit);
}

function ListRow({
  item,
  onToggle,
  onEdit,
}: {
  item: ListItem;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const amount = amountOf(item);
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <input
        type="checkbox"
        className="h-6 w-6 shrink-0 accent-brand-600"
        aria-label={`Bought ${item.name}`}
        checked={false}
        onChange={onToggle}
      />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={onEdit}
      >
        <span className="block">
          {amount && <strong className="font-semibold">{amount} </strong>}
          {item.name}
          {item.note && <span className="text-stone-500"> · {item.note}</span>}
        </span>
        {item.sources.length > 0 && (
          <span className="block truncate text-xs text-stone-500">
            for {item.sources.map((s) => s.title).join(', ')}
          </span>
        )}
      </button>
    </li>
  );
}

function AddBox({ listId }: { listId: string }) {
  const [text, setText] = useState('');
  const add = useAddToList(listId);
  const merge = useMergeItems(listId);
  const suggestions = useItemSuggestions(text);
  const [didYouMean, setDidYouMean] = useState<AddedListItem | null>(null);

  const submit = (value: string) => {
    const entry = value.trim();
    if (!entry) return;
    // Clear straight away so the next thing can be typed while this saves.
    setText('');
    add.mutate([entry], {
      onSuccess: ([result]) =>
        setDidYouMean(
          result.match === 'new' && result.suggestions.length ? result : null,
        ),
      // Put it back if it didn't save, unless something new was typed.
      onError: () => setText((t) => t || entry),
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(text);
  };

  const typed = text.trim().toLowerCase();
  const options = (suggestions.data ?? [])
    .filter((s) => s.name.toLowerCase() !== typed)
    .slice(0, 5);

  return (
    <div className="space-y-2">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          className="input"
          placeholder="Add something: 2 x milk, 500 g mince…"
          aria-label="Add to list"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <button className="btn-primary shrink-0" disabled={!text.trim()}>
          Add
        </button>
      </form>
      {text.trim().length >= 2 && options.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Suggestions">
          {options.map((s) => (
            <button
              key={s.id}
              type="button"
              className="rounded-full border border-stone-300 px-3 py-1 text-sm dark:border-stone-700"
              onClick={() => submit(withAmount(text, s.name))}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {didYouMean && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm dark:bg-brand-500/10">
          <span>
            Added “{didYouMean.listItem.name}”. Did you mean{' '}
            {didYouMean.suggestions.slice(0, 2).map((s, i) => (
              <span key={s.id}>
                {i > 0 && ' or '}
                <button
                  type="button"
                  className="font-medium text-brand-700 underline dark:text-brand-500"
                  onClick={() =>
                    merge.mutate(
                      {
                        from: didYouMean.listItem.itemId as string,
                        into: s.id,
                      },
                      { onSuccess: () => setDidYouMean(null) },
                    )
                  }
                >
                  {s.name}
                </button>
              </span>
            ))}
            ?
          </span>
          <button
            type="button"
            className="ml-auto text-stone-500"
            onClick={() => setDidYouMean(null)}
          >
            No, keep it
          </button>
        </div>
      )}
      <FormError message={add.error?.message ?? merge.error?.message ?? null} />
    </div>
  );
}

/** Picking "milk" after typing "2 mil" keeps the amount: "2 milk". */
function withAmount(typed: string, name: string) {
  const amount = typed.match(/^\s*([\d.,/½¼¾⅓⅔]+(?: ?x)?)\s/)?.[1];
  return amount ? `${amount} ${name}` : name;
}

function EditSheet({
  listId,
  item,
  onClose,
}: {
  listId: string;
  item: ListItem;
  onClose: () => void;
}) {
  const update = useUpdateListItem(listId);
  const remove = useRemoveListItem(listId);
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(amountOf(item));
  const [note, setNote] = useState(item.note ?? '');
  const [category, setCategory] = useState(item.category);

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseAmount(amount);
    update.mutate(
      {
        id: item.id,
        patch: {
          name: name.trim() || item.name,
          ...(parsed ?? {}),
          note: note.trim() || null,
          ...(category !== item.category && item.itemId ? { category } : {}),
        },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <form
        onSubmit={onSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-stone-900 sm:rounded-2xl"
        aria-label={`Edit ${item.name}`}
      >
        <h2 className="text-lg font-semibold">{item.name}</h2>
        <div>
          <label className="label" htmlFor="edit-name">
            Name
          </label>
          <input
            className="input"
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label" htmlFor="edit-amount">
              Amount
            </label>
            <input
              className="input"
              id="edit-amount"
              value={amount}
              placeholder="e.g. 2, 500 g"
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="edit-aisle">
              Aisle
            </label>
            <select
              className="input"
              id="edit-aisle"
              value={category}
              disabled={!item.itemId}
              onChange={(e) => setCategory(e.target.value)}
            >
              {Object.entries(AISLE_NAMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="edit-note">
            Note
          </label>
          <input
            className="input"
            id="edit-note"
            value={note}
            placeholder="Brand, size…"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {item.sources.length > 0 && (
          <p className="text-sm text-stone-500">
            For{' '}
            {item.sources.map((s, i) => (
              <span key={s.recipeId}>
                {i > 0 && ', '}
                <Link className="text-brand-600" to={`/recipes/${s.recipeId}`}>
                  {s.title}
                </Link>
                {s.servings ? ` (serves ${s.servings})` : ''}
              </span>
            ))}
          </p>
        )}
        <FormError
          message={update.error?.message ?? remove.error?.message ?? null}
        />
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={update.isPending}>
            Save
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
        <button
          type="button"
          className="w-full text-sm text-red-600"
          onClick={() => remove.mutate(item.id, { onSuccess: onClose })}
        >
          Remove from list
        </button>
      </form>
    </div>
  );
}

/**
 * Reads the amount box with the ingredient parser ("1 ½ cups", "500g", "2").
 * Empty clears the amount; anything unreadable leaves it as it was.
 */
function parseAmount(
  text: string,
): { quantity: number | null; unit: string | null } | undefined {
  const t = text.trim();
  if (!t) return { quantity: null, unit: null };
  const p = parseIngredientLine(`${t} x`);
  return p.quantity === null
    ? undefined
    : { quantity: p.quantity, unit: p.unit };
}

function ListSwitcher({
  current,
  kind,
  name,
}: {
  current: string;
  kind: string;
  name: string;
}) {
  const lists = useLists();
  const navigate = useNavigate();
  const create = useCreateList();
  const remove = useDeleteList();
  const others = lists.data ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <h1 className="mr-auto text-2xl font-semibold">{name}</h1>
      {others.length > 1 && (
        <select
          className="input w-auto py-1.5 text-sm"
          aria-label="Switch list"
          value={current}
          onChange={(e) => {
            const l = others.find((x) => x.id === e.target.value);
            navigate(
              l?.kind === 'ongoing' ? '/list' : `/list/${e.target.value}`,
            );
          }}
        >
          {others.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.remaining})
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        className="text-sm text-brand-600"
        onClick={() => {
          const listName = window.prompt(
            'Name for the new list (e.g. BBQ Saturday)',
          );
          if (listName?.trim()) {
            create.mutate(listName.trim(), {
              onSuccess: (l) => navigate(`/list/${l.id}`),
            });
          }
        }}
      >
        New list
      </button>
      {kind === 'named' && (
        <button
          type="button"
          className="text-sm text-red-600"
          onClick={() => {
            if (window.confirm(`Delete “${name}”?`)) {
              remove.mutate(current, { onSuccess: () => navigate('/list') });
            }
          }}
        >
          Delete list
        </button>
      )}
    </div>
  );
}
