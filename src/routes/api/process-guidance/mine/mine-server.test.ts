import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn() }));
vi.mock('$lib/server/processGuidanceFlows', () => ({ loadPublishedFlowsForField: vi.fn() }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('$lib/server/processPicContext', async (orig) => ({ ...(await orig<typeof import('$lib/server/processPicContext')>()), loadPicIndex: vi.fn() }));

import { GET } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { loadPicIndex, clearPicIndexCache } from '$lib/server/processPicContext';
import { directusServerJson } from '$lib/server/directus';
import { buildPosisiIndex } from '$lib/utils/processPicResolver';

const directus = directusServerJson as unknown as ReturnType<typeof vi.fn>;
const auth = authenticateEss as unknown as ReturnType<typeof vi.fn>;
const loadFlows = loadPublishedFlowsForField as unknown as ReturnType<typeof vi.fn>;
const loadIdx = loadPicIndex as unknown as ReturnType<typeof vi.fn>;
const call = () => (GET as any)({});

const FLOWS = [
	{ id: 'f1', title: 'Alur 1', description: '', lanes: [{ key: 'a', label: 'ADMIN' }], edges: [], nodes: [{ id: 'n1', type: 'task', lane: 'a', col: 0, label: 'Cek', desc: '', pic: 'Project Leader', sla_hours: 8 }] }
];
const INDEX = buildPosisiIndex([{ id: 30, nama_posisi: 'PROJECT LEADER' }]);

beforeEach(() => {
	vi.clearAllMocks();
	auth.mockResolvedValue({ karyawan: { id: 1, jabatan_id: 30, posisi: 'PROJECT LEADER' } });
	loadFlows.mockResolvedValue(FLOWS);
	loadIdx.mockResolvedValue(INDEX);
});

describe('GET /api/process-guidance/mine', () => {
	it('wajib login: auth gagal → error dilempar dan tidak ada pembacaan data', async () => {
		auth.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
		await expect(call()).rejects.toMatchObject({ status: 401 });
		expect(loadFlows).not.toHaveBeenCalled();
	});

	it('jabatan terhubung → daftar tugas milik jabatan itu saja', async () => {
		const body = await (await call()).json();
		expect(body).toMatchObject({ success: true, source: 'directus', posisi: { id: 30, nama: 'PROJECT LEADER', via: 'jabatan_id' }, flows_total: 1 });
		expect(body.tasks).toEqual([expect.objectContaining({ flow_id: 'f1', node_id: 'n1', label: 'Cek', sla_hours: 8, lane_label: 'ADMIN' })]);
	});

	it('Kontak Approver: tugas dengan serah-terima → kontak jabatan penerima (nama + WA), tanpa diri sendiri', async () => {
		const idx = buildPosisiIndex([{ id: 30, nama_posisi: 'PROJECT LEADER' }, { id: 58, nama_posisi: 'PROJECT MANAGER' }]);
		loadIdx.mockResolvedValue(idx);
		loadFlows.mockResolvedValue([
			{ ...FLOWS[0], nodes: [...FLOWS[0].nodes, { id: 'n2', type: 'task', lane: 'a', col: 1, label: 'Setujui', desc: '', pic: 'Project Manager' }], edges: [{ from: 'n1', to: 'n2' }] }
		]);
		directus.mockResolvedValue({
			data: [
				{ id: 1, nama_karyawan: 'Saya', no_hp: '0811', jabatan_id: 58, status_kerja: 'Aktif' },
				{ id: 9, nama_karyawan: 'Pak PM', no_hp: '0812 3456 7890', jabatan_id: 58, status_kerja: 'Aktif' },
				{ id: 8, nama_karyawan: 'Orang Lain', no_hp: '0899', jabatan_id: 99, status_kerja: 'Aktif' }
			]
		});
		clearPicIndexCache();
		const body = await (await call()).json();
		expect(body.tasks[0].handoff_to).toEqual([58]);
		expect(body.contacts).toEqual({ 58: { nama: 'PROJECT MANAGER', total: 1, people: [{ id: 9, nama: 'Pak PM', wa: '6281234567890' }] } });
		expect(JSON.stringify(body)).not.toContain('Orang Lain');
	});

	it('kontak gagal dimuat → tugas tetap tampil (fail-soft) + contacts_error, detail galat tidak bocor', async () => {
		const idx = buildPosisiIndex([{ id: 30, nama_posisi: 'PROJECT LEADER' }, { id: 58, nama_posisi: 'PROJECT MANAGER' }]);
		loadIdx.mockResolvedValue(idx);
		loadFlows.mockResolvedValue([
			{ ...FLOWS[0], nodes: [...FLOWS[0].nodes, { id: 'n2', type: 'task', lane: 'a', col: 1, label: 'Setujui', desc: '', pic: 'Project Manager' }], edges: [{ from: 'n1', to: 'n2' }] }
		]);
		directus.mockRejectedValue(new Error('403 rahasia'));
		clearPicIndexCache();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const body = await (await call()).json();
		expect(body).toMatchObject({ source: 'directus', contacts: {}, contacts_error: expect.any(String) });
		expect(body.tasks).toHaveLength(1);
		expect(JSON.stringify(body)).not.toContain('rahasia');
		warn.mockRestore();
	});

	it('tanpa serah-terima → karyawan tidak diquery sama sekali (hemat API)', async () => {
		clearPicIndexCache();
		await call();
		expect(directus).not.toHaveBeenCalled();
	});

	it('jabatan tidak bisa ditentukan → tasks kosong + alasan yang bisa ditindaklanjuti', async () => {
		auth.mockResolvedValue({ karyawan: { id: 2, jabatan_id: null, posisi: 'Entah Apa' } });
		const body = await (await call()).json();
		expect(body).toMatchObject({ success: true, source: 'directus', posisi: null, tasks: [] });
		expect(body.reason).toMatch(/HRD/);
	});

	it('Directus gagal → fallback tanpa error layar (200), tidak membocorkan detail galat', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		loadIdx.mockRejectedValue(new Error('403 rahasia'));
		const res = await call();
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ success: true, source: 'fallback', posisi: null, tasks: [] });
		expect(JSON.stringify(body)).not.toContain('rahasia');
		warn.mockRestore();
	});
});
