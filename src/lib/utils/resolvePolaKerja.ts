// src/lib/utils/resolvePolaKerja.ts
// Rencana Absensi Istirahat v2 §2.2 — resolver berlapis pola kerja karyawan (desk/mobile/
// produksi/hybrid). Fungsi MURNI (tanpa I/O) — pengambilan data karyawan/department ada di
// pemanggil server (lihat src/lib/server/ess/polaKerjaResolver.ts). Jangan tebak dari string
// `divisi` secara langsung di tempat lain — selalu lewat fungsi ini.

export type PolaKerja = 'desk' | 'mobile' | 'produksi' | 'hybrid';

export function resolvePolaKerja(params: {
	karyawanPolaKerja?: string | null;
	departmentPolaKerjaDefault?: string | null;
}): PolaKerja {
	const VALID: PolaKerja[] = ['desk', 'mobile', 'produksi', 'hybrid'];
	const override = params.karyawanPolaKerja;
	if (override && VALID.includes(override as PolaKerja)) return override as PolaKerja;

	const deptDefault = params.departmentPolaKerjaDefault;
	if (deptDefault && VALID.includes(deptDefault as PolaKerja)) return deptDefault as PolaKerja;

	return 'desk'; // fallback paling aman — metode paling ringan, tanpa hardware
}
