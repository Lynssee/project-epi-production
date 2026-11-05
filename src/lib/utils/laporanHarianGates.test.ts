import { describe, it, expect } from 'vitest';
import { evaluateLaporanHarianGates, type LaporanHarianGateContext } from './laporanHarianGates';

describe('evaluateLaporanHarianGates — Integrasi Gate SOP Lapangan', () => {
	const baseContext: LaporanHarianGateContext = {
		cleanSchedule: [],
		cleanTomorrowPlan: [],
		cleanProgress: [],
		progressPhotosCount: 0,
		cleanMaterialUsed: [],
		cleanManpower: [],
		attendancePhotosCount: 0,
		isFriday: false,
		weekendLocationRecap: '',
		weekendPhotosCount: 0,
		date: '2026-10-27',
		activityStatus: 'berjalan',
		weather: 'cerah',
		manpowerCount: 5,
		generalNotes: 'Pekerjaan berjalan lancar hari ini.',
		issuesGeneral: 'Tidak ada kendala berarti.',
		tomorrowPlanSummary: 'Melanjutkan pekerjaan blasting dan inspeksi.'
	};

	it('tidak menambahkan G_FLD_SOP_READ_CONFIRMATION bila seluruh SOP sudah dikonfirmasi (count = 0)', () => {
		const gates = evaluateLaporanHarianGates({
			...baseContext,
			unconfirmedSopCount: 0
		});
		expect(gates.some((g) => g.gate_key === 'G_FLD_SOP_READ_CONFIRMATION')).toBe(false);
	});

	it('menambahkan G_FLD_SOP_READ_CONFIRMATION dengan severity WARN saat mode gate = warn', () => {
		const gates = evaluateLaporanHarianGates({
			...baseContext,
			unconfirmedSopCount: 2,
			sopGateMode: 'warn'
		});
		const sopGate = gates.find((g) => g.gate_key === 'G_FLD_SOP_READ_CONFIRMATION');
		expect(sopGate).toBeDefined();
		expect(sopGate?.severity).toBe('WARN');
		expect(sopGate?.status).toBe('failed');
		expect(sopGate?.message).toContain('Terdapat 2 SOP/Alur baru');
	});

	it('menambahkan G_FLD_SOP_READ_CONFIRMATION dengan severity WAJIB saat mode gate = hard (hard block)', () => {
		const gates = evaluateLaporanHarianGates({
			...baseContext,
			unconfirmedSopCount: 1,
			sopGateMode: 'hard'
		});
		const sopGate = gates.find((g) => g.gate_key === 'G_FLD_SOP_READ_CONFIRMATION');
		expect(sopGate).toBeDefined();
		expect(sopGate?.severity).toBe('WAJIB');
		expect(sopGate?.status).toBe('failed');
	});
});
