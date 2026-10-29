import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { SuperAdminConsole } from './admin/SuperAdmin';
import { OwnerConsole, StorefrontPage, tenantSlugFrom } from './tenant/Tenant';
import { initTelemetry } from './lib/telemetry';
import './index.css';

// <slug>.<VITE_TENANT_ROOT_DOMAIN> (or /t/<slug>) is a tenant's public mobile page; /owner is the tenant owner console;
// /admin is the Tablia Systems super admin console.
const slug = tenantSlugFrom(window.location.hostname, window.location.pathname);
const owner = window.location.pathname.startsWith('/owner');
const admin = window.location.pathname.startsWith('/admin');

initTelemetry();
registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(
  <StrictMode>{slug ? <StorefrontPage slug={slug} /> : admin ? <SuperAdminConsole /> : owner ? <OwnerConsole /> : <App />}</StrictMode>,
);
