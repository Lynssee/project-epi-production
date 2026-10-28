// src/lib/shared/sjReadiness.ts
// SJH-18 — langkah kesiapan SJ untuk driver + kalimat "menunggu siapa". Murni (tanpa I/O):
// dipakai server (Lacak SJ) dan klien (kartu Delegasi). needsGate null = belum diketahui
// (klien) -> langkah satpam ditampilkan apa adanya tanpa mengklaim wajib.

export type ReadinessInput = {
	approval_status?: string | null;
	print_count?: number | string | null;
	track_stage?: string | null;
	status?: string | null;
	security_verified_at?: string | null;
};
export type ReadinessStep = { key: string; label: string; done: boolean; who: string };

const LOADED_STAGES = ['dimuat', 'menunggu_gerbang', 'lolos_gerbang', 'dalam_perjalanan', 'tiba_lokasi', 'diterima', 'selisih'];

export function sjReadiness(sj: ReadinessInput, needsGate: boolean | null = null): { steps: ReadinessStep[]; next_hint: string | null } {
	const passed = !!sj.security_verified_at || ['shipped', 'delivered', 'received', 'complete', 'closed'].includes(String(sj.status || ''));
	const steps: ReadinessStep[] = [
		{ key: 'disetujui', label: 'Disetujui', done: !sj.approval_status || ['disetujui', 'tidak_perlu'].includes(sj.approval_status), who: 'Admin/Approver' },
		{ key: 'dicetak', label: 'SJ dicetak', done: Number(sj.print_count) >= 1, who: 'Admin Logistik' },
		{ key: 'dimuat', label: 'Barang dimuat', done: LOADED_STAGES.includes(String(sj.track_stage || '')) || passed, who: 'Gudang' }
	];
	if (needsGate !== false) steps.push({ key: 'gerbang', label: 'Lolos satpam', done: passed, who: 'Satpam' });

	const next = steps.find((s) => !s.done);
	const HINT: Record<string, string> = {
		disetujui: 'Menunggu persetujuan admin.',
		dicetak: 'Menunggu admin logistik mencetak SJ.',
		dimuat: 'Menunggu gudang memuat barang.',
		gerbang: 'Menunggu satpam meloloskan di gerbang.'
	};
	return { steps, next_hint: next ? HINT[next.key] : null };
}
