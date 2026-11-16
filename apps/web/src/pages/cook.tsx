import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { findDurations, formatTimer, servingsFactor } from '@opencook/domain';
import { useMe } from '../lib/queries';
import { useLogCooked, useRecipe } from '../lib/recipes';
import {
  IngredientList,
  ServingsStepper,
  StepText,
  useServings,
} from './recipe';

type Timer = { id: number; label: string; endsAt: number; total: number };

/**
 * Cooking mode: one step at a time in big type, the screen kept awake, and
 * timers for any time a step mentions.
 */
export function CookPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const { data: recipe } = useRecipe(id);
  const [servings, setServings] = useServings(recipe);
  const [step, setStep] = useState(0);
  const [showIngredients, setShowIngredients] = useState(false);
  const [timers, setTimers] = useState<Timer[]>([]);
  const cooked = useLogCooked(id ?? '');
  useWakeLock();
  const now = useNow(timers.length > 0);
  useTimerAlerts(timers, now);

  const steps = recipe?.steps ?? [];
  const total = steps.length;
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, total));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [total]);

  if (!recipe) return <p className="p-4 text-stone-500">Loading…</p>;

  const factor = servingsFactor(recipe.servings, servings);
  const current = steps[step];
  const done = step >= total;
  const startTimer = (label: string, seconds: number) =>
    setTimers((t) => [
      ...t,
      {
        id: Date.now(),
        label,
        endsAt: Date.now() + seconds * 1000,
        total: seconds,
      },
    ]);

  return (
    <div
      className="mx-auto flex min-h-svh max-w-2xl flex-col bg-stone-50 dark:bg-stone-950"
      onTouchStart={(e) => (touchStart.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchStart.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStart.current;
        if (dx < -60) setStep((s) => Math.min(s + 1, total));
        if (dx > 60) setStep((s) => Math.max(s - 1, 0));
        touchStart.current = null;
      }}
    >
      <header className="flex items-center gap-3 border-b border-stone-200 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] dark:border-stone-800">
        <Link
          to={`/recipes/${recipe.id}`}
          className="text-sm text-brand-600"
          aria-label="Leave cooking mode"
        >
          ✕ Close
        </Link>
        <h1 className="flex-1 truncate text-center font-semibold">
          {recipe.title}
        </h1>
        <button
          type="button"
          className="text-sm text-brand-600"
          onClick={() => setShowIngredients((v) => !v)}
        >
          {showIngredients ? 'Steps' : 'Ingredients'}
        </button>
      </header>

      {timers.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-stone-200 px-4 py-2 dark:border-stone-800">
          {timers.map((t) => {
            const left = Math.ceil((t.endsAt - now) / 1000);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  setTimers((all) => all.filter((x) => x.id !== t.id))
                }
                className={`rounded-full px-3 py-1 text-sm font-medium tabular-nums ${
                  left <= 0
                    ? 'animate-pulse bg-red-600 text-white'
                    : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-500'
                }`}
                aria-label={`${t.label} timer, ${left <= 0 ? 'done' : formatTimer(left) + ' left'}. Tap to dismiss.`}
              >
                ⏱ {left <= 0 ? 'Done!' : formatTimer(left)} · {t.label}
              </button>
            );
          })}
        </div>
      )}

      <main className="flex flex-1 flex-col px-5 py-6">
        {showIngredients ? (
          <div className="space-y-4">
            <ServingsStepper value={servings} onChange={setServings} />
            <IngredientList
              ingredients={recipe.ingredients}
              factor={factor}
              preference={me?.units}
            />
          </div>
        ) : done ? (
          <div className="m-auto space-y-4 text-center">
            <div className="text-6xl" aria-hidden>
              🎉
            </div>
            <h2 className="text-2xl font-semibold">Enjoy!</h2>
            <button
              type="button"
              className="btn-primary"
              disabled={cooked.isPending || cooked.isSuccess}
              onClick={() => cooked.mutate({ servings })}
            >
              {cooked.isSuccess ? 'Logged ✓' : 'Log that I cooked this'}
            </button>
          </div>
        ) : current ? (
          <div className="space-y-6">
            <p className="text-sm font-medium uppercase tracking-wide text-stone-500">
              Step {step + 1} of {total}
              {current.section ? ` · ${current.section}` : ''}
            </p>
            <p className="text-2xl leading-relaxed sm:text-3xl">
              <StepText
                text={current.text}
                factor={factor}
                preference={me?.units}
                ingredients={recipe.ingredients}
              />
            </p>
            <StepTimers
              text={current.text}
              timerSeconds={current.timerSeconds}
              onStart={(seconds) => startTimer(`Step ${step + 1}`, seconds)}
            />
          </div>
        ) : (
          <p className="m-auto text-stone-500">This recipe has no steps yet.</p>
        )}
      </main>

      {!showIngredients && (
        <footer className="grid grid-cols-2 gap-3 border-t border-stone-200 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-stone-800">
          <button
            type="button"
            className="btn-secondary py-4 text-lg"
            disabled={step === 0}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </button>
          <button
            type="button"
            className="btn-primary py-4 text-lg"
            disabled={done}
            onClick={() => setStep((s) => s + 1)}
          >
            {step === total - 1 ? 'Finish' : 'Next'}
          </button>
        </footer>
      )}
    </div>
  );
}

function StepTimers({
  text,
  timerSeconds,
  onStart,
}: {
  text: string;
  timerSeconds: number | null;
  onStart: (seconds: number) => void;
}) {
  const found = findDurations(text);
  const options = timerSeconds
    ? [{ text: formatTimer(timerSeconds), seconds: timerSeconds }, ...found]
    : found;
  if (!options.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((d, i) => (
        <button
          key={i}
          type="button"
          className="btn-secondary"
          onClick={() => onStart(d.seconds)}
        >
          ⏱ Start {d.text} timer
        </button>
      ))}
    </div>
  );
}

/** Keeps the screen on while cooking, where the browser allows it. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        // Not allowed (e.g. low battery); cooking still works.
      }
    };
    void request();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);
  return now;
}

/** Buzzes and beeps once when each timer runs out. */
function useTimerAlerts(timers: Timer[], now: number) {
  const fired = useRef(new Set<number>());
  useEffect(() => {
    for (const t of timers) {
      if (t.endsAt <= now && !fired.current.has(t.id)) {
        fired.current.add(t.id);
        navigator.vibrate?.([300, 150, 300]);
        beep();
      }
    }
  }, [timers, now]);
}

function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 880;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch {
    /* no audio */
  }
}
