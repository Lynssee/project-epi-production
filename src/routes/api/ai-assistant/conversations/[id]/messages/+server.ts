// src/routes/api/ai-assistant/conversations/[id]/messages/+server.ts
// Endpoint privat: isi satu thread ("lanjutkan percakapan" dari sidebar riwayat).
// Pemilik thread selalu boleh baca; Super Admin (permissions '*', diverifikasi
// SERVER-SIDE) boleh baca thread siapa pun untuk QC. Port dari erp-epi-1.

import { json, error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions } from '$lib/server/rbacServer';
import { getThreadMessages } from '$lib/server/aiConversations';

export async function GET(event: RequestEvent) {
	const user = await requireUser(event);
	const threadId = Number(event.params.id);
	if (!Number.isFinite(threadId)) throw error(400, 'id thread tidak valid');

	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId);
	const isSuperAdmin = permissions.includes('*');

	const result = await getThreadMessages(threadId, user.email, { allowAnyOwner: isSuperAdmin });
	if (!result) throw error(404, 'Thread tidak ditemukan atau bukan milik Anda.');

	return json({ success: true, data: result });
}
