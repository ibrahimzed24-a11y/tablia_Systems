import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { OwnerConsole, StorefrontPage, tenantSlugFrom } from './tenant/Tenant';
import { initTelemetry } from './lib/telemetry';
import './index.css';

// <slug>.<VITE_TENANT_ROOT_DOMAIN> (or /t/<slug>) is a tenant's public mobile page; /owner is the tenant owner console.
const slug = tenantSlugFrom(window.location.hostname, window.location.pathname);
const owner = window.location.pathname.startsWith('/owner');

initTelemetry();
registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(
  <StrictMode>{slug ? <StorefrontPage slug={slug} /> : owner ? <OwnerConsole /> : <App />}</StrictMode>,
);
