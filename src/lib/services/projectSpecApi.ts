// src/lib/services/projectSpecApi.ts
// Spesifikasi teknis objek proyek (project_objects.spesifikasi_teknis) untuk dashboard lapangan — READ-ONLY.
// Diisi oleh admin di ERP (Project Charter → Objek Pekerjaan → Spek). Skema: erp-epi/src/lib/shared/projectScopeSpec.js.
// Relasi diambil TERPISAH (Aturan #2): charter proyek dulu, lalu objek — tanpa filter bersarang.

import { secureDirectusJson } from './secureDirectus';
import { parseSpecJson, specLayers, specTotalMicron } from '$lib/shared/projectSpecDft';

export interface ProjectObjectSpec {
	id: number;
	tipe: 'besi' | 'lantai' | string;
	nama: string;
	qty: number | null;
	satuan: string | null;
	luas: number | null;
	berat_kg: number | null;
	dimensi: string | null;
	material: string | null;
	kondisi: string | null;
	foto_identitas: string | null;
	/** Hasil parse spesifikasi (null bila belum diisi). */
	spec: Record<string, any> | null;
	/** Pengecualian tertulis (objek tidak butuh pelapisan). */
	pengecualian: string;
	layers: ReturnType<typeof specLayers>;
	totalMicron: number;
}

const FIELDS = 'id,project_charter_id,tipe,nama_objek,nama_area,qty,satuan,luas,berat_kg,dimensi,material,kondisi,foto_identitas,spesifikasi_teknis,urutan';

/** Ambil semua objek proyek beserta spesifikasinya. Melempar bila gagal — pemanggil menampilkan pesan, tidak menelan diam-diam. */
export async function fetchProjectObjectSpecs(projectId: number | string): Promise<ProjectObjectSpec[]> {
	const chFilter = encodeURIComponent(JSON.stringify({ project_id: { _eq: Number(projectId) } }));
	const ch = await secureDirectusJson(`/items/project_charters?filter=${chFilter}&fields=id&limit=-1`);
	const charterIds: number[] = (ch?.data || []).map((c: any) => c.id).filter(Boolean);
	if (charterIds.length === 0) return [];

	const objFilter = encodeURIComponent(JSON.stringify({ project_charter_id: { _in: charterIds } }));
	const res = await secureDirectusJson(`/items/project_objects?filter=${objFilter}&fields=${FIELDS}&sort=urutan,id&limit=-1`);
	return (res?.data || []).map((o: any): ProjectObjectSpec => {
		const spec = parseSpecJson(o.spesifikasi_teknis);
		return {
			id: o.id,
			tipe: o.tipe || 'besi',
			nama: String(o.nama_objek || o.nama_area || `Objek #${o.id}`),
			qty: o.qty ?? null,
			satuan: o.satuan ?? null,
			luas: o.luas ?? null,
			berat_kg: o.berat_kg ?? null,
			dimensi: o.dimensi ?? null,
			material: o.material ?? null,
			kondisi: o.kondisi ?? null,
			foto_identitas: typeof o.foto_identitas === 'object' ? o.foto_identitas?.id ?? null : o.foto_identitas ?? null,
			spec,
			pengecualian: String(spec?.pengecualian_alasan || '').trim(),
			layers: specLayers(spec),
			totalMicron: specTotalMicron(spec)
		};
	});
}
