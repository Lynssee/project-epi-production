// src/lib/services/sitePlanApi.ts
// Service API terpadu untuk Kanvas Interaktif Site Plan di Dashboard Lapangan (project-epi).
// Mengakses ga_denah dan ga_denah_pin yang terhubung dengan project_documents.

import { secureDirectusFetch, secureDirectusJson } from './secureDirectus';

export interface SitePlanPinType {
	id: string;
	label: string;
	icon: string;
	color: string;
	bgColor: string;
	borderColor: string;
	deskripsi: string;
}

export const SITE_PLAN_PIN_TYPES: Record<string, SitePlanPinType> = {
	zona_kerja: {
		id: 'zona_kerja',
		label: 'Zona Pekerjaan',
		icon: '🏗️',
		color: '#2563eb',
		bgColor: '#dbeafe',
		borderColor: '#3b82f6',
		deskripsi: 'Area kerja aktif seperti blasting, coating, fabrikasi, scaffolding'
	},
	qc_inspeksi: {
		id: 'qc_inspeksi',
		label: 'QC & Inspeksi',
		icon: '🔬',
		color: '#059669',
		bgColor: '#d1fae5',
		borderColor: '#10b981',
		deskripsi: 'Titik uji WFT, DFT, profil blasting, visual test, punch list'
	},
	hse_hazard: {
		id: 'hse_hazard',
		label: 'HSE & Area Bahaya',
		icon: '⚠️',
		color: '#dc2626',
		bgColor: '#fee2e2',
		borderColor: '#ef4444',
		deskripsi: 'Confined space, hot work, area mudah terbakar, jalur evakuasi, muster point'
	},
	equipment: {
		id: 'equipment',
		label: 'Alat & Equipment',
		icon: '🚜',
		color: '#d97706',
		bgColor: '#fef3c7',
		borderColor: '#f59e0b',
		deskripsi: 'Lokasi kompresor, genset, blasting pot, tangki air/udara'
	},
	staging: {
		id: 'staging',
		label: 'Staging & Material',
		icon: '📦',
		color: '#7c3aed',
		bgColor: '#ede9fe',
		borderColor: '#8b5cf6',
		deskripsi: 'Penumpukan cat, abrasive garnet/silica, thinner, limbah B3'
	},
	posko_akses: {
		id: 'posko_akses',
		label: 'Posko & Akses',
		icon: '🚪',
		color: '#0891b2',
		bgColor: '#cffafe',
		borderColor: '#06b6d4',
		deskripsi: 'Direksi keet, pos jaga/security, pintu masuk site, titik kumpul'
	},
	catatan: {
		id: 'catatan',
		label: 'Catatan Lapangan',
		icon: '💬',
		color: '#4b5563',
		bgColor: '#f3f4f6',
		borderColor: '#6b7280',
		deskripsi: 'Catatan pengawasan atau penanda teks umum'
	}
};

export interface SitePlanStatusOption {
	id: string;
	label: string;
	tone: string;
	color: string;
	badge: string;
}

export const SITE_PLAN_STATUS_OPTIONS: Record<string, SitePlanStatusOption> = {
	planned: {
		id: 'planned',
		label: 'Rencana',
		tone: 'neutral',
		color: '#64748b',
		badge: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300'
	},
	progress: {
		id: 'progress',
		label: 'On Progress',
		tone: 'amber',
		color: '#f59e0b',
		badge: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300'
	},
	done: {
		id: 'done',
		label: 'Selesai / Lolos QC',
		tone: 'green',
		color: '#10b981',
		badge: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300'
	},
	issue: {
		id: 'issue',
		label: 'Isu / NCR / Hazard',
		tone: 'red',
		color: '#ef4444',
		badge: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300'
	},
	hold: {
		id: 'hold',
		label: 'Hold / Tertunda',
		tone: 'purple',
		color: '#8b5cf6',
		badge: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-300'
	}
};

export interface SitePlanDoc {
	id: number;
	project_id: number;
	file_id: string;
	nama_dokumen: string;
	kategori: string;
	deskripsi?: string | null;
	date_created?: string;
}

export interface SitePlanDenah {
	id: number;
	nama: string;
	gambar: string;
	sort_order?: number;
}

export interface SitePlanPin {
	id?: number;
	denah_id: number;
	tipe: string;
	label: string;
	x_pct: number;
	y_pct: number;
	w_pct?: number | null;
	h_pct?: number | null;
	catatan?: string | null;
	status?: string;
	sort_order?: number;
}

export async function getProjectSitePlanDocuments(projectId: string | number): Promise<SitePlanDoc[]> {
	if (!projectId) return [];
	try {
		const filter = encodeURIComponent(
			JSON.stringify({
				_and: [
					{ project_id: { _eq: projectId } },
					{
						_or: [
							{ kategori: { _eq: 'Gambar Teknis' } },
							{ kategori: { _eq: 'Denah' } },
							{ nama_dokumen: { _icontains: 'denah' } },
							{ nama_dokumen: { _icontains: 'site' } },
							{ nama_dokumen: { _icontains: 'drawing' } },
							{ nama_dokumen: { _icontains: 'layout' } }
						]
					}
				]
			})
		);
		const json = await secureDirectusJson(
			`/items/project_documents?filter=${filter}&sort=-date_created&limit=100&fields=id,project_id,file_id,nama_dokumen,kategori,tipe,deskripsi,date_created`
		);
		return json?.data || [];
	} catch (err) {
		console.error('[sitePlanApi] getProjectSitePlanDocuments error:', err);
		return [];
	}
}

export async function ensureSitePlanDenah(projectId: string | number, fileId: string, nama?: string): Promise<SitePlanDenah> {
	if (!fileId) throw new Error('fileId wajib ada');
	const denahNama = nama || `Site Plan Proyek #${projectId}`;

	const filter = encodeURIComponent(JSON.stringify({ gambar: { _eq: fileId } }));
	const checkRes = await secureDirectusFetch(`/items/ga_denah?filter=${filter}&limit=1&fields=id,nama,gambar,sort_order`);
	if (checkRes.ok) {
		const checkJson = await checkRes.json();
		if (checkJson.data && checkJson.data.length > 0) {
			return checkJson.data[0];
		}
	}

	const payload = {
		nama: denahNama,
		gambar: fileId,
		sort_order: 10,
		status: 'active'
	};

	const createRes = await secureDirectusFetch(`/items/ga_denah`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});

	if (!createRes.ok) {
		const err = await createRes.json().catch(() => ({}));
		throw new Error(err.errors?.[0]?.message || 'Gagal mendaftarkan gambar ke ga_denah');
	}

	const createJson = await createRes.json();
	return createJson.data;
}

export async function getSitePlanPins(denahId: number): Promise<SitePlanPin[]> {
	if (!denahId) return [];
	try {
		const filter = encodeURIComponent(JSON.stringify({ denah_id: { _eq: denahId } }));
		const json = await secureDirectusJson(
			`/items/ga_denah_pin?filter=${filter}&sort=sort_order&limit=-1&fields=id,denah_id,tipe,label,x_pct,y_pct,w_pct,h_pct,catatan,status,date_created,date_updated`
		);
		return json?.data || [];
	} catch (err) {
		console.error('[sitePlanApi] getSitePlanPins error:', err);
		return [];
	}
}

export async function saveSitePlanPin(pin: SitePlanPin): Promise<SitePlanPin> {
	if (!pin.denah_id) throw new Error('denah_id wajib ada');
	const isUpdate = !!pin.id;

	const payload = {
		denah_id: Number(pin.denah_id),
		tipe: pin.tipe || 'zona_kerja',
		label: pin.label || 'Titik Tanpa Nama',
		x_pct: Number(pin.x_pct ?? 50),
		y_pct: Number(pin.y_pct ?? 50),
		w_pct: pin.w_pct ? Number(pin.w_pct) : null,
		h_pct: pin.h_pct ? Number(pin.h_pct) : null,
		catatan: pin.catatan || '',
		status: pin.status || 'planned',
		sort_order: pin.sort_order || 0
	};

	const endpoint = isUpdate ? `/items/ga_denah_pin/${pin.id}` : `/items/ga_denah_pin`;
	const method = isUpdate ? 'PATCH' : 'POST';

	const res = await secureDirectusFetch(endpoint, {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});

	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.errors?.[0]?.message || 'Gagal menyimpan pin site plan');
	}

	const json = await res.json();
	return json.data;
}

export async function deleteSitePlanPin(pinId: number): Promise<boolean> {
	if (!pinId) return false;
	const res = await secureDirectusFetch(`/items/ga_denah_pin/${pinId}`, {
		method: 'DELETE'
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({}));
		throw new Error(err.errors?.[0]?.message || 'Gagal menghapus pin site plan');
	}
	return true;
}

export async function updatePinCoordinates(pinId: number, x_pct: number, y_pct: number): Promise<SitePlanPin> {
	if (!pinId) throw new Error('pinId wajib ada');
	const res = await secureDirectusFetch(`/items/ga_denah_pin/${pinId}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			x_pct: Math.round(Number(x_pct) * 100) / 100,
			y_pct: Math.round(Number(y_pct) * 100) / 100
		})
	});
	if (!res.ok) throw new Error('Gagal memperbarui posisi pin');
	const json = await res.json();
	return json.data;
}
