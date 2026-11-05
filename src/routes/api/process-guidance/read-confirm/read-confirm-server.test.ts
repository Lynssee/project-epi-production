import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({
	authenticateEss: vi.fn()
}));

const mockDirectusJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...args: any[]) => mockDirectusJson(...args)
}));

const mockGateMode = vi.fn();
vi.mock('$lib/server/gateDefinitionsMode', () => ({
	resolveGateMode: (...args: any[]) => mockGateMode(...args)
}));

import { GET, POST } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';

const authMock = authenticateEss as unknown as ReturnType<typeof vi.fn>;

// Kolom skema live yang boleh diminta endpoint ini (Directus membalas 403 untuk kolom yang tidak ada).
const LIVE: Record<string, Set<string>> = {
	process_guidance_flows: new Set(['id', 'flow_key', 'title', 'sop_code', 'kategori_sop', 'sub_kategori', 'approval_status', 'sosialisasi_end_date', 'version', 'status', 'target_app']),
	sop_documents: new Set(['id', 'title', 'sop_code', 'department', 'approval_status', 'sosialisasi_end_date', 'version_seq', 'target_departments']),
	sop_read_confirmations: new Set(['id', 'flow_key', 'sop_id', 'flow_version', 'sop_version_seq', 'confirmed_at', 'karyawan_id', 'ip_address'])
};

describe('API: /api/process-guidance/read-confirm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		authMock.mockResolvedValue({
			user: { uid: 'user_123', email: 'mekanik@eltama.id' },
			karyawan: { id: 42, nama_karyawan: 'Budi Mekanik', divisi: 'Produksi' }
		});
		mockGateMode.mockResolvedValue('warn');
	});

	const ev = (qs = '') => ({ url: new URL(`http://project.test/api/process-guidance/read-confirm${qs}`) }) as any;

	describe('GET daftar belum dikonfirmasi', () => {
		function wire(opts: { flows?: any[]; sops?: any[]; confirms?: any[] } = {}) {
			mockDirectusJson.mockImplementation(async (endpoint: string) => {
				if (endpoint.startsWith('/items/process_guidance_flows')) return { data: opts.flows ?? [] };
				if (endpoint.startsWith('/items/sop_documents')) return { data: opts.sops ?? [] };
				if (endpoint.startsWith('/items/sop_read_confirmations')) return { data: opts.confirms ?? [] };
				return { data: [] };
			});
		}

		it('hanya alur MASA SOSIALISASI yang diminta (bukan semua published) dan kolom sesuai skema live', async () => {
			wire();
			await GET(ev());
			const flowCall = mockDirectusJson.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/items/process_guidance_flows'))!;
			expect(flowCall).toContain('filter[approval_status][_eq]=butuh_sosialisasi');
			expect(flowCall).not.toContain('sosialisasi,'); // 'sosialisasi' bukan nilai status
			for (const call of mockDirectusJson.mock.calls.map((c) => String(c[0]))) {
				const coll = /\/items\/([a-z_]+)/.exec(call)![1];
				const fields = /[?&]fields=([^&]*)/.exec(call)?.[1]?.split(',') ?? [];
				for (const f of fields) expect(LIVE[coll].has(f), `${coll}.${f}`).toBe(true);
			}
		});

		it('daftar unconfirmed: sadar versi + target departemen + mode gate dari pengaturan', async () => {
			wire({
				flows: [
					{ id: 1, flow_key: 'flow_a', title: 'Alur A', approval_status: 'butuh_sosialisasi', version: 2 },
					{ id: 2, flow_key: 'flow_b', title: 'Alur B', approval_status: 'butuh_sosialisasi', version: 1 }
				],
				sops: [
					{ id: 7, title: 'SOP Produksi', approval_status: 'butuh_sosialisasi', version_seq: 11, department: 'Produksi', target_departments: [] },
					{ id: 8, title: 'SOP Finance', approval_status: 'butuh_sosialisasi', version_seq: 11, department: 'Finance', target_departments: [] }
				],
				confirms: [
					{ flow_key: 'flow_a', flow_version: 1 }, // versi lama → wajib ulang
					{ flow_key: 'flow_b', flow_version: 1 } // versi terkini → sah
				]
			});
			const json = await (await GET(ev())).json();
			expect(mockGateMode).toHaveBeenCalledWith('G_FLD_SOP_READ_CONFIRMATION', 'laporan_harian');
			expect(json.gate_mode).toBe('warn');
			expect(json.is_blocked).toBe(false);
			expect(json.unconfirmed_items.map((i: any) => `${i.type}:${i.flow_key ?? i.sop_id}`)).toEqual(['flow:flow_a', 'sop:7']);
			expect(json.unconfirmed_count).toBe(2);
		});

		it('mode hard + ada yang belum dikonfirmasi → is_blocked; mode hard tanpa item → tidak diblokir', async () => {
			mockGateMode.mockResolvedValue('hard');
			wire({ flows: [{ id: 1, flow_key: 'flow_a', approval_status: 'butuh_sosialisasi', version: 1 }] });
			expect((await (await GET(ev())).json()).is_blocked).toBe(true);
			wire();
			expect((await (await GET(ev())).json()).is_blocked).toBe(false);
		});

		it('kegagalan Directus dicatat + dilaporkan di errors (tidak ditelan), dan tidak memblokir palsu', async () => {
			mockGateMode.mockResolvedValue('hard');
			mockDirectusJson.mockImplementation(async (endpoint: string) => {
				if (endpoint.startsWith('/items/process_guidance_flows')) throw new Error('403 FORBIDDEN');
				return { data: [] };
			});
			const json = await (await GET(ev())).json();
			expect(json.errors[0]).toContain('process_guidance_flows');
			expect(json.is_blocked).toBe(false);
			expect(console.error).toHaveBeenCalled();
		});

		it('gagal membaca mode gate → shadow (tidak pernah memblokir karena gangguan baca)', async () => {
			mockGateMode.mockRejectedValue(new Error('x'));
			wire({ flows: [{ id: 1, flow_key: 'a', approval_status: 'butuh_sosialisasi', version: 1 }] });
			const json = await (await GET(ev())).json();
			expect(json.gate_mode).toBe('shadow');
			expect(json.is_blocked).toBe(false);
		});
	});

	describe('GET spesifik', () => {
		it('alur: sah bila versi konfirmasi >= versi sekarang', async () => {
			mockDirectusJson.mockImplementation(async (endpoint: string) => {
				if (endpoint.startsWith('/items/process_guidance_flows')) return { data: [{ id: 1, version: 2 }] };
				return { data: [{ id: 10, confirmed_at: '2026-10-27T08:00:00Z', flow_version: 2 }] };
			});
			const json = await (await GET(ev('?flow_key=flow_prj_blasting'))).json();
			expect(json).toMatchObject({ success: true, confirmed: true, needs_reconfirm: false, confirmed_at: '2026-10-27T08:00:00Z', current_version: 2 });
		});

		it('alur: versi naik → needs_reconfirm (konfirmasi lama tidak sah)', async () => {
			mockDirectusJson.mockImplementation(async (endpoint: string) => {
				if (endpoint.startsWith('/items/process_guidance_flows')) return { data: [{ id: 1, version: 3 }] };
				return { data: [{ id: 10, confirmed_at: '2026-10-27T08:00:00Z', flow_version: 2 }] };
			});
			const json = await (await GET(ev('?flow_key=f'))).json();
			expect(json).toMatchObject({ confirmed: false, needs_reconfirm: true });
		});

		it('alur: konfirmasi lama tanpa flow_version dianggap v1 (tidak memaksa konfirmasi ulang alur v1)', async () => {
			mockDirectusJson.mockImplementation(async (endpoint: string) => {
				if (endpoint.startsWith('/items/process_guidance_flows')) return { data: [{ id: 1, version: 1 }] };
				return { data: [{ id: 10, confirmed_at: '2026-10-01T00:00:00Z', flow_version: null }] };
			});
			expect((await (await GET(ev('?flow_key=f'))).json()).confirmed).toBe(true);
		});

		it('SOP: belum ada konfirmasi → confirmed false', async () => {
			mockDirectusJson.mockImplementation(async (endpoint: string) => {
				if (endpoint.startsWith('/items/sop_documents')) return { data: [{ id: 7, version_seq: 11 }] };
				return { data: [] };
			});
			expect(await (await GET(ev('?sop_id=7'))).json()).toMatchObject({ confirmed: false, needs_reconfirm: false, current_version: 11 });
		});
	});

	describe('POST', () => {
		const post = (body: any) => ({ request: { json: async () => body }, getClientAddress: () => '10.0.0.1' }) as any;
		const posted = () => mockDirectusJson.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(c[1].body));

		function wirePost(opts: { flow?: any; sop?: any; dup?: any } = {}) {
			mockDirectusJson.mockImplementation(async (endpoint: string, opt: any) => {
				if (opt?.method === 'POST') return { data: { id: 888 } };
				if (endpoint.startsWith('/items/process_guidance_flows')) return { data: opts.flow ? [opts.flow] : [] };
				if (endpoint.startsWith('/items/sop_documents')) return { data: opts.sop ? [opts.sop] : [] };
				if (endpoint.startsWith('/items/sop_read_confirmations')) return { data: opts.dup ? [opts.dup] : [] };
				return { data: [] };
			});
		}

		it('alur: versi diambil dari SERVER (bukan kiriman klien) dan disimpan di flow_version', async () => {
			wirePost({ flow: { id: 1, version: 4 } });
			const json = await (await POST(post({ flow_key: 'flow_prj_blasting', version_seq: 1 }))).json();
			expect(json).toMatchObject({ success: true, id: 888 });
			expect(posted()[0]).toMatchObject({ karyawan_id: 42, flow_key: 'flow_prj_blasting', flow_version: 4, sop_version_seq: 4 });
		});

		it('SOP: version_seq dari server; sop_id disimpan', async () => {
			wirePost({ sop: { id: 7, version_seq: 11 } });
			await POST(post({ sop_id: 7, version_seq: 1 }));
			expect(posted()[0]).toMatchObject({ sop_id: 7, sop_version_seq: 11, karyawan_id: 42 });
			expect(posted()[0].flow_key).toBeUndefined();
		});

		it('alur / SOP fiktif → 404, tidak menulis', async () => {
			wirePost();
			await expect(POST(post({ flow_key: 'tidak_ada' }))).rejects.toMatchObject({ status: 404 });
			await expect(POST(post({ sop_id: 99 }))).rejects.toMatchObject({ status: 404 });
			expect(posted()).toEqual([]);
		});

		it('gagal verifikasi (Directus error) → 502, bukan 404', async () => {
			mockDirectusJson.mockRejectedValue(new Error('down'));
			await expect(POST(post({ flow_key: 'x' }))).rejects.toMatchObject({ status: 502 });
		});

		it('payload tanpa flow_key/sop_id → 400', async () => {
			await expect(POST(post({}))).rejects.toMatchObject({ status: 400 });
		});

		describe('antrean offline (queued)', () => {
			it('memakai waktu baca ASLI dari perangkat bila masuk akal', async () => {
				const readAt = new Date(Date.now() - 3 * 3600_000).toISOString();
				wirePost({ flow: { id: 1, version: 2 } });
				const json = await (await POST(post({ flow_key: 'f1', queued: true, read_at: readAt }))).json();
				expect(json).toMatchObject({ success: true, id: 888, confirmed_at: readAt });
				expect(posted()[0]).toMatchObject({ flow_key: 'f1', flow_version: 2, confirmed_at: readAt });
			});

			it('waktu di masa depan / terlalu lama / rusak diabaikan; tanpa queued read_at tidak dipercaya', async () => {
				wirePost({ flow: { id: 1, version: 1 } });
				const before = Date.now();
				for (const bad of [new Date(Date.now() + 86400_000).toISOString(), new Date(Date.now() - 90 * 86400_000).toISOString(), 'bukan-tanggal']) {
					const r = await (await POST(post({ flow_key: 'f1', queued: true, read_at: bad }))).json();
					expect(Date.parse(r.confirmed_at)).toBeGreaterThanOrEqual(before - 1000);
				}
				const r2 = await (await POST(post({ flow_key: 'f1', read_at: '2020-01-01T00:00:00.000Z' }))).json();
				expect(Date.parse(r2.confirmed_at)).toBeGreaterThanOrEqual(before - 1000);
			});

			it('IDEMPOTEN: sudah tercatat untuk alur+versi ini → tidak menulis lagi', async () => {
				wirePost({ flow: { id: 1, version: 3 }, dup: { id: 5, confirmed_at: '2026-10-28T01:00:00.000Z' } });
				const json = await (await POST(post({ flow_key: 'f1', queued: true, read_at: new Date().toISOString() }))).json();
				expect(json).toMatchObject({ success: true, id: 5, duplicate: true, confirmed_at: '2026-10-28T01:00:00.000Z' });
				expect(posted()).toEqual([]);
				const dupQuery = mockDirectusJson.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith('/items/sop_read_confirmations'))!;
				expect(dupQuery).toContain('filter[karyawan_id][_eq]=42');
				expect(dupQuery).toContain('filter[flow_version][_eq]=3');
			});

			it('kiriman biasa (bukan queued) tidak melakukan pemeriksaan duplikat', async () => {
				wirePost({ flow: { id: 1, version: 1 } });
				await POST(post({ flow_key: 'f1' }));
				const reads = mockDirectusJson.mock.calls.filter((c) => !c[1]?.method).map((c) => String(c[0]));
				expect(reads.some((u) => u.startsWith('/items/sop_read_confirmations'))).toBe(false);
			});
		});
	});

	it('GET ?mine=1: daftar flow_key yang sudah saya konfirmasi (unik), hanya milik karyawan ini', async () => {
		mockDirectusJson.mockResolvedValue({ data: [{ flow_key: 'flow_a' }, { flow_key: 'flow_b' }, { flow_key: 'flow_a' }, { flow_key: null }] });
		const res = await GET({ url: new URL('http://project.test/api/process-guidance/read-confirm?mine=1') } as any);
		const json = await res.json();
		expect(json).toEqual({ success: true, confirmed_keys: ['flow_a', 'flow_b'] });
		const called = mockDirectusJson.mock.calls[0][0] as string;
		expect(called).toContain('filter[karyawan_id][_eq]=42');
		expect(called).toContain('limit=-1');
	});

	it('GET ?mine=1: gagal baca Directus -> 502 (tidak ditelan jadi daftar kosong sukses)', async () => {
		mockDirectusJson.mockRejectedValue(new Error('HTTP 500'));
		const res = await GET({ url: new URL('http://project.test/api/process-guidance/read-confirm?mine=1') } as any);
		expect(res.status).toBe(502);
		expect((await res.json()).success).toBe(false);
	});
});
