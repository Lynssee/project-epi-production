// src/routes/api/inspection/notify-dft-deviation/+server.ts
// Form inspeksi lapangan memanggil endpoint tipis ini (fire-and-forget) setelah draf tersimpan. Server menghitung
// ulang deviasi DFT dari data tersimpan (lihat $lib/server/dftDeviation) — body hanya menyebut reportId & objectId acuan.
// Fail-soft: gagal di sini TIDAK PERNAH menggagalkan penyimpanan inspeksi. Saklar & penerima diatur di ERP
// (/settings/project-management: project.scopespec.notify_dft_deviation; penerima: project_notify_recipients role supervisor).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { evaluateAndNotifyDftDeviation } from '$lib/server/dftDeviation';

export const POST: RequestHandler = async (event) => {
	await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const reportId = Number(body?.reportId);
	const objectId = Number(body?.objectId);
	if (!Number.isFinite(reportId) || reportId <= 0) throw error(400, 'reportId wajib diisi.');
	if (!Number.isFinite(objectId) || objectId <= 0) throw error(400, 'objectId wajib diisi.');
	try {
		const result = await evaluateAndNotifyDftDeviation(reportId, objectId);
		return json({ success: true, ...result });
	} catch (e: any) {
		console.warn('[inspection/notify-dft-deviation] gagal (diabaikan):', e?.message || e);
		return json({ success: false });
	}
};
