// src/routes/api/ess/kpi/print-url/+server.ts
// UPFE Fase 4 — Penyedia URL Pratinjau Interaktif Rapor KPI Lapangan (Admin erp-epi /print/kpi).
// Wajib login ESS (authenticateEss).
// Keamanan ketat: Karyawan lapangan hanya dapat mengakses Rapor Individu miliknya sendiri (scope=individual & entity=karyawan.id).
// Hanya Project Leader / Koordinator yang berhak melihat ringkasan matriks tim proyeknya (jika berizin).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { env } from '$env/dynamic/private';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const baseUrl = env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390');
	if (!baseUrl) {
		return json({ available: false, reason: 'Koneksi ke server ERP Admin belum dikonfigurasi.' }, { status: 503 });
	}

	const cleanBase = baseUrl.replace(/\/$/, '');
	const qp = event.url.searchParams;
	const period = qp.get('period') || new Date().toISOString().slice(0, 7);
	const requestedScope = qp.get('scope') || 'individual';

	// Proteksi ketat: jika meminta scope selain individual, cek apakah karyawan memiliki peran pimpinan
	let scope = 'individual';
	let entity = String(karyawan.id);
	let department = karyawan.divisi || '';

	if (requestedScope === 'department') {
		const isLeader = /leader|manager|head|kepala|supervisor|koordinator/i.test(karyawan.posisi || '');
		if (!isLeader) {
			throw error(403, 'Akses terbatas: Anda hanya berwenang melihat Rapor Kinerja Individu.');
		}
		scope = 'department';
	}

	const printUrl = scope === 'department'
		? `${cleanBase}/print/kpi?period=${encodeURIComponent(period)}&scope=department&department=${encodeURIComponent(department)}&stakeholder=ops&depth=detailed`
		: `${cleanBase}/print/kpi?period=${encodeURIComponent(period)}&scope=individual&entityType=karyawan&entity=${encodeURIComponent(entity)}&stakeholder=ops&depth=detailed`;

	return json({
		available: true,
		url: printUrl,
		title: scope === 'department' ? `Matriks Kinerja Tim ${department}` : `Rapor Kinerja - ${karyawan.nama_karyawan}`,
		scope,
		period,
		karyawan: {
			id: karyawan.id,
			nama: karyawan.nama_karyawan,
			posisi: karyawan.posisi,
			departemen: karyawan.divisi
		}
	});
};
