import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { directusServerJson } from '$lib/server/directus';
import { notifyN8n } from '$lib/server/n8nNotify';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const {
			assignment_id,
			manpower_id,
			project_id,
			catatan,
			pelapor_nama = 'Project Leader',
			sisa_kasbon = 0
		} = body;

		if (!manpower_id || !assignment_id) {
			return json(
				{ success: false, error: 'Parameter assignment_id dan manpower_id wajib disertakan.' },
				{ status: 400 }
			);
		}

		if (!catatan || String(catatan).trim().length < 5) {
			return json(
				{ success: false, error: 'Catatan/kronologi kejadian kabur wajib diisi (minimal 5 karakter).' },
				{ status: 400 }
			);
		}

		// 1. Ambil data manpower saat ini
		const mpRes = await directusServerJson<{ data?: any }>(
			`/items/manpower/${manpower_id}?fields=id,nama,NIK,total_kabur_count,status_komitmen`
		).catch(() => null);

		const mpData = mpRes?.data;
		if (!mpData) {
			return json({ success: false, error: 'Data manpower tidak ditemukan di Directus.' }, { status: 404 });
		}

		const newKaburCount = Number(mpData.total_kabur_count || 0) + 1;
		const reason = `[KABUR DARI SITE] ${catatan} (Dilaporkan oleh: ${pelapor_nama})`;

		// 2. Kunci status manpower ke blacklist_kabur dan naikkan total_kabur_count
		await directusServerJson(`/items/manpower/${manpower_id}`, {
			method: 'PATCH',
			body: JSON.stringify({
				status_komitmen: 'blacklisted_kabur',
				total_kabur_count: newKaburCount,
				blacklist_alasan: reason
			})
		});

		// 3. Update status penugasan SPK ke selesai (kabur_mangkir)
		await directusServerJson(`/items/manpower_assignment/${assignment_id}`, {
			method: 'PATCH',
			body: JSON.stringify({
				status: 'selesai',
				status_penyelesaian: 'kabur_mangkir',
				lapor_kabur_at: new Date().toISOString(),
				lapor_kabur_catatan: reason
			})
		});

		// 4. Trigger alert broadcast ke n8n
		notifyN8n('MANPOWER_KABUR_ALERT', {
			manpower_id: mpData.id,
			manpower_nama: mpData.nama,
			manpower_nik: mpData.NIK,
			assignment_id,
			project_id,
			sisa_kasbon,
			alasan: catatan,
			pelapor: pelapor_nama
		}).catch((err) => console.warn('[lapor-kabur] n8n notify error (non-fatal):', err));

		return json({
			success: true,
			message: `Laporan pekerja kabur (${mpData.nama}) berhasil dicatat. NIK telah masuk daftar BLACKLIST dan peringatan telah disiarkan.`
		});
	} catch (error: any) {
		console.error('[lapor-kabur] Error:', error);
		return json({ success: false, error: error.message || 'Terjadi kesalahan server' }, { status: 500 });
	}
};
