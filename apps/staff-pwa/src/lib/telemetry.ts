// Telemetry wrapper for PostHog and LogRocket. Off unless env keys are set. What is scrubbed: docs/sops/10-incident-privacy.md
import posthog from 'posthog-js';
import LogRocket from 'logrocket';

const SENSITIVE_KEY = /phone|name|email|token|password|authorization|apikey|cookie|message|secret/i;
const PATTERNS: RegExp[] = [
  /(\+?20|0)1[0125]\d{8}/g,                                   // Egyptian mobiles
  /[\w.+-]+@[\w-]+\.[\w.-]+/g,                                  // emails
  /eyJ[\w-]+\.[\w-]+\.[\w-]+/g,                                 // JWTs
];
const DROP_HEADERS = ['authorization', 'apikey', 'cookie', 'set-cookie', 'x-client-info'];

export function scrubString(s: string): string {
  let out = s.replace(/([#&?])(t|access_token|refresh_token)=[^&#\s]*/g, '$1$2=[redacted]');
  for (const p of PATTERNS) out = out.replace(p, '[redacted]');
  return out;
}

export function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (depth > 5 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) && !k.startsWith('$') ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

let posthogOn = false;
let logrocketOn = false;

export function initTelemetry() {
  const phKey = import.meta.env.VITE_POSTHOG_KEY;
  if (phKey) {
    posthog.init(phKey, {
      api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      persistence: 'localStorage',
      mask_all_text: false,
      session_recording: { maskAllInputs: true, maskTextSelector: '[data-private]' },
      sanitize_properties: (props) => scrub(props) as typeof props,
    });
    posthogOn = true;
  }
  const lrId = import.meta.env.VITE_LOGROCKET_APP_ID;
  if (lrId) {
    LogRocket.init(lrId, {
      dom: { inputSanitizer: true, privateAttributeBlocklist: ['data-private'] },
      browser: { urlSanitizer: (u: string) => scrubString(u) },
      network: {
        requestSanitizer: (request) => {
          request.body = undefined;
          request.url = scrubString(request.url);
          for (const h of Object.keys(request.headers)) if (DROP_HEADERS.includes(h.toLowerCase())) delete request.headers[h];
          return request;
        },
        responseSanitizer: (response) => {
          response.body = undefined;
          for (const h of Object.keys(response.headers)) if (DROP_HEADERS.includes(h.toLowerCase())) delete response.headers[h];
          return response;
        },
      },
    });
    logrocketOn = true;
  }
}

/** Staff are identified by internal id and role only, never by name. */
export function identify(staffId: string, role: string) {
  if (posthogOn) posthog.identify(staffId, { role });
  if (logrocketOn) LogRocket.identify(staffId, { role });
}

export function track(event: string, props: Record<string, unknown> = {}) {
  const clean = scrub(props) as Record<string, unknown>;
  if (posthogOn) posthog.capture(event, clean);
  if (logrocketOn) LogRocket.track(event, clean as Record<string, string | number | boolean>);
}
