import { useEffect, useRef, useState } from 'react';
import {
  Navigate,
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import type { Session, User } from '@supabase/supabase-js';
import type { FormEvent } from 'react';

import { supabaseBrowserClient } from '../lib/supabase/browser';
import { signInWithPassword } from '../services/auth/session';
import type { SalesOsNavItem } from '../domain/types';
import { ProductWorkflowPage } from './ProductWorkflowPage';
import { ConsolePage } from './ConsolePage';
import { OpportunitiesPage } from './OpportunitiesPage';
import { EngagePage } from './EngagePage';
import { LearningPage } from './LearningPage';
import { PerformancePage } from './PerformancePage';
import { SettingsPage } from './SettingsPage';
import { AdminAnalyticsPage } from './AdminAnalyticsPage';
import { AudienceIntelligencePage } from './AudienceIntelligencePage';
import { ProductsPage } from './ProductsPage';
import { TodayPage } from './TodayPage';
import { ActivationPage } from './ActivationPage';
import { AudienceDefinitionsPage } from './AudienceDefinitionsPage';
import { runSalesOsWorker } from '../services/jobs/workerService';
import { linkAnalyticsIdentity, track } from '../services/analytics/tracking';
import './app.css';
import './productWorkflow/productWorkflow.css';

const navItems: SalesOsNavItem[] = [{ label: 'Products', path: '/sales-os/products' }];
function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: signInError } = await signInWithPassword(email, password);
    if (signInError) setError(signInError.message);
    setIsSubmitting(false);
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">AI Sales OS</p>
        <h1 id="login-title">Sign in to Sales OS</h1>
        <p className="muted">
          Human-supervised acquisition operations for your product portfolio.
        </p>
        <form onSubmit={handleSubmit} className="stack">
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}

function ProtectedLayout({ user }: { user: User }) {
  const location = useLocation();
  const navigate = useNavigate();
  const trackedPaths = useRef(new Set<string>());
  const [navCounts, setNavCounts] = useState<Record<string, string>>({});
  const [workspaceProducts, setWorkspaceProducts] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [workspaceProductId, setWorkspaceProductId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    async function loadNavCounts() {
      const [audiences, opportunities, engagements, learnings, products] =
        await Promise.all([
          supabaseBrowserClient
            .from('sales_os_audiences')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', 'sales_os')
            .eq('status', 'proposed'),
          supabaseBrowserClient
            .from('sales_os_opportunities')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', 'sales_os')
            .eq('status', 'awaiting_review'),
          supabaseBrowserClient
            .from('sales_os_engagements')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', 'sales_os')
            .eq('status', 'awaiting_approval'),
          supabaseBrowserClient
            .from('sales_os_learnings')
            .select('id', { count: 'exact', head: true })
            .eq('tenant_id', 'sales_os')
            .eq('status', 'proposed'),
          supabaseBrowserClient
            .from('sales_os_products')
            .select('id, name')
            .eq('tenant_id', 'sales_os')
            .order('created_at', { ascending: true }),
        ]);
      if (!active || products.error) return;
      const productRows = (products.data ?? []) as Array<{ id: string; name: string }>;
      setWorkspaceProducts(productRows);
      const requested = new URLSearchParams(location.search).get('product');
      setWorkspaceProductId((current) =>
        productRows.find((product) => location.pathname.includes(product.id))?.id ??
        productRows.find((product) => product.id === requested)?.id ??
        productRows.find((product) => product.id === current)?.id ??
        productRows[0]?.id ?? '',
      );
      if (
        !active ||
        audiences.error ||
        opportunities.error ||
        engagements.error ||
        learnings.error ||
        products.error
      )
        return;
      const counts = [
        audiences.count ?? 0,
        opportunities.count ?? 0,
        engagements.count ?? 0,
        learnings.count ?? 0,
      ];
      const pending = counts.reduce((sum, count) => sum + count, 0);
      setNavCounts({
        ...(pending ? { Today: String(pending) } : {}),
        ...(counts[0] ? { Audiences: String(counts[0]) } : {}),
        ...(counts[1] ? { Signals: String(counts[1]) } : {}),
        ...(counts[2] ? { Outreach: String(counts[2]) } : {}),
        ...(counts[3] ? { Learnings: String(counts[3]) } : {}),
      });
    }
    void loadNavCounts();
    return () => {
      active = false;
    };
  }, [location.pathname, location.search]);
  useEffect(() => {
    void linkAnalyticsIdentity(supabaseBrowserClient, user.id).catch(() => undefined);
  }, [user.id]);

  useEffect(() => {
    if (trackedPaths.current.has(location.pathname)) return;
    trackedPaths.current.add(location.pathname);
    void track(
      supabaseBrowserClient,
      'product_visit',
      {
        path: location.pathname,
      },
      { userId: user.id },
    ).catch(() => undefined);
  }, [location.pathname, user.id]);

  useEffect(() => {
    void runSalesOsWorker().catch(() => undefined);
    const timer = window.setInterval(() => {
      void runSalesOsWorker().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${menuOpen ? 'menu-open' : ''}`} onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}>
        <div className="sidebar-inner">
          <div className="sidebar-header">
          <div className="sales-os-logo">
            <span className="sales-os-mark" aria-hidden="true">
              <i />
              <i />
            </span>
            <span>Sales OS</span>
          </div>
          <button ref={menuButton} type="button" className="mobile-menu-toggle button-secondary"
            aria-expanded={menuOpen} aria-controls="workspace-navigation"
            onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? 'Close menu' : 'Menu'}
          </button>
          </div>
          <div id="workspace-navigation" className="sidebar-navigation" onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setMenuOpen(false);
          }}>
          <label className="product-switcher" aria-label="Switch product">
            <span>
              <span className="field-label">Product</span>
              <select
                value={workspaceProductId}
                title={workspaceProducts.find((product) => product.id === workspaceProductId)?.name}
                onChange={(event) => {
                  const nextProductId = event.target.value;
                  setWorkspaceProductId(nextProductId);
                  if (nextProductId) {
                    setMenuOpen(false);
                    if (['/sales-os/opportunities', '/sales-os/engage'].includes(location.pathname)) {
                      const params = new URLSearchParams(location.search);
                      params.set('product', nextProductId);
                      navigate(`${location.pathname}?${params}`);
                    } else navigate(`/sales-os/products/${nextProductId}`);
                  }
                }}
              >
                {workspaceProducts.length === 0 && (
                  <option value="">No product connected</option>
                )}
                {workspaceProducts.map((product) => (
                  <option value={product.id} key={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <nav aria-label="Sales OS navigation" className="nav-list">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  isActive ? 'nav-link active' : 'nav-link'
                }
              >
                <span>{item.label}</span>
                {navCounts[item.label] && (
                  <span className="nav-count">{navCounts[item.label]}</span>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-divider" />
          <nav aria-label="Sales OS tools" className="nav-list">
            <NavLink className="nav-link" to="/sales-os/activation">
              Activation
            </NavLink>
            <NavLink className="nav-link" to="/sales-os/audience-definitions">
              Audience definitions
            </NavLink>
            <NavLink className="nav-link" to="/sales-os/settings">
              Settings
            </NavLink>
            <Link className="nav-link" to="/sales-os/products?add=1">
              Add product
            </Link>
          </nav>
          <div className="sidebar-footer">
            <span className="user-email">{user.email ?? 'Authenticated operator'}</span>
          </div>
          </div>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    void supabaseBrowserClient.auth
      .getSession()
      .then(({ data: { session: currentSession } }) => {
        if (mounted) setSession(currentSession);
      });

    const { data } = supabaseBrowserClient.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
      },
    );

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  if (session === undefined) {
    return <main className="loading-page">Loading session…</main>;
  }

  if (!session) {
    return <LoginPage />;
  }

  return (
    <Routes>
      <Route element={<ProtectedLayout user={session.user} />}>
        <Route index element={<Navigate to="/sales-os/products" replace />} />
        <Route path="sales-os/today" element={<TodayPage />} />
        <Route
          path="sales-os/products"
          element={<ProductsPage actor={session.user.id} />}
        />
        <Route path="sales-os/products/:productId" element={<ProductWorkflowPage />} />
        <Route path="sales-os/opportunities" element={<OpportunitiesPage />} />
        <Route path="sales-os/engage" element={<EngagePage />} />
        <Route path="sales-os/learning" element={<LearningPage />} />
        <Route path="sales-os/performance" element={<PerformancePage />} />
        <Route path="sales-os/console" element={<ConsolePage />} />
        <Route path="sales-os/settings" element={<SettingsPage />} />
        <Route path="sales-os/activation" element={<ActivationPage />} />
        <Route
          path="sales-os/audience-definitions"
          element={<AudienceDefinitionsPage />}
        />
        <Route path="admin/analytics" element={<AdminAnalyticsPage />} />
        <Route
          path="admin/audience-intelligence"
          element={<AudienceIntelligencePage />}
        />
        <Route path="*" element={<Navigate to="/sales-os/products" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
