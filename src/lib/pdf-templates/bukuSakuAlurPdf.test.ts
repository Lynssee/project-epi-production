import { describe, it, expect } from 'vitest';
import { buildBukuSakuRows, buildBukuSakuHtml, isControlled, orderedSteps } from './bukuSakuAlurPdf';
import type { ProcessFlow } from '$lib/data/processGuidance';

const flow = (over: Partial<ProcessFlow> = {}): ProcessFlow =>
	({
		id: 'alur_a',
		title: 'Alur <Uji> & Co',
		description: '',
		lanes: [{ key: 'l1', label: 'GUDANG' }],
		nodes: [
			{ id: 'e', type: 'end', lane: 'l1', col: 3, label: 'Selesai', desc: '' },
			{ id: 'b', type: 'decision', lane: 'l1', col: 2, label: 'Lengkap?', desc: '' },
			{ id: 's', type: 'start', lane: 'l1', col: 0, label: 'Mulai', desc: '' },
			{
				id: 'a', type: 'task', lane: 'l1', col: 1, label: 'Terima <b>Barang</b>', desc: 'Cek fisik', pic: 'Staf Gudang', sla_hours: 4,
				checklist: ['Cek surat jalan', ''], blockers: ['SJ hilang'], gates: [{ key: 'G_X', modul: 'm', documentType: 'd' }],
				actions: [{ label: 'Terima Barang', href: '/inventory/terima' }]
			}
		],
		edges: [{ from: 'b', to: 'e', label: 'Ya' }, { from: 'b', to: 'a', label: 'Tidak' }, { from: 'a', to: 'b' }],
		approval_status: 'published',
		sop_code: 'SOP-GDG-001',
		...over
	}) as ProcessFlow;

describe('buildBukuSakuRows', () => {
	it('hanya task/decision, urut kolom, lane diterjemahkan, item kosong dibuang', () => {
		const rows = buildBukuSakuRows(flow());
		expect(rows.map((r) => [r.no, r.label, r.lane])).toEqual([[1, 'Terima <b>Barang</b>', 'GUDANG'], [2, 'Lengkap?', 'GUDANG']]);
		expect(rows[0]).toMatchObject({ pic: 'Staf Gudang', slaHours: 4, checklist: ['Cek surat jalan'], blockers: ['SJ hilang'], gates: ['G_X'] });
		expect(rows[0].fieldActions).toEqual([{ label: 'Terima Barang', href: '/inventory/terima' }]);
		expect(rows[1].branches).toEqual([{ label: 'Ya', to: 'Selesai' }, { label: 'Tidak', to: 'Terima <b>Barang</b>' }]);
		expect(rows[1].slaHours).toBeNull();
	});
	it('alur kosong/aneh tidak crash', () => {
		expect(buildBukuSakuRows({ ...flow(), nodes: [] })).toEqual([]);
		expect(orderedSteps({ nodes: undefined as any })).toEqual([]);
	});
});

describe('buildBukuSakuHtml', () => {
	it('HTML di-escape (judul & langkah), checklist berkotak, SLA tercatat dihitung nyata', () => {
		const html = buildBukuSakuHtml({ flow: flow(), dicetakOleh: 'Budi <x>' });
		expect(html).toContain('Alur &lt;Uji&gt; &amp; Co');
		expect(html).toContain('Terima &lt;b&gt;Barang&lt;/b&gt;');
		expect(html).not.toContain('<b>Barang</b>');
		expect(html).toContain('☐ Cek surat jalan');
		expect(html).toContain('SLA tercatat:</b> 1/2');
		expect(html).toContain('oleh Budi &lt;x&gt;');
		expect(html).toContain('SOP-GDG-001');
	});
	it('terbit → banner salinan lapangan tanpa watermark; belum disetujui → DRAFT + BELUM TERKENDALI', () => {
		const ok = buildBukuSakuHtml({ flow: flow() });
		expect(ok).toContain('Salinan lapangan dari versi TERBIT');
		expect(ok).not.toContain('class="wm"');
		const draft = buildBukuSakuHtml({ flow: flow({ approval_status: 'draft' }) });
		expect(draft).toContain('BELUM TERKENDALI');
		expect(draft).toContain('class="wm">DRAFT');
		expect(isControlled(flow({ approval_status: undefined }))).toBe(false);
	});
	it('data kosong ditulis apa adanya (tanpa karangan)', () => {
		const f = flow({ sop_code: undefined, nodes: [{ id: 'x', type: 'task', lane: 'l1', col: 0, label: 'Kosong', desc: '' } as any] });
		const html = buildBukuSakuHtml({ flow: f });
		expect(html).toContain('PIC belum diisi');
		expect(html).toContain('Checklist belum diisi');
		expect(html).toContain('tidak tercatat');
		expect(html).toContain('SLA tercatat:</b> 0/1');
	});
	it('alur tanpa langkah → catatan, bukan tabel kosong', () => {
		expect(buildBukuSakuHtml({ flow: flow({ nodes: [] }) })).toContain('belum memiliki langkah kerja');
	});
	it('detail gate: terbaca → mode & hint; tidak terbaca → catatan jujur (kunci tetap tampil)', () => {
		const withGate = buildBukuSakuHtml({
			flow: flow(),
			gateInfo: { available: true, gates: { G_X: { mode: 'hard', nama: 'Gate X', message: 'Pesan', hint: 'Lengkapi SJ', owner_role: null, bypass: null, checklist: [] } } }
		});
		expect(withGate).toContain('WAJIB (blokir)');
		expect(withGate).toContain('Lengkapi SJ');
		const none = buildBukuSakuHtml({ flow: flow(), gateInfo: { available: false, gates: {}, reason: 'admin down' } });
		expect(none).toContain('tidak terbaca saat dicetak: admin down');
		expect(none).toContain('G_X');
		expect(buildBukuSakuHtml({ flow: flow(), gateInfo: null })).toContain('tidak terbaca saat dicetak');
	});
});
