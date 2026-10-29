import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { SuperAdminConsole } from './admin/SuperAdmin';
import { OwnerConsole, StorefrontPage, tenantSlugFrom } from './tenant/Tenant';
import { initTelemetry } from './lib/telemetry';
import './index.css';

// / is the portal chooser. <slug>.<VITE_TENANT_ROOT_DOMAIN> (or /t/<slug>) is a tenant's public mobile page; /owner is the tenant owner console;
// /admin is the Tablia Systems super admin console.
const slug = tenantSlugFrom(window.location.hostname, window.location.pathname);
const owner = window.location.pathname.startsWith('/owner');
const admin = window.location.pathname.startsWith('/admin');

function Home() {
  const ar = navigator.language.startsWith('ar');
  return (
    <main dir={ar ? 'rtl' : 'ltr'} className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Tablia Systems</h1>
      <a className="block rounded-lg bg-red-800 px-4 py-3 text-center text-white" href="/owner">{ar ? 'دخول أصحاب المطاعم والموظفين' : 'Restaurant owners and staff'}</a>
      <a className="block rounded-lg border px-4 py-3 text-center" href="/admin">{ar ? 'إدارة المنصة' : 'Platform admin'}</a>
      <p className="text-sm opacity-80">{ar ? 'للطلب أو الحجز افتح رابط المطعم على Tablia.' : "To order or book a table, open the restaurant's Tablia link."}</p>
    </main>
  );
}

initTelemetry();
registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(
  <StrictMode>{slug ? <StorefrontPage slug={slug} /> : admin ? <SuperAdminConsole /> : owner ? <OwnerConsole /> : <Home />}</StrictMode>,
);
