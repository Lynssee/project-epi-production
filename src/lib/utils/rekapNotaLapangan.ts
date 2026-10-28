// src/lib/utils/rekapNotaLapangan.ts
// "Rekap Nota Lapangan" (Fase 1 §5.2 rencana Ekspor Lifecycle): ringkasan nota/biaya yang SAYA catat di lapangan
// (BBM/tol/parkir/lain, mode talangan & dana proyek) per periode — supaya leader punya total sendiri sebelum
// menyerahkan nota ke admin. MURNI & null-safe (Aturan #7); tidak ada fetch/DOM kecuali printRekapNotaLapangan.

export type RekapRow = {
	id: number | string;
	waktu: string;
	jenis: string;
	nominal: number;
	mode: string;
	catatan?: string | null;
	project_id?: number | null;
	project_name?: string | null;
	approval_status?: string | null;
	has_struk?: boolean;
};

export type RekapPreset = 'hari-ini' | '7-hari' | 'bulan-ini' | 'bulan-lalu';

export const REKAP_PRESETS: { id: RekapPreset; label: string }[] = [
	{ id: 'hari-ini', label: 'Hari ini' },
	{ id: '7-hari', label: '7 hari' },
	{ id: 'bulan-ini', label: 'Bulan ini' },
	{ id: 'bulan-lalu', label: 'Bulan lalu' }
];

/** Rentang maksimum (hari) agar query server tetap ringan. */
export const MAX_RANGE_DAYS = 93;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** YYYY-MM-DD valid (tanggal kalender nyata). */
export function isValidYmd(s: unknown): s is string {
	if (typeof s !== 'string' || !YMD.test(s)) return false;
	const [y, m, d] = s.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function addDays(s: string, n: number): string {
	const [y, m, d] = s.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d + n));
	return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(dari: string, sampai: string): number {
	const a = Date.parse(dari + 'T00:00:00Z');
	const b = Date.parse(sampai + 'T00:00:00Z');
	return Math.round((b - a) / 86400000) + 1;
}

/** @param today YYYY-MM-DD WIB */
export function rangeForPreset(preset: RekapPreset, today: string): { dari: string; sampai: string } {
	const [y, m] = today.split('-').map(Number);
	if (preset === 'hari-ini') return { dari: today, sampai: today };
	if (preset === '7-hari') return { dari: addDays(today, -6), sampai: today };
	if (preset === 'bulan-lalu') {
		const py = m === 1 ? y - 1 : y;
		const pm = m === 1 ? 12 : m - 1;
		const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
		return { dari: ymd(py, pm, 1), sampai: ymd(py, pm, last) };
	}
	return { dari: ymd(y, m, 1), sampai: today }; // bulan-ini
}

export function validateRange(dari: unknown, sampai: unknown): { ok: true } | { ok: false; reason: string } {
	if (!isValidYmd(dari) || !isValidYmd(sampai)) return { ok: false, reason: 'Format tanggal harus YYYY-MM-DD.' };
	if (dari > sampai) return { ok: false, reason: 'Tanggal awal tidak boleh setelah tanggal akhir.' };
	if (daysBetween(dari, sampai) > MAX_RANGE_DAYS) return { ok: false, reason: `Rentang maksimal ${MAX_RANGE_DAYS} hari.` };
	return { ok: true };
}

export const JENIS_LABEL: Record<string, string> = { bbm: 'BBM', tol: 'Tol', parkir: 'Parkir', lain: 'Lain-lain' };
export const MODE_LABEL: Record<string, string> = { talangan: 'Talangan (uang pribadi)', proyek: 'Dana Proyek' };
export const jenisLabel = (j: string) => JENIS_LABEL[j] || j || '-';
export const modeLabel = (m: string) => MODE_LABEL[m] || m || '-';

export type Ringkasan = {
	total: number;
	count: number;
	perJenis: { jenis: string; total: number; count: number }[];
	perMode: { mode: string; total: number; count: number }[];
	tanpaStruk: number;
	menunggu: number;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function aggregateRekap(rows: RekapRow[] | null | undefined): Ringkasan {
	const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
	const by = (key: 'jenis' | 'mode') => {
		const m = new Map<string, { total: number; count: number }>();
		for (const r of list) {
			const k = (r[key] as string) || '-';
			const cur = m.get(k) || { total: 0, count: 0 };
			cur.total += num(r.nominal);
			cur.count += 1;
			m.set(k, cur);
		}
		return [...m.entries()].map(([k, v]) => ({ [key]: k, ...v })).sort((a: any, b: any) => b.total - a.total);
	};
	return {
		total: list.reduce((s, r) => s + num(r.nominal), 0),
		count: list.length,
		perJenis: by('jenis') as Ringkasan['perJenis'],
		perMode: by('mode') as Ringkasan['perMode'],
		tanpaStruk: list.filter((r) => !r.has_struk).length,
		menunggu: list.filter((r) => r.approval_status === 'menunggu').length
	};
}

const esc = (s: unknown) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const rp = (n: number) => 'Rp ' + Math.round(num(n)).toLocaleString('id-ID');
const tgl = (iso: string) => {
	const t = Date.parse(iso);
	return Number.isNaN(t) ? '-' : new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
};
const jam = (iso: string) => {
	const t = Date.parse(iso);
	return Number.isNaN(t) ? '' : new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
};

/** HTML cetak ringan (A4, tanpa gambar/library) — hemat koneksi lapangan. Semua nilai di-escape. */
export function buildRekapPrintHtml(opts: {
	nama: string;
	dari: string;
	sampai: string;
	rows: RekapRow[];
	now?: Date;
}): string {
	const { nama, dari, sampai, rows, now = new Date() } = opts;
	const list = Array.isArray(rows) ? rows : [];
	const r = aggregateRekap(list);
	const body = list
		.map(
			(x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(tgl(x.waktu))}<div class="s">${esc(jam(x.waktu))}</div></td><td>${esc(jenisLabel(x.jenis))}</td><td>${esc(modeLabel(x.mode))}</td><td>${esc(x.project_name || '-')}</td><td>${esc(x.catatan || '-')}</td><td class="c">${x.has_struk ? '✓' : '✗'}</td><td class="n">${esc(rp(x.nominal))}</td></tr>`
		)
		.join('');
	const jenisRows = r.perJenis.map((j) => `<tr><td>${esc(jenisLabel(j.jenis))}</td><td class="c">${j.count}</td><td class="n">${esc(rp(j.total))}</td></tr>`).join('');
	return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Rekap Nota Lapangan</title>
<style>
@page{size:A4 portrait;margin:12mm}
*{box-sizing:border-box}body{font:9.5pt/1.3 Arial,sans-serif;margin:0;color:#000}
h1{font-size:13pt;margin:0 0 2px}.sub{color:#444;font-size:9pt;margin:0 0 8px}
table{width:100%;border-collapse:collapse;margin-bottom:8px}th,td{border:1px solid #bbb;padding:3px 5px;font-size:8.5pt;text-align:left;vertical-align:top}
th{background:#e2e8f0}.n{text-align:right;white-space:nowrap}.c{text-align:center}.s{color:#666;font-size:7.5pt}
.tot td{font-weight:bold;background:#fef3c7}.warn{color:#b45309;font-size:8.5pt}
.sigs{display:flex;gap:4mm;margin-top:8mm;break-inside:avoid}.sig{flex:1;text-align:center}.sb{height:16mm}.sn{border-top:.75pt solid #000;font-size:7.5pt;padding-top:1mm}
.f{margin-top:5mm;color:#777;font-size:8pt}
</style></head><body>
<h1>REKAP NOTA LAPANGAN</h1>
<p class="sub">${esc(nama)} · ${esc(tgl(dari + 'T00:00:00+07:00'))} s/d ${esc(tgl(sampai + 'T00:00:00+07:00'))} · ${r.count} nota</p>
<table><thead><tr><th>Jenis</th><th class="c">Jumlah</th><th class="n">Total</th></tr></thead><tbody>${jenisRows || '<tr><td colspan="3" class="c">-</td></tr>'}</tbody>
<tfoot><tr class="tot"><td>TOTAL</td><td class="c">${r.count}</td><td class="n">${esc(rp(r.total))}</td></tr></tfoot></table>
${r.tanpaStruk > 0 ? `<p class="warn">⚠ ${r.tanpaStruk} nota belum ada foto struk — lengkapi sebelum diserahkan.</p>` : ''}
<table><thead><tr><th class="c">No</th><th>Waktu</th><th>Jenis</th><th>Sumber Dana</th><th>Proyek</th><th>Catatan</th><th class="c">Struk</th><th class="n">Nominal</th></tr></thead>
<tbody>${body || '<tr><td colspan="8" class="c">Tidak ada nota pada periode ini.</td></tr>'}</tbody></table>
<div class="sigs"><div class="sig"><div class="sb"></div><div class="sn">Dibuat oleh (${esc(nama)})</div></div><div class="sig"><div class="sb"></div><div class="sn">Diperiksa (Admin/Finance)</div></div></div>
<div class="f">Dicetak ${esc(now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }))} — Dashboard Lapangan SI-TAMA</div>
</body></html>`;
}

/** Cetak ke jendela baru. WAJIB dipanggil langsung dari handler klik (window.open sinkron — Aturan #5). */
export function printRekapNotaLapangan(opts: Parameters<typeof buildRekapPrintHtml>[0]): boolean {
	if (typeof window === 'undefined') return false;
	const w = window.open('', '_blank');
	if (!w) return false;
	w.document.write(buildRekapPrintHtml(opts));
	w.document.close();
	w.focus();
	setTimeout(() => w.print(), 250);
	return true;
}
