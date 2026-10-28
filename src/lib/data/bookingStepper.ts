// src/lib/data/bookingStepper.ts
// Peminjaman 11 §3.1–3.2 — stepper status booking yang JUJUR (logika murni, diuji). Dulu stepper selalu 4 langkah dengan
// "Review & Persetujuan GA" tunggal (padahal approval 1–3 tahap), menulis "Menunggu verifikasi admin GA" padahal sudah
// disetujui, dan "ditolak oleh Tim GA" walau yang menolak Manajer. Kini jumlah & nama tahap mengikuti approval nyata;
// bila progres approval tidak tersedia → "Menunggu persetujuan" (TANPA menyebut siapa).

export interface ApprovalProgress {
	current_step: number;
	total_steps: number;
	step_label?: string | null;
	steps: { order: number; label: string | null }[];
}

export interface StepperBooking {
	status: string;
	butuh_kendaraan?: boolean | null;
	approver?: string | null;
	alasan_tolak?: string | null;
	requester_name?: string | null;
	referensi_site_visit_id?: string | null;
	km_awal?: number | null;
	km_akhir?: number | null;
	approval_progress?: ApprovalProgress | null;
}

export type StepState = 'done' | 'current' | 'pending' | 'rejected';
export interface StepView {
	key: string;
	label: string;
	detail: string;
	state: StepState;
	icon: 'check' | 'clock' | 'x' | 'wheel' | 'pin';
}

const AKHIR = ['disetujui', 'aktif', 'selesai'];
const trim = (s?: string | null) => (s && String(s).trim() ? String(s).trim() : '');

/** Teks penolakan yang jujur: siapa + alasan (fallback bila kosong). */
export function teksDitolak(b: Pick<StepperBooking, 'approver' | 'alasan_tolak'>): string {
	return `Ditolak oleh ${trim(b.approver) || 'penyetuju'}: ${trim(b.alasan_tolak) || 'alasan tidak dicantumkan'}`;
}

export function buildSteps(b: StepperBooking, fmtTanggal: (iso?: string | null) => string = () => '', tanggalDiajukan?: string | null, tanggalApprove?: string | null): StepView[] {
	const steps: StepView[] = [];
	const tanpaKendaraan = b.butuh_kendaraan === false;

	steps.push({
		key: 'diajukan',
		label: 'Diajukan',
		detail: `Oleh ${trim(b.requester_name) || '-'}${tanggalDiajukan ? ` (${fmtTanggal(tanggalDiajukan)})` : ''}`,
		state: 'done',
		icon: 'check'
	});

	// ── Persetujuan
	if (b.status === 'ditolak') {
		steps.push({ key: 'ditolak', label: 'Ditolak', detail: teksDitolak(b), state: 'rejected', icon: 'x' });
		return steps;
	}
	if (b.status === 'dibatalkan') {
		steps.push({ key: 'dibatalkan', label: 'Dibatalkan', detail: 'Pengajuan ini dibatalkan.', state: 'rejected', icon: 'x' });
		return steps;
	}

	if (b.status === 'diajukan') {
		const p = b.approval_progress;
		if (p && Array.isArray(p.steps) && p.steps.length > 0 && p.total_steps > 0) {
			for (const s of p.steps) {
				const state: StepState = s.order < p.current_step ? 'done' : s.order === p.current_step ? 'current' : 'pending';
				steps.push({
					key: `approval-${s.order}`,
					label: `Persetujuan${s.label ? ` ${s.label}` : ''} (${s.order}/${p.total_steps})`,
					detail: state === 'done' ? 'Sudah disetujui' : state === 'current' ? 'Menunggu keputusan' : 'Belum sampai tahap ini',
					state,
					icon: state === 'done' ? 'check' : 'clock'
				});
			}
		} else {
			steps.push({ key: 'approval', label: 'Persetujuan', detail: 'Menunggu persetujuan.', state: 'current', icon: 'clock' });
		}
	} else {
		steps.push({
			key: 'approval',
			label: 'Disetujui',
			detail: trim(b.approver) ? `Disetujui oleh ${trim(b.approver)}${tanggalApprove ? ` (${fmtTanggal(tanggalApprove)})` : ''}` : tanggalApprove ? `Disetujui (${fmtTanggal(tanggalApprove)})` : 'Semua tahap persetujuan selesai.',
			state: 'done',
			icon: 'check'
		});
	}

	// ── Pelaksanaan
	const disetujuiAtauLebih = AKHIR.includes(b.status);
	if (tanpaKendaraan) {
		const sudahCheckin = !!b.referensi_site_visit_id || b.status === 'aktif' || b.status === 'selesai';
		steps.push({
			key: 'checkin',
			label: 'Check-in di Lokasi',
			detail: sudahCheckin ? 'Check-in tercatat.' : 'Check-in di lokasi kunjungan untuk memulai.',
			state: sudahCheckin ? 'done' : 'pending',
			icon: 'pin'
		});
		steps.push({ key: 'selesai', label: 'Kunjungan Selesai', detail: b.status === 'selesai' ? 'Kunjungan selesai.' : 'Selesai otomatis saat check-out.', state: b.status === 'selesai' ? 'done' : 'pending', icon: 'check' });
		return steps;
	}
	steps.push({
		key: 'pakai',
		label: 'Kendaraan Digunakan',
		detail: b.km_awal ? `KM awal keberangkatan: ${b.km_awal} km` : 'Isi pemeriksaan kendaraan lalu tekan "Mulai Pakai".',
		state: b.status === 'aktif' ? 'current' : b.status === 'selesai' ? 'done' : 'pending',
		icon: 'wheel'
	});
	steps.push({
		key: 'selesai',
		label: 'Dikembalikan',
		detail: b.status === 'selesai' ? (b.km_akhir ? `KM akhir: ${b.km_akhir} km` : 'Unit sudah dikembalikan.') : 'Unit dikembalikan ke pool kantor.',
		state: b.status === 'selesai' ? 'done' : 'pending',
		icon: 'check'
	});
	void disetujuiAtauLebih;
	return steps;
}
