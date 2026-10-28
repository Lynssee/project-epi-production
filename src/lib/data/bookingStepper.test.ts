import { describe, expect, it } from 'vitest';
import { buildSteps, teksDitolak, type StepperBooking } from './bookingStepper';

const base: StepperBooking = { status: 'diajukan', requester_name: 'Budi' };
const label = (b: StepperBooking) => buildSteps(b).map((s) => s.label);

describe('teksDitolak (U1)', () => {
	it('menyebut nama penolak & alasan', () => {
		expect(teksDitolak({ approver: 'Bu Sari', alasan_tolak: 'Unit dipakai proyek' })).toBe('Ditolak oleh Bu Sari: Unit dipakai proyek');
	});
	it('fallback jujur bila kosong (bukan "Tim GA")', () => {
		expect(teksDitolak({})).toBe('Ditolak oleh penyetuju: alasan tidak dicantumkan');
		expect(teksDitolak({ approver: '  ', alasan_tolak: '' })).toContain('penyetuju');
	});
});

describe('buildSteps — jumlah tahap sesuai approval nyata (U3)', () => {
	const progress = (current: number, total: number, labels: (string | null)[]) => ({
		current_step: current,
		total_steps: total,
		steps: labels.map((l, i) => ({ order: i + 1, label: l }))
	});
	it('luar kota di tahap 2 dari 3 → "2/3", tahap 1 selesai, tahap 3 belum', () => {
		const s = buildSteps({ ...base, approval_progress: progress(2, 3, ['MANAGER', 'GENERAL MANAGER', 'HR MANAGER']) });
		const approval = s.filter((x) => x.key.startsWith('approval-'));
		expect(approval.map((x) => x.state)).toEqual(['done', 'current', 'pending']);
		expect(approval[1].label).toBe('Persetujuan GENERAL MANAGER (2/3)');
	});
	it('progres tidak tersedia → "Menunggu persetujuan" TANPA menyebut GA', () => {
		const s = buildSteps(base);
		expect(s.find((x) => x.key === 'approval')?.detail).toBe('Menunggu persetujuan.');
		expect(JSON.stringify(s)).not.toContain('GA');
	});
});

describe('buildSteps — status akhir', () => {
	it('U2: disetujui via engine → hijau dengan nama penyetuju, tanpa "Menunggu verifikasi"', () => {
		const s = buildSteps({ status: 'disetujui', approver: 'Yasinta', requester_name: 'Budi' });
		const a = s.find((x) => x.key === 'approval')!;
		expect(a.state).toBe('done');
		expect(a.detail).toContain('Disetujui oleh Yasinta');
		expect(JSON.stringify(s)).not.toContain('Menunggu verifikasi');
	});
	it('disetujui tanpa nama approver tetap tidak berbohong', () => {
		const a = buildSteps({ status: 'aktif' }).find((x) => x.key === 'approval')!;
		expect(a.state).toBe('done');
		expect(a.detail).toBe('Semua tahap persetujuan selesai.');
	});
	it('ditolak: berhenti di langkah Ditolak dengan alasan; dibatalkan: berhenti', () => {
		const t = buildSteps({ status: 'ditolak', approver: 'Bu Sari', alasan_tolak: 'Penuh' });
		expect(t.map((x) => x.key)).toEqual(['diajukan', 'ditolak']);
		expect(t[1].state).toBe('rejected');
		expect(t[1].detail).toContain('Bu Sari');
		expect(buildSteps({ status: 'dibatalkan' }).map((x) => x.key)).toEqual(['diajukan', 'dibatalkan']);
	});
	it('aktif → "Kendaraan Digunakan" current; selesai → semua done', () => {
		expect(buildSteps({ status: 'aktif' }).find((x) => x.key === 'pakai')?.state).toBe('current');
		const s = buildSteps({ status: 'selesai', km_awal: 100, km_akhir: 150 });
		expect(s.every((x) => x.state === 'done')).toBe(true);
	});
});

describe('buildSteps — tanpa kendaraan', () => {
	it('tidak ada langkah "Kendaraan Digunakan"; ada Check-in', () => {
		const s = buildSteps({ status: 'disetujui', butuh_kendaraan: false });
		expect(s.map((x) => x.key)).toEqual(['diajukan', 'approval', 'checkin', 'selesai']);
		expect(s.find((x) => x.key === 'checkin')?.state).toBe('pending');
		expect(buildSteps({ status: 'aktif', butuh_kendaraan: false, referensi_site_visit_id: 'sv1' }).find((x) => x.key === 'checkin')?.state).toBe('done');
	});
});
