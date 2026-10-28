// src/hooks.client.ts
// I1 Error Tracking (rencana Personal Admin Dashboard, 25 Agu 2026): sisi klien.
// SENGAJA no-op selama PUBLIC_SENTRY_DSN belum diisi -- Sentry.init() tidak dipanggil
// sama sekali, jadi tidak ada request keluar ke Sentry tanpa akun yang benar-benar ada.
// Isi PUBLIC_SENTRY_DSN di .env untuk mengaktifkan (harus PUBLIC_ karena env klien).

import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';

const sentryEnabled = Boolean(env.PUBLIC_SENTRY_DSN);
if (sentryEnabled) {
	Sentry.init({
		dsn: env.PUBLIC_SENTRY_DSN,
		environment: env.PUBLIC_APP_ENV || 'production',
		tracesSampleRate: 0.1,
		replaysSessionSampleRate: 0,
		replaysOnErrorSampleRate: 0
	});
}

export const handleError = sentryEnabled ? Sentry.handleErrorWithSentry() : undefined;
