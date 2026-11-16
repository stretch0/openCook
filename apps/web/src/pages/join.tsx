import { useNavigate, useParams } from 'react-router-dom';
import { FormError } from '../components/auth-card';
import {
  useHousehold,
  useHouseholdChange,
  useInvitePreview,
} from '../lib/shopping';

/** Where a household invite link lands: shows whose kitchen it is, then joins. */
export function JoinPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const preview = useInvitePreview(code);
  const current = useHousehold();
  const join = useHouseholdChange();

  if (preview.isPending) return <p className="text-stone-500">Loading…</p>;
  if (preview.error || !preview.data) {
    return (
      <div className="card space-y-2">
        <h1 className="text-xl font-semibold">This invite doesn't work</h1>
        <p className="text-stone-500">{preview.error?.message}</p>
      </div>
    );
  }
  const p = preview.data;
  if (p.alreadyMember) {
    return (
      <div className="card space-y-3">
        <h1 className="text-xl font-semibold">
          You're already in {p.householdName}
        </h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate('/list')}
        >
          Open the shopping list
        </button>
      </div>
    );
  }
  const others = (current.data?.members.length ?? 1) > 1;
  return (
    <div className="card space-y-3">
      <h1 className="text-xl font-semibold">Join {p.householdName}?</h1>
      <p className="text-stone-600 dark:text-stone-300">
        {p.invitedBy ? `${p.invitedBy} invited you` : "You've been invited"} to
        share a shopping list and, soon, a meal plan and pantry.
      </p>
      <p className="text-sm text-stone-500">
        Anything still on your own shopping list comes with you.
        {others ? ` You'll leave ${current.data?.name}.` : ''} Your recipes stay
        yours.
      </p>
      <FormError message={join.error?.message ?? null} />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={join.isPending}
          onClick={() =>
            join.mutate(
              { code },
              { onSuccess: () => navigate('/list', { replace: true }) },
            )
          }
        >
          Join {p.householdName}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => navigate('/')}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
