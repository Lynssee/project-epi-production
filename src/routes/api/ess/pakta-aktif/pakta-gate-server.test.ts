import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn() }));
const mockDirectus = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => mockDirectus(...a) }));
const mockGateMode = vi.fn();
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: (...a: any[]) => mockGateMode(...a) }));
const mockSign = vi.fn((_i: any) => 'KODE-GATE-24-KARAKTER-A' as string | null);
const mockPersist = vi.fn(async (..._a: any[]) => true);
vi.mock('$lib/server/paktaSign', () => ({ signKonfirmasi: (i: any) => mockSign(i), persistSignatureHash: (...a: any[]) => mockPersist(...a) }));

import { GET } from './+server';
import { POST as SETUJU } from '../pakta-setuju-gate/+server';
import { POST as KEBERATAN } from '../pakta-keberatan/+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { clearPaktaCache } from '$lib/server/paktaServer';

const authMock = authenticateEss as unknown as ReturnType<typeof vi.fn>;
const ev = (path: string) => ({ url: new URL(`http://project.test/api/ess/pakta-aktif?path=${encodeURIComponent(path)}`) }) as any;
const post = (body: any) => ({ request: { json: async () => body }, getClientAddress: () => '10.0.0.1' }) as any;

const RULES = [{ path_prefix: '/stock-lapangan/opname', label: 'Stock Opname', match: { gate_keys: ['G_INV_OPNAME_FOTO'] } }];
const NOW = new Date().toISOString();
const GATE_DEF = { gate_key: 'G_FLD_PAKTA_PRAKEGIATAN', nama: 'Pakta Pra-Kegiatan', hint: 'h', message: 'm', is_active: true };

interface W { logs?: any[]; approvals?: any[] | Error; objections?: any[]; rules?: any[] }
function wire(o: W = {}) {
	mockDirectus.mockImplementation(async (url: string, opt?: any) => {
		if (opt?.method === 'POST') return { data: { id: 55, date_created: '2026-11-18T03:00:00.000Z' } };
		if (url.startsWith('/items/system_settings')) {
			return { data: [
				{ setting_key: 'project.pakta.enabled', setting_type: 'boolean', setting_value: 'true' },
				{ setting_key: 'project.pakta.route_rules', setting_type: 'json', setting_value: JSON.stringify(o.rules ?? RULES) }
			] };
		}
		if (url.startsWith('/items/process_guidance_flows') || url.startsWith('/items/sop_documents')) return { data: [] };
		if (url.startsWith('/items/gate_definitions?filter[gate_key][_eq]')) return { data: [GATE_DEF] };
		if (url.startsWith('/items/gate_definitions')) return { data: [{ gate_key: 'G_INV_OPNAME_FOTO', nama: 'Foto rak wajib', hint: 'Foto rak sebelum simpan.' }] };
		if (url.startsWith('/items/gate_override_log')) return { data: o.logs ?? [{ id: 90, date_created: NOW, context: 'mode_change', reason: 'Mode G_INV_OPNAME_FOTO (INV): soft → hard · berlaku sejak 2026-11-20' }] };
		if (url.startsWith('/items/sop_read_confirmations')) return { data: [] };
		if (url.startsWith('/items/pakta_persetujuan') && url.includes('keputusan][_eq]=approved')) {
			if (o.approvals instanceof Error) throw o.approvals;
			return { data: o.approvals ?? [] };
		}
		if (url.startsWith('/items/pakta_persetujuan')) return { data: o.objections ?? [] };
		return { data: [] };
	});
}
const posted = () => mockDirectus.mock.calls.filter((c) => c[1]?.method === 'POST').map((c) => JSON.parse(c[1].body));

beforeEach(() => {
	vi.clearAllMocks();
	clearPaktaCache();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	authMock.mockResolvedValue({ user: { uid: 'u' }, karyawan: { id: 42, divisi: 'Produksi' } });
	mockGateMode.mockResolvedValue('hard');
});

describe('Pakta jenis gate — GET /api/ess/pakta-aktif', () => {
	it('perubahan gate yang memperketat → item gate (nama manusia, tanpa tautan baca), mode hard menahan', async () => {
		wire();
		const j = await (await GET(ev('/stock-lapangan/opname'))).json();
		expect(j.decision).toMatchObject({ show: true, blocked: true });
		expect(j.items).toHaveLength(1);
		expect(j.items[0]).toMatchObject({ type: 'gate', gate_key: 'G_INV_OPNAME_FOTO', title: 'Foto rak wajib', version: 90, baca_url: null });
		expect(j.items[0].ringkasan).toContain('wajib dipenuhi');
	});

	it('sudah disetujui (versi sama) → tidak muncul; versi lama → muncul lagi', async () => {
		wire({ approvals: [{ doc_key: 'G_INV_OPNAME_FOTO', doc_version: 90 }] });
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision.show).toBe(false);
		clearPaktaCache();
		wire({ approvals: [{ doc_key: 'G_INV_OPNAME_FOTO', doc_version: 50 }] });
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision.blocked).toBe(true);
	});

	it('rute tanpa gate_keys → log gate TIDAK dibaca (hemat query)', async () => {
		wire({ rules: [{ path_prefix: '/stock-lapangan/opname', match: { keywords: ['opname'] } }] });
		await GET(ev('/stock-lapangan/opname'));
		expect(mockDirectus.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/items/gate_override_log'))).toHaveLength(0);
	});

	it('koleksi pakta_persetujuan belum ada → item gate dilewati (fail-open, tak menahan hal yang tak bisa disetujui) + dilaporkan', async () => {
		wire({ approvals: new Error('FORBIDDEN') });
		const j = await (await GET(ev('/stock-lapangan/opname'))).json();
		expect(j.decision.show).toBe(false);
		expect(j.errors.join(' ')).toContain('pakta_persetujuan');
	});

	it('pelonggaran terbaru / perubahan lama → tidak ada item', async () => {
		wire({ logs: [{ id: 91, date_created: NOW, context: 'mode_change', reason: 'Mode G_INV_OPNAME_FOTO (INV): hard → soft' }, { id: 90, date_created: NOW, context: 'mode_change', reason: 'Mode G_INV_OPNAME_FOTO (INV): soft → hard' }] });
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision.show).toBe(false);
	});

	it('kolom yang diminta ke gate_override_log / gate_definitions ada di skema live', async () => {
		wire();
		await GET(ev('/stock-lapangan/opname'));
		const LIVE: Record<string, Set<string>> = { gate_override_log: new Set(['id', 'date_created', 'context', 'reason']), gate_definitions: new Set(['gate_key', 'nama', 'hint', 'message', 'is_active']) };
		for (const call of mockDirectus.mock.calls.map((c) => String(c[0]))) {
			const coll = /\/items\/([a-z_]+)/.exec(call)![1];
			if (!LIVE[coll]) continue;
			for (const f of (/[?&]fields=([^&]*)/.exec(call)?.[1] ?? '').split(',').filter(Boolean)) expect(LIVE[coll].has(f), `${coll}.${f}`).toBe(true);
		}
	});
});

describe('POST /api/ess/pakta-setuju-gate', () => {
	it('menyimpan persetujuan: versi dari SERVER, tanda tangan memakai date_created tersimpan, signature_hash disimpan', async () => {
		wire();
		const j = await (await SETUJU(post({ gate_key: 'g_inv_opname_foto', version: 1, route: '/stock-lapangan/opname' }))).json();
		expect(j).toMatchObject({ success: true, id: 55, signature: 'KODE-GATE-24-KARAKTER-A', confirmed_at: '2026-11-18T03:00:00.000Z' });
		expect(posted()[0]).toMatchObject({ karyawan_id: 42, doc_type: 'gate', doc_key: 'G_INV_OPNAME_FOTO', doc_version: 90, keputusan: 'approved', ip_address: '10.0.0.1' });
		expect(mockSign).toHaveBeenCalledWith(expect.objectContaining({ karyawanId: 42, docType: 'gate', docKey: 'G_INV_OPNAME_FOTO', version: 90, confirmedAt: '2026-11-18T03:00:00.000Z', ip: '10.0.0.1' }));
		expect(mockPersist).toHaveBeenCalledWith('pakta_persetujuan', 55, 'KODE-GATE-24-KARAKTER-A');
	});

	it('idempoten; gate di luar aturan → 404; tanpa perubahan → 404; koleksi belum ada → 503; fitur mati → 409', async () => {
		wire({ approvals: [{ doc_key: 'G_INV_OPNAME_FOTO', doc_version: 90 }] });
		expect((await (await SETUJU(post({ gate_key: 'G_INV_OPNAME_FOTO' }))).json()).duplicate).toBe(true);
		expect(posted()).toEqual([]);
		clearPaktaCache();
		wire();
		await expect(SETUJU(post({ gate_key: 'G_LAIN' }))).rejects.toMatchObject({ status: 404 });
		await expect(SETUJU(post({}))).rejects.toMatchObject({ status: 400 });
		clearPaktaCache();
		wire({ logs: [] });
		await expect(SETUJU(post({ gate_key: 'G_INV_OPNAME_FOTO' }))).rejects.toMatchObject({ status: 404 });
		clearPaktaCache();
		wire({ approvals: new Error('FORBIDDEN') });
		await expect(SETUJU(post({ gate_key: 'G_INV_OPNAME_FOTO' }))).rejects.toMatchObject({ status: 503 });
	});
});

describe('POST /api/ess/pakta-keberatan — jenis gate', () => {
	const valid = { gate_key: 'G_INV_OPNAME_FOTO', kategori: 'alat_belum_tersedia', alasan: 'Kamera HP tidak tersedia di site', route: '/stock-lapangan/opname' };
	it('mencatat keberatan gate dengan versi dari server', async () => {
		wire();
		const j = await (await KEBERATAN(post(valid))).json();
		expect(j).toMatchObject({ success: true, status: 'menunggu' });
		expect(posted()[0]).toMatchObject({ doc_type: 'gate', doc_key: 'G_INV_OPNAME_FOTO', doc_version: 90, keputusan: 'objection', status: 'menunggu' });
	});
	it('gate di luar aturan → 404; idempoten', async () => {
		wire();
		await expect(KEBERATAN(post({ ...valid, gate_key: 'G_LAIN' }))).rejects.toMatchObject({ status: 404 });
		clearPaktaCache();
		wire({ objections: [{ doc_type: 'gate', doc_key: 'G_INV_OPNAME_FOTO', doc_version: 90, status: 'menunggu' }] });
		expect((await (await KEBERATAN(post(valid))).json()).duplicate).toBe(true);
	});
	it('dispensasi atasan membuka kunci hard untuk item gate', async () => {
		wire({ objections: [{ doc_type: 'gate', doc_key: 'G_INV_OPNAME_FOTO', doc_version: 90, status: 'dispensasi' }] });
		expect((await (await GET(ev('/stock-lapangan/opname'))).json()).decision).toMatchObject({ show: false, blocked: false });
	});
});

import { GET as SAYA } from '../pakta-saya/+server';

describe('GET /api/ess/pakta-saya', () => {
	it('fitur mati → 0 item tanpa query katalog', async () => {
		mockDirectus.mockImplementation(async (url: string) => (url.startsWith('/items/system_settings') ? { data: [{ setting_key: 'project.pakta.enabled', setting_type: 'boolean', setting_value: 'false' }] } : { data: [] }));
		const j = await (await SAYA({} as any)).json();
		expect(j).toMatchObject({ enabled: false, count: 0 });
		expect(mockDirectus.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith('/items/sop_documents'))).toHaveLength(0);
	});

	it('mengumpulkan SOP/Alur + gate terkait aturan rute, terkelompok, dengan rute & tautan baca (gate tanpa tautan)', async () => {
		wire({ rules: [{ path_prefix: '/stock-lapangan/opname', label: 'Stock Opname', match: { gate_keys: ['G_INV_OPNAME_FOTO'], keywords: ['opname'] } }] });
		const base = mockDirectus.getMockImplementation()!;
		mockDirectus.mockImplementation(async (url: string, opt?: any) => {
			if (url.startsWith('/items/sop_documents')) return { data: [{ id: 10, title: 'SOP Stock Opname', sop_code: 'SOP-PRJ-320', department: null, approval_status: 'butuh_sosialisasi', version_seq: 2, target_departments: [], ai_summary: null }, { id: 11, title: 'SOP Kasbon', sop_code: 'SOP-FIN-001', department: null, approval_status: 'butuh_sosialisasi', version_seq: 1, target_departments: [] }] };
			return base(url, opt);
		});
		const j = await (await SAYA({} as any)).json();
		expect(j.count).toBe(2);
		expect(j.prosedur.map((x: any) => x.key)).toEqual(['sop:10']); // SOP kasbon tak terkait aturan rute mana pun
		expect(j.prosedur[0]).toMatchObject({ route: '/stock-lapangan/opname', label: 'Stock Opname', baca_url: '/ess/pelatihan/sop/10' });
		expect(j.gate[0]).toMatchObject({ key: 'gate:G_INV_OPNAME_FOTO', title: 'Foto rak wajib', baca_url: null });
	});

	it('dispensasi → tidak dihitung; kendala menunggu tetap tampil dengan statusnya', async () => {
		wire({ rules: [{ path_prefix: '/stock-lapangan/opname', match: { gate_keys: ['G_INV_OPNAME_FOTO'] } }], objections: [{ doc_type: 'gate', doc_key: 'G_INV_OPNAME_FOTO', doc_version: 90, status: 'menunggu' }] });
		const j = await (await SAYA({} as any)).json();
		expect(j.gate[0].status_kendala).toBe('menunggu');
		clearPaktaCache();
		wire({ rules: [{ path_prefix: '/stock-lapangan/opname', match: { gate_keys: ['G_INV_OPNAME_FOTO'] } }], objections: [{ doc_type: 'gate', doc_key: 'G_INV_OPNAME_FOTO', doc_version: 90, status: 'dispensasi' }] });
		expect((await (await SAYA({} as any)).json()).count).toBe(0);
	});
});
