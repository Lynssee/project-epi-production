// src/routes/api/kiosk/logout/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit';
import { KIOSK_COOKIE_NAME } from '$lib/server/kioskAuth';

export const POST: RequestHandler = async (event) => {
	event.cookies.delete(KIOSK_COOKIE_NAME, { path: '/' });
	event.cookies.delete(KIOSK_COOKIE_NAME, { path: '/kiosk' });
	return json({ success: true });
};
