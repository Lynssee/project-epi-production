// @vitest-environment jsdom
// FieldSafeSpend — daftar item tertahan + tombol "Ingatkan approver" (cooldown, gagal teknis, fitur mati).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ budget: vi.fn(), items: vi.fn(), ping: vi.fn() }));
vi.mock('$lib/services/projectFinancePct', () => ({
	fetchFieldBudgetPct: (...a: any[]) => svc.budget(...a),
	fetchFieldPendingItems: (...a: any[]) => svc.items(...a),
	pingApprover: (...a: any[]) => svc.ping(...a)
}));
vi.mock('$lib/services/projectSettings', () => ({
	loadProjectSettings: () => Promise.resolve(),
	getProjectSetting: () => true
}));

import FieldSafeSpend from './FieldSafeSpend.svelte';

let box: HTMLElement | null, inst: any;
const q = (id: string) => box!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };

const pagu = {
	status: 'ok', level: 'safe', used_pct: 40, actual_pct: 40, commitment_pct: 10, remaining_pct: 60,
	thresholds: { warnPct: 80, dangerPct: 100 }, note: '', warnings: [],
	unrealized: { pct: 30, birokrasi_pct: 20, pipeline_pct: 10, item_count: 2, names_enabled: true },
	safe_spend: { state: 'held', projected_pct: 70 }
};
const item = (o: any) => ({
	id: 'x', channel: 'pa_anggaran', channel_label: 'Pengajuan Anggaran', kind: 'birokrasi', nomor_dokumen: 'PA-1', judul: 'Material',
	status_label: 'Menunggu Approval', tahap: null, approver: 'Pak GM', age_hours: 72, overdue: false, overdue_hours: 0, qty_label: null, unpriced: false,
	pingable: true, ref_id: 5, ...o
});
const itemsPayload = { enabled: true, total: 2, truncated: false, items: [item({ id: 'pa_5', ref_id: 5 }), item({ id: 'pl_1', channel: 'packing_list', channel_label: 'Packing List', nomor_dokumen: 'PL-1', pingable: false, ref_id: null })] };

async function openList() {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(FieldSafeSpend, { target: box, props: { projectId: 7 } });
	await tick();
	q('field-pending-toggle')!.click();
	await tick();
}
beforeEach(() => {
	svc.budget.mockReset().mockResolvedValue(pagu);
	svc.items.mockReset().mockResolvedValue(itemsPayload);
	svc.ping.mockReset();
});
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('FieldSafeSpend — tombol Ingatkan approver', () => {
	it('tombol hanya pada item pingable (PA Pending), tidak pada Packing List', async () => {
		await openList();
		expect(q('field-ping-5')).not.toBeNull();
		expect(box!.querySelectorAll('[data-testid^="field-ping-"]:not([data-testid^="field-ping-msg-"])')).toHaveLength(1);
	});

	it('klik → memanggil pingApprover(proyek, id PA), tampil sukses, tombol terkunci', async () => {
		svc.ping.mockResolvedValue({ sent: true, recipients: 2 });
		await openList();
		q('field-ping-5')!.click();
		await tick();
		expect(svc.ping).toHaveBeenCalledWith(7, 5);
		expect(q('field-ping-msg-5')!.textContent).toContain('terkirim ke 2 approver');
		expect((q('field-ping-5') as HTMLButtonElement).disabled).toBe(true);
	});

	it('cooldown → pesan sisa waktu, tombol terkunci', async () => {
		svc.ping.mockResolvedValue({ sent: false, reason: 'cooldown', retry_after_minutes: 300 });
		await openList();
		q('field-ping-5')!.click();
		await tick();
		expect(q('field-ping-msg-5')!.textContent).toContain('5 jam');
		expect((q('field-ping-5') as HTMLButtonElement).disabled).toBe(true);
	});

	it('gagal teknis → pesan error (role alert) dan tombol BOLEH dicoba lagi', async () => {
		svc.ping.mockResolvedValue({ sent: false, error: 'Tidak dapat menghubungi admin saat ini.' });
		await openList();
		q('field-ping-5')!.click();
		await tick();
		expect(q('field-ping-msg-5')!.getAttribute('role')).toBe('alert');
		expect((q('field-ping-5') as HTMLButtonElement).disabled).toBe(false);
	});

	it('klik beruntun saat mengirim tidak mengirim ganda', async () => {
		let release: (v: any) => void = () => {};
		svc.ping.mockReturnValue(new Promise((r) => { release = r; }));
		await openList();
		q('field-ping-5')!.click();
		q('field-ping-5')!.click();
		await tick();
		expect(svc.ping).toHaveBeenCalledTimes(1);
		release({ sent: true, recipients: 1 });
		await tick();
	});

	it('item tanpa pingable (fitur dimatikan server) → tidak ada tombol', async () => {
		svc.items.mockResolvedValue({ ...itemsPayload, items: itemsPayload.items.map((i: any) => ({ ...i, pingable: false })) });
		await openList();
		expect(q('field-ping-5')).toBeNull();
	});
});
