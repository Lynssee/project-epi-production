// src/lib/services/projectObjectPhotoApi.ts
// Foto progres per tahap untuk objek proyek (Scope Teknis Fase 6). Memakai ulang koleksi `project_object_activities`
// (sama dengan log aktivitas di Project Charter ERP) dengan kolom `tahap`: persiapan | lapisan_<no> | hasil_akhir | lainnya.
// Kunci & label tahap dibangun dari spesifikasi objek — lihat $lib/shared/projectSpecDft (specPhotoStages).

import { secureDirectusJson } from './secureDirectus';
import { uploadFile } from './inspectionApi';

export interface ObjectStagePhoto {
	id: number;
	project_object_id: number;
	tahap: string | null;
	tanggal: string | null;
	aktivitas: string;
	foto: string | null;
	dibuat_oleh: string | null;
	date_created: string | null;
}

const FIELDS = 'id,project_object_id,tahap,tanggal,aktivitas,foto,dibuat_oleh,date_created';

/** Foto (aktivitas yang punya foto) untuk sekumpulan objek, terbaru dulu. Melempar bila gagal — pemanggil menampilkan pesan. */
export async function fetchObjectStagePhotos(objectIds: number[]): Promise<ObjectStagePhoto[]> {
	const ids = [...new Set((objectIds || []).filter((n) => Number.isFinite(Number(n))).map(Number))];
	if (ids.length === 0) return [];
	const filter = encodeURIComponent(JSON.stringify({ _and: [{ project_object_id: { _in: ids } }, { foto: { _nnull: true } }] }));
	const res = await secureDirectusJson(`/items/project_object_activities?filter=${filter}&fields=${FIELDS}&sort=-date_created&limit=300`);
	return (res?.data || []).map((r: any) => ({ ...r, foto: typeof r.foto === 'object' ? r.foto?.id ?? null : r.foto ?? null }));
}

/** Kelompokkan per objek lalu per tahap (tahap kosong → ''). Murni. */
export function groupPhotos(rows: ObjectStagePhoto[]): Record<number, Record<string, ObjectStagePhoto[]>> {
	const out: Record<number, Record<string, ObjectStagePhoto[]>> = {};
	for (const r of rows || []) {
		const byStage = (out[r.project_object_id] ||= {});
		(byStage[r.tahap || ''] ||= []).push(r);
	}
	return out;
}

/**
 * Unggah foto tahap: file → directus_files, lalu catat aktivitas bertahap. Dua langkah tidak atomik; bila langkah 2 gagal
 * foto sudah terunggah tetapi tidak tertaut — pesan error menyebutnya agar pengguna mencoba lagi (bukan menelan diam-diam).
 */
export async function addStagePhoto(p: {
	objectId: number;
	stageKey: string;
	stageLabel: string;
	file: File;
	author?: string | null;
	note?: string;
}): Promise<ObjectStagePhoto> {
	const fileId = await uploadFile(p.file, `project_object:${p.objectId}:${p.stageKey}`);
	if (!fileId) throw new Error('Foto gagal diunggah. Periksa koneksi lalu coba lagi.');
	try {
		const body = {
			project_object_id: p.objectId,
			tanggal: new Date().toISOString().slice(0, 10),
			aktivitas: `Foto tahap: ${p.stageLabel}${p.note ? ` — ${p.note}` : ''}`,
			foto: fileId,
			tahap: p.stageKey,
			dibuat_oleh: p.author || null
		};
		const res = await secureDirectusJson(`/items/project_object_activities`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		return { ...(res?.data || body), foto: fileId } as ObjectStagePhoto;
	} catch (e: any) {
		console.error('[projectObjectPhotoApi] foto terunggah tetapi gagal dicatat:', e);
		throw new Error('Foto terunggah tetapi gagal dicatat ke objek. Coba ambil ulang foto yang sama.');
	}
}
