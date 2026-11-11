import { describe, it, expect, vi, beforeEach } from 'vitest';

const dx = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => dx(...a) }));
vi.mock('$lib/server/preventive/preventiveGuard', () => ({
	authenticatePreventiveOperator: async () => ({ karyawan: { id: 7 }, personnel: { id: 'me', name: 'LEADER A', karyawan_id: 7 } })
}));
const resolveLed = vi.fn();
vi.mock('$lib/server/projectLeaderGuard', () => ({ resolveLedProjectIds: (...a: any[]) => resolveLed(...a) }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: async () => 'shadow' }));
vi.mock('$lib/server/gates/gateAudit', () => ({ writeGateAudit: vi.fn(async () => {}) }));

const { GET } = await import('./+server');
const call = async (qs = '') => (await (GET as any)({ url: new URL(`http://x/api/preventive/p2h/terbuka${qs}`) })).json();

function db() {
	dx.mockImplementation(async (url: string) => {
		if (url.includes('filter%5Boperator_id%5D%5B_eq%5D=me') || url.includes('filter[operator_id][_eq]=me')) return { data: [{ id: 's-mine', equipment_id: 'e1', operator_id: 'me', date: '2026-11-05' }] };
		if (url.includes('internal_loan_log')) return { data: [{ equipment_id: 'e2' }, { equipment_id: { id: 'e3' } }] };
		if (url.includes('equipment_id%5D%5B_in%5D') || url.includes('filter[equipment_id][_in]')) return { data: [{ id: 's-op', equipment_id: 'e2', operator_id: 'op1', date: '2026-11-04' }] };
		if (url.includes('/items/personnel')) return { data: [{ id: 'op1', name: 'YUSUF' }] };
		if (url.includes('/items/equipment')) return { data: [{ id: 'e1', name: 'U1', code: 'C1' }, { id: 'e2', name: 'U2', code: 'C2' }] };
		throw new Error('url tak terduga: ' + url);
	});
}
beforeEach(() => {
	dx.mockReset();
	resolveLed.mockReset();
});

describe('GET /api/preventive/p2h/terbuka — mode Leader (PMT-49)', () => {
	it('tanpa leader=1: hanya sesi milik sendiri, tidak memanggil resolusi proyek', async () => {
		db();
		const r = await call();
		expect(r.sessions.map((s: any) => s.id)).toEqual(['s-mine']);
		expect(resolveLed).not.toHaveBeenCalled();
	});

	it('leader=1 dengan proyek yang dipimpin: menambah sesi operator lain di unit proyek, ditandai is_leader_scope + nama operator', async () => {
		db();
		resolveLed.mockResolvedValue([5]);
		const r = await call('?leader=1');
		const op = r.sessions.find((s: any) => s.id === 's-op');
		expect(op).toMatchObject({ is_leader_scope: true, is_mine: false, operator_name: 'YUSUF' });
		expect(r.sessions.find((s: any) => s.id === 's-mine')).toMatchObject({ is_mine: true, is_leader_scope: false });
	});

	it('leader=1 tetapi tidak memimpin proyek apa pun: sama seperti tanpa leader', async () => {
		db();
		resolveLed.mockResolvedValue([]);
		const r = await call('?leader=1');
		expect(r.sessions.map((s: any) => s.id)).toEqual(['s-mine']);
	});

	it('gagal membaca proyek Leader tidak menggagalkan daftar milik sendiri', async () => {
		db();
		resolveLed.mockRejectedValue(new Error('down'));
		const r = await call('?leader=1');
		expect(r.sessions.map((s: any) => s.id)).toEqual(['s-mine']);
	});
});
