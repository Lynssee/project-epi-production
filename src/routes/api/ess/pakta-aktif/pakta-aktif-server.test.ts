import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn() }));
const mockDirectus = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => mockDirectus(...a) }));
const mockGateMode = vi.fn();
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: (...a: any[]) => mockGateMode(...a) }));

import { GET } from './+server';
import { POST as KEBERATAN } from '../pakta-keberatan/+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { clearPaktaCache } from '$lib/server/paktaServer';

const authMock = authenticateEss as unknown as ReturnType<typeof vi.fn>;
const ev = (path: string) => ({ url: new URL(`http://project.test/api/ess/pakta-aktif?path=${encodeURIComponent(path)}`) }) as any;

const OPNAME_SOP = { ai_summary: '<p>Wajib   foto rak sebelum simpan angka.</p>', id: 10, title: 'SOP Stock Opname Site', sop_code: 'SOP-PRJ-320', department: null, approval_status: 'butuh_sosialisasi', version_seq: 2, target_departments: [] };
const KAS_SOP = { id: 11, title: 'SOP Kasbon', sop_code: 'SOP-FIN-001', department: null, approval_status: 'butuh_sosialisasi', version_seq: 1, target_departments: [] };
const GATE_DEF = { gate_key: 'G_FLD_PAKTA_PRAKEGIATAN', nama: 'Pakta Pra-Kegiatan', hint: 'Baca lalu setujui', message: 'm', is_active: true };

interface Wire { enabled?: boolean; confirms?: any[]; objections?: any[] | Error; gateDef?: any | null; sops?: any[]; settings?: any[] }
function wire(o: Wire = {}) {
	mockDirectus.mockImplementation(async (endpoint: string, opt?: any) => {
		if (opt?.method === 'POST') return { data: { id: 7 } };
		if (endpoint.startsWith('/items/system_settings')) {
			return { data: o.settings ?? [{ setting_key: 'project.pakta.enabled', setting_type: 'boolean', setting_value: o.enabled === false ? 'false' : 'true' }] };
		}
		if (endpoint.startsWith('/items/process_guidance_flows')) return { data: [] };
		if (endpoint.startsWith('/items/sop_documents')) return { data: o.sops ?? [OPNAME_SOP, KAS_SOP] };
		if (endpoint.startsWith('/items/gate_definitions')) return { data: o.gateDef === undefined ? [GATE_DEF] : o.gateDef ? [o.gateDef] : [] };
		if (endpoint.startsWith('/items/sop_read_confirmations')) return { data: o.confirms ?? [] };
		if (endpoint.startsWith('/items/pakta_persetujuan')) {
			if (o.objections instanceof Error) throw o.objections;
			return { data: o.objections ?? [] };
		}
		return { data: [] };
	});
}
const callsTo = (prefix: string) => mockDirectus.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix));

beforeEach(() => {
	vi.clearAllMocks();
	clearPaktaCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	authMock.mockResolvedValue({ user: { uid: 'u' }, karyawan: { id: 42, divisi: 'Produksi' } });
	mockGateMode.mockResolvedValue('hard');
});

describe('GET /api/ess/pakta-aktif', () => {
	it('fitur MATI (default) → jawab cepat tanpa menyentuh katalog/konfirmasi', async () => {
		wire({ enabled: false });
		const j = await (await GET(ev('/stock-lapangan/opname'))).json();
		expect(j).toMatchObject({ success: true, enabled: false, items: [], decision: { show: false, blocked: false } });
		expect(callsTo('/items/sop_documents')).toHaveLength(0);
		expect(callsTo('/items/sop_read_confirmations')).toHaveLength(0);
	});

	it('rute tanpa aturan / rute darurat → tidak ada query katalog sama sekali', async () => {
		wire();
		for (const p of ['/kasbon-terpusat', '/absen', '/panduan/alur']) {
			const j = await (await GET(ev(p))).json();
			expect(j.decision.show).toBe(false);
		}
		expect(callsTo('/items/sop_documents')).toHaveLength(0);
	});

	it('hard + SOP opname belum dikonfirmasi → modal menahan; SOP kasbon TIDAK ikut mengunci opname', async () => {
		wire();
		const j = await (await GET(ev('/stock-lapangan/opname'))).json();
		expect(j.gate_mode).toBe('hard');
		expect(j.decision).toMatchObject({ show: true, presentation: 'modal', blocked: true });
		expect(j.items.map((i: any) => i.sop_id)).toEqual([10]);
		expect(j.items[0].baca_url).toBe('/ess/pelatihan/sop/10');
		expect(j.items[0].ringkasan).toBe('Wajib foto rak sebelum simpan angka.');
		expect(j.settings).toEqual({ min_read_seconds: 5, require_scroll: false });
	});

	it('sudah konfirmasi versi terbaru → tidak tampil; konfirmasi versi lama → tetap tampil (sadar versi)', async () => {
		wire({ confirms: [{ sop_id: 10, sop_version_seq: 2 }] });
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision.show).toBe(false);
		clearPaktaCache();
		wire({ confirms: [{ sop_id: 10, sop_version_seq: 1 }] });
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision.blocked).toBe(true);
	});

	it('hard + dispensasi atasan → terbuka', async () => {
		wire({ objections: [{ doc_type: 'sop', doc_key: '10', doc_version: 2, status: 'dispensasi' }] });
		const j = await (await GET(ev('/stock-lapangan/opname'))).json();
		expect(j.decision).toMatchObject({ show: false, blocked: false });
	});

	it('keberatan pada versi lama tidak berlaku untuk versi baru', async () => {
		wire({ objections: [{ doc_type: 'sop', doc_key: '10', doc_version: 1, status: 'dispensasi' }] });
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision.blocked).toBe(true);
	});

	it('soft → boleh lanjut dengan catatan; shadow → tidak tampil', async () => {
		mockGateMode.mockResolvedValue('soft');
		wire();
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision).toMatchObject({ presentation: 'modal', blocked: false, canProceedWithNote: true });
		clearPaktaCache();
		mockGateMode.mockResolvedValue('shadow');
		wire();
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision.show).toBe(false);
	});

	it('gate BELUM terdaftar di gate_definitions → shadow (tidak pernah mengunci tanpa definisi yang bisa diatur UI, aturan #11)', async () => {
		wire({ gateDef: null });
		const j = await (await GET(ev('/stock-lapangan/opname'))).json();
		expect(j.gate_mode).toBe('shadow');
		expect(j.decision.show).toBe(false);
		expect(mockGateMode).not.toHaveBeenCalled();
	});

	it('koleksi pakta_persetujuan belum ada (Directus error) → fitur lain tetap jalan, error dilaporkan, tidak 500', async () => {
		wire({ objections: new Error('FORBIDDEN') });
		const j = await (await GET(ev('/stock-lapangan/opname'))).json();
		expect(j.decision.blocked).toBe(true);
		expect(j.errors.join(' ')).toContain('pakta_persetujuan');
	});

	it('katalog & setelan di-cache: panggilan kedua tidak mengulang query', async () => {
		wire();
		await GET(ev('/stock-lapangan/opname'));
		await GET(ev('/stock-lapangan/opname-sesi'));
		expect(callsTo('/items/sop_documents')).toHaveLength(1);
		expect(callsTo('/items/gate_definitions')).toHaveLength(1);
		expect(callsTo('/items/system_settings')).toHaveLength(1);
	});

	it('kolom yang diminta hanya yang ada di skema live', async () => {
		wire();
		await GET(ev('/stock-lapangan/opname'));
		const LIVE: Record<string, Set<string>> = {
			process_guidance_flows: new Set(['id', 'flow_key', 'title', 'sop_code', 'kategori_sop', 'sub_kategori', 'approval_status', 'sosialisasi_end_date', 'version', 'status', 'target_app']),
			sop_documents: new Set(['id', 'title', 'sop_code', 'department', 'approval_status', 'sosialisasi_end_date', 'version_seq', 'target_departments', 'ai_summary']),
			sop_read_confirmations: new Set(['id', 'flow_key', 'sop_id', 'flow_version', 'sop_version_seq', 'confirmed_at', 'karyawan_id', 'ip_address']),
			gate_definitions: new Set(['gate_key', 'nama', 'hint', 'message', 'is_active'])
		};
		for (const call of mockDirectus.mock.calls.map((c) => String(c[0]))) {
			const coll = /\/items\/([a-z_]+)/.exec(call)![1];
			if (!LIVE[coll]) continue;
			for (const f of (/[?&]fields=([^&]*)/.exec(call)?.[1] ?? '').split(',').filter(Boolean)) expect(LIVE[coll].has(f), `${coll}.${f}`).toBe(true);
		}
	});
});

describe('POST /api/ess/pakta-keberatan', () => {
	const post = (body: any) => ({ request: { json: async () => body }, getClientAddress: () => '10.0.0.1' }) as any;
	const posted = () => mockDirectus.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(c[1].body));
	const valid = { sop_id: 10, kategori: 'alat_belum_tersedia', alasan: 'Alat hitung belum ada di site Gresik', route: '/stock-lapangan/opname' };

	it('mencatat keberatan: versi dari SERVER, status menunggu', async () => {
		wire();
		const j = await (await KEBERATAN(post({ ...valid, version: 99 }))).json();
		expect(j).toMatchObject({ success: true, id: 7, status: 'menunggu' });
		expect(posted()[0]).toMatchObject({ karyawan_id: 42, doc_type: 'sop', doc_key: '10', doc_version: 2, keputusan: 'objection', status: 'menunggu', kategori_kendala: 'alat_belum_tersedia', ip_address: '10.0.0.1' });
	});

	it('validasi: alasan pendek, kategori salah, tanpa dokumen → 400', async () => {
		wire();
		await expect(KEBERATAN(post({ ...valid, alasan: 'singkat' }))).rejects.toMatchObject({ status: 400 });
		await expect(KEBERATAN(post({ ...valid, kategori: 'ngarang' }))).rejects.toMatchObject({ status: 400 });
		await expect(KEBERATAN(post({ kategori: 'lainnya', alasan: 'x'.repeat(20) }))).rejects.toMatchObject({ status: 400 });
		expect(posted()).toEqual([]);
	});

	it('dokumen fiktif / bukan masa sosialisasi → 404; tidak menulis', async () => {
		wire();
		await expect(KEBERATAN(post({ ...valid, sop_id: 999 }))).rejects.toMatchObject({ status: 404 });
		expect(posted()).toEqual([]);
	});

	it('idempoten: keberatan menunggu untuk versi yang sama tidak digandakan', async () => {
		wire({ objections: [{ doc_type: 'sop', doc_key: '10', doc_version: 2, status: 'menunggu' }] });
		const j = await (await KEBERATAN(post(valid))).json();
		expect(j.duplicate).toBe(true);
		expect(posted()).toEqual([]);
	});

	it('koleksi belum dibuat → 503 jelas (bukan hilang diam-diam)', async () => {
		wire({ objections: new Error('FORBIDDEN') });
		await expect(KEBERATAN(post(valid))).rejects.toMatchObject({ status: 503 });
	});
});
