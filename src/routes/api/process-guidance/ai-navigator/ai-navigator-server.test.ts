import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn() }));
vi.mock('$lib/server/processGuidanceFlows', () => ({ loadPublishedFlowsForField: vi.fn() }));
vi.mock('$lib/server/aiUsageLog', () => ({ logAiUsage: vi.fn() }));

import { GET, POST } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { clearFieldNavigatorCache } from './processAiNavigatorFieldService';

const mockFlows = [
	{
		id: 'alat_rusak_flow',
		flow_key: 'alat_rusak_flow',
		title: 'Alur Penggantian & Perbaikan Alat Proyek Rusak',
		sop_code: 'SOP-EQP-001',
		kategori_sop: 'induk',
		target_app: 'project-epi',
		lanes: [{ key: 'lapangan', label: 'Proyek Lapangan' }],
		nodes: [
			{
				id: 'n_lapor',
				label: 'Lapor Kerusakan Alat',
				pic: 'Mekanik / Mandor',
				desc: 'Foto alat rusak dan isi laporan',
				actions_field: [{ label: 'Input Kerusakan', href: '/maintenance/ticket' }],
				gates: [{ key: 'G_ALAT_FOTO', modul: 'equipment', documentType: 'ticket' }]
			}
		]
	},
	{
		id: 'kasbon_flow',
		flow_key: 'kasbon_flow',
		title: 'Alur Kasbon Lapangan & Petty Cash',
		sop_code: 'SOP-FIN-002',
		kategori_sop: 'induk',
		target_app: 'project-epi',
		lanes: [{ key: 'lapangan', label: 'Proyek Lapangan' }],
		nodes: [
			{
				id: 'n_kasbon',
				label: 'Pengajuan Kasbon',
				pic: 'Project Leader',
				desc: 'Ajukan kebutuhan dana operasional darurat',
				actions_field: [{ label: 'Form Kasbon', href: '/petty-cash/request' }],
				gates: []
			}
		]
	}
];

beforeEach(() => {
	vi.clearAllMocks();
	clearFieldNavigatorCache();
	(authenticateEss as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ localId: 'user-field' });
	(loadPublishedFlowsForField as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockFlows);
});

describe('GET /api/process-guidance/ai-navigator (project-epi)', () => {
	it('wajib login ess', async () => {
		(authenticateEss as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('Auth fail'), { status: 401 }));
		await expect((GET as any)({ url: new URL('http://localhost/api/process-guidance/ai-navigator') })).rejects.toMatchObject({
			status: 401
		});
	});

	it('mengembalikan status ready jika tanpa parameter q', async () => {
		const res = await (GET as any)({ url: new URL('http://localhost/api/process-guidance/ai-navigator') });
		const data = await res.json();
		expect(data).toMatchObject({ success: true, status: 'ready' });
	});

	it('mengembalikan alur deterministik jika parameter q disertakan', async () => {
		const res = await (GET as any)({ url: new URL('http://localhost/api/process-guidance/ai-navigator?q=alat+rusak') });
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data.found).toBe(true);
		expect(data.matchedFlowKey).toBe('alat_rusak_flow');
	});
});

describe('POST /api/process-guidance/ai-navigator (project-epi)', () => {
	it('menolak kueri kosong atau kurang dari 2 karakter', async () => {
		const req = {
			request: {
				json: async () => ({ query: 'a' })
			}
		};
		await expect((POST as any)(req)).rejects.toMatchObject({ status: 400 });
	});

	it('menjawab mode cepat dengan panduan deterministik lapangan', async () => {
		const req = {
			request: {
				json: async () => ({ query: 'kasbon', mode: 'fast' })
			}
		};
		const res = await (POST as any)(req);
		const data = await res.json();
		expect(data.success).toBe(true);
		expect(data.found).toBe(true);
		expect(data.matchedFlowKey).toBe('kasbon_flow');
		expect(data.stages[0].actionField.href).toBe('/petty-cash/request');
	});
});
