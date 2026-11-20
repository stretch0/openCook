import { NavLink, Outlet } from 'react-router-dom';
import { useInstance } from '../lib/queries';

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium ${
    isActive ? 'text-brand-600' : 'text-stone-500'
  }`;

export function Layout() {
  const { data: instance } = useInstance();
  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-stone-200 bg-stone-50/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
        <span className="text-lg font-semibold">openCook</span>
        {instance && instance.name !== 'openCook' && (
          <span className="ml-auto text-sm text-stone-500">
            {instance.name}
          </span>
        )}
      </header>
      <main className="flex-1 space-y-4 px-4 py-4 pb-24">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
        <div className="mx-auto flex max-w-2xl">
          <NavLink to="/" end className={tabClass}>
            <Icon d="M4 19.5V5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zm0 0A2 2 0 006 21h13M9 7h6" />
            Recipes
          </NavLink>
          <NavLink to="/plan" className={tabClass}>
            <Icon d="M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zm3 7h3v3H8z" />
            Plan
          </NavLink>
          <NavLink to="/list" className={tabClass}>
            <Icon d="M3 4h2l2.4 11.2a1 1 0 001 .8h9.2a1 1 0 001-.8L20 8H6M9 20.5a.5.5 0 100-1 .5.5 0 000 1zm8 0a.5.5 0 100-1 .5.5 0 000 1z" />
            List
          </NavLink>
          <NavLink to="/discover" className={tabClass}>
            <Icon d="M21 21l-4.3-4.3M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
            Discover
          </NavLink>
          <NavLink to="/settings" className={tabClass}>
            <Icon d="M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 00-2.2-1.3L14.4 3h-4l-.4 2.4a7.5 7.5 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.6l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 002.2 1.3l.4 2.4h4l.4-2.4a7.5 7.5 0 002.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z" />
            Settings
          </NavLink>
        </div>
      </nav>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}
