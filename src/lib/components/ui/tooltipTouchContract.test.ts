// Kontrak sumber: titik-titik yang dulu menaruh penjelasan HANYA di atribut title (tak terbaca di layar sentuh) kini memakai <Tooltip>.
// Dipakai untuk halaman rute/komponen yang terlalu berat untuk di-mount di tes (audit sentuh 20 Okt 2026). Tes mount nyata ada di *.dom.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../../', import.meta.url); // src/
const read = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8');

const CASES: Array<{ file: string; oldTitle: string; text: string }> = [
	{ file: 'routes/(app)/ess/petty-cash/+page.svelte', oldTitle: 'title="Umur tiket tertua yang menunggu Anda (hari kerja)"', text: 'Umur tiket tertua yang menunggu Anda' },
	{ file: 'routes/(app)/ess/petty-cash/+page.svelte', oldTitle: 'title="Atasan aslinya sedang cuti', text: 'Atasan aslinya sedang cuti' },
	{ file: 'routes/(app)/ess/petty-cash/+page.svelte', oldTitle: 'title="Sistem mengirim pengingat otomatis', text: 'Sistem mengirim pengingat otomatis' },
	{ file: 'routes/(app)/anggaran/+page.svelte', oldTitle: 'title="Ada syarat WAJIB yang belum terpenuhi', text: 'Ada syarat WAJIB yang belum terpenuhi' },
	{ file: 'lib/components/project/KesiapanHariIniCard.svelte', oldTitle: 'title={STATE_LABEL[s.readiness.state]}', text: 'STATE_LABEL[s.readiness.state]' },
	{ file: 'lib/components/project/WorkshopManpowerSummaryCard.svelte', oldTitle: 'title={r.status}', text: 'text={r.status}' },
	{ file: 'lib/components/project/KebutuhanFaseSheet.svelte', oldTitle: 'title={sl?.text}', text: 'text={sl?.text' },
	{ file: 'lib/components/project/ProjectManpowerAssign.svelte', oldTitle: 'title="Manpower memiliki sanksi aktif', text: 'Manpower memiliki sanksi aktif' },
	{ file: 'lib/components/packing-list/PlLampiranPreviewCard.svelte', oldTitle: 'title="Jumlah lampiran otomatis', text: 'Jumlah lampiran otomatis' },
	{ file: 'lib/components/packing-list/PlLampiranPreviewCard.svelte', oldTitle: 'title="Barang belum tertaut', text: 'Barang belum tertaut' },
	{ file: 'lib/components/packing-list/PlLampiranPreviewCard.svelte', oldTitle: 'title="Pemakaian tercatat', text: 'Pemakaian tercatat' },
	{ file: 'lib/components/project/ProjectPayrollRecap.svelte', oldTitle: 'title="Upah Harian"', text: 'Upah Harian' },
	{ file: 'lib/components/project/ProjectPayrollRecap.svelte', oldTitle: 'title="Kasbon hari ini (Rp)"', text: 'Kasbon hari ini (Rp)' },
	{ file: 'lib/components/leader/LeaderTimeline.svelte', oldTitle: 'title={`${fmt(b.from)} - ${fmt(b.to)}`}', text: 'text={`${fmt(b.from)} - ${fmt(b.to)}`}' },
	{ file: 'lib/components/packing-list/PlanningFieldPanels.svelte', oldTitle: 'title={it.hint}', text: 'text={it.hint}' }
];

describe('title native → <Tooltip> (jalur ketuk)', () => {
	for (const c of CASES) {
		it(`${c.file.split('/').pop()}: "${c.text.slice(0, 40)}" lewat Tooltip, bukan title`, () => {
			const src = read(c.file);
			expect(src.includes(c.oldTitle)).toBe(false);
			expect(src).toContain("import Tooltip from '$lib/components/ui/Tooltip.svelte'");
			// minimal satu kemunculan teks berada dalam atribut tag <Tooltip ...> (jarak <Tooltip → teks pendek, tanpa penutup tag di antaranya)
			let ok = false;
			for (let at = src.indexOf(c.text); at !== -1; at = src.indexOf(c.text, at + 1)) {
				const open = src.lastIndexOf('<Tooltip', at);
				// atribut text= masih berada di dalam tag pembuka <Tooltip …> yang sama (jarak pendek)
				if (open !== -1 && at - open < 200) { ok = true; break; }
			}
			expect(ok).toBe(true);
		});
	}
});
