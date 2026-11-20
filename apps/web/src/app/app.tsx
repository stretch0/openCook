import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { FormHint } from '../components/form-hint';
import { Layout } from '../components/layout';
import { UpdatePrompt } from '../components/update-prompt';
import { useMe } from '../lib/queries';
import { AdminPage } from '../pages/admin';
import { ConnectPage } from '../pages/connect';
import { CookPage } from '../pages/cook';
import { DiscoverPage } from '../pages/discover';
import { JoinPage } from '../pages/join';
import { ListPage } from '../pages/list';
import { PantryPage } from '../pages/pantry';
import { PlanPage } from '../pages/plan';
import { LoginPage } from '../pages/login';
import { RecipePage } from '../pages/recipe';
import { RecipeEditPage } from '../pages/recipe-edit';
import { RecipesPage } from '../pages/recipes';
import { RegisterPage } from '../pages/register';
import { SettingsPage } from '../pages/settings';

function RequireUser({ admin = false }: { admin?: boolean }) {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <Splash />;
  if (!me) {
    // Come back here after signing in, e.g. to accept a household invite.
    const here = location.pathname + location.search;
    return (
      <Navigate
        to={here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`}
        replace
      />
    );
  }
  if (admin && me.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

function Splash() {
  return (
    <div className="grid min-h-svh place-items-center text-stone-500">
      Loading…
    </div>
  );
}

export function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<RequireUser />}>
          <Route path="recipes/:id/cook" element={<CookPage />} />
          <Route path="connect" element={<ConnectPage />} />
          <Route element={<Layout />}>
            <Route index element={<RecipesPage />} />
            <Route path="discover" element={<DiscoverPage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="pantry" element={<PantryPage />} />
            <Route path="list" element={<ListPage />} />
            <Route path="list/:listId" element={<ListPage />} />
            <Route path="join/:code" element={<JoinPage />} />
            <Route path="recipes/new" element={<RecipeEditPage />} />
            <Route path="recipes/:id" element={<RecipePage />} />
            <Route path="recipes/:id/edit" element={<RecipeEditPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route element={<RequireUser admin />}>
              <Route path="admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <FormHint />
      <UpdatePrompt />
    </>
  );
}

export default App;
