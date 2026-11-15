import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { directusServerJson } from '$lib/server/directus';
import { notifyN8n } from '$lib/server/n8nNotify';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const {
			project_id,
			project_name = '',
			tanggal = new Date().toISOString().split('T')[0],
			topic_tbm = '',
			pencatat_nama = 'Project Leader',
			records = []
		} = body;

		if (!project_id || !Array.isArray(records) || records.length === 0) {
			return json(
				{ success: false, error: 'Project ID dan minimal 1 record absensi wajib disertakan.' },
				{ status: 400 }
			);
		}

		let hadirCount = 0;
		let alphaCount = 0;
		let izinSakitCount = 0;
		const alphaWorkers: Array<{ id: number; nama: string; reason: string }> = [];

		// Proses setiap record presensi ke manpower_absensi
		for (const rec of records) {
			const {
				assignment_id,
				manpower_id,
				nama = '',
				status = 'hadir',
				notes = ''
			} = rec;

			if (!manpower_id || !assignment_id) continue;

			if (status === 'hadir' || status === 'setengah_hari') {
				hadirCount++;
			} else if (status === 'alpha') {
				alphaCount++;
				alphaWorkers.push({ id: manpower_id, nama, reason: notes || 'Tanpa Keterangan' });
			} else {
				izinSakitCount++;
			}

			// Cek apakah sudah ada absensi hari ini untuk assignment ini
			const existingRes = await directusServerJson<{ data?: any[] }>(
				`/items/manpower_absensi?filter[assignment_id][_eq]=${assignment_id}&filter[tanggal][_eq]=${tanggal}&limit=1`
			).catch(() => null);

			const existing = existingRes?.data?.[0];

			const payload: Record<string, any> = {
				assignment_id,
				manpower_id,
				project_id,
				tanggal,
				status,
				jam_kerja: status === 'hadir' ? 8 : (status === 'setengah_hari' ? 4 : 0),
				jam_masuk: status === 'hadir' || status === 'setengah_hari' ? `${tanggal}T08:00:00.000Z` : null,
				metode_catat: 'tbm_rollcall',
				dicatat_oleh: pencatat_nama,
				verifikasi_leader_status: 'disetujui',
				verifikasi_oleh_user: pencatat_nama,
				masuk_valid: true,
				sumber_lokasi: 'tbm_morning_briefing'
			};

			if (existing?.id) {
				// Update
				await directusServerJson(`/items/manpower_absensi/${existing.id}`, {
					method: 'PATCH',
					body: JSON.stringify(payload)
				});
			} else {
				// Create
				await directusServerJson(`/items/manpower_absensi`, {
					method: 'POST',
					body: JSON.stringify(payload)
				});
			}

			// Bila alpha, update total_mangkir_count dan reliability score di manpower
			if (status === 'alpha') {
				try {
					const mpRes = await directusServerJson<{ data?: any }>(
						`/items/manpower/${manpower_id}?fields=id,total_mangkir_count,reliability_score`
					).catch(() => null);
					const currentMp = mpRes?.data;
					if (currentMp) {
						const nextMangkir = Number(currentMp.total_mangkir_count || 0) + 1;
						// Penurunan reliabilitas 5 poin per mangkir
						const nextScore = Math.max(20, (Number(currentMp.reliability_score) || 100) - 5);
						const nextStatus = nextScore < 70 ? 'dalam_pengawasan' : (currentMp.status_komitmen || 'aktif');

						await directusServerJson(`/items/manpower/${manpower_id}`, {
							method: 'PATCH',
							body: JSON.stringify({
								total_mangkir_count: nextMangkir,
								reliability_score: nextScore,
								status_komitmen: nextStatus
							})
						});
					}
				} catch (mpErr) {
					console.warn(`[tbm-rollcall] Gagal update reliabilitas MP #${manpower_id}:`, mpErr);
				}
			}
		}

		// Trigger webhook notifikasi ke n8n
		const totalRencana = records.length;
		const complianceRate = totalRencana > 0 ? Math.round((hadirCount / totalRencana) * 100) : 100;

		notifyN8n('TBM_ROLLCALL_SUBMITTED', {
			project_id,
			project_name,
			tanggal,
			topic_tbm,
			pencatat_nama,
			total_rencana: totalRencana,
			total_hadir: hadirCount,
			total_izin_sakit: izinSakitCount,
			total_alpha: alphaCount,
			compliance_rate: complianceRate,
			alpha_workers: alphaWorkers,
			has_alert: alphaCount > 0 || complianceRate < 80
		}).catch((err) => console.warn('[tbm-rollcall] n8n notify warning:', err));

		return json({
			success: true,
			data: {
				project_id,
				total_rencana: totalRencana,
				hadir: hadirCount,
				alpha: alphaCount,
				izin_sakit: izinSakitCount,
				compliance_rate: complianceRate
			},
			message: `TBM Roll-Call berhasil disimpan: ${hadirCount}/${totalRencana} hadir (${complianceRate}%).`
		});
	} catch (error: any) {
		console.error('[tbm-rollcall/submit] Error:', error);
		return json({ success: false, error: error.message || 'Gagal menyimpan TBM Roll-Call' }, { status: 500 });
	}
};
