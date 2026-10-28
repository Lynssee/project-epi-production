// src/lib/utils/printSlipPengajuanLapangan.ts
// Slip RINGKAS pengajuan anggaran untuk lapangan (Fase 2 §5.2 rencana Ekspor Lifecycle): teks-saja, lebar 80mm
// (printer thermal/bluetooth) dan tetap rapi di A4. TANPA gambar TTD, TANPA library PDF, TANPA request jaringan —
// memakai data yang SUDAH dimuat halaman pemanggil, jadi cepat di sinyal lemah.
// BUKAN pengganti Lembar Disposisi resmi (printPengajuanLapangan.ts): slip memuat tulisan itu dan status
// persetujuan saat dicetak, sehingga aman dicetak kapan saja tanpa melewati Gerbang Cetak dokumen resmi.
// MURNI (buildSlipPengajuanHtml) + pembuka jendela sinkron (Aturan #5).

export interface SlipStep {
	label?: string | null;
	status?: string | null;
	actor_name?: string | null;
	date?: string | null;
}

export interface SlipOptions {
	/** Data URI QR verifikasi (opsional; dibuat pemanggil — lihat qrVerifikasi.ts). */
	qrDataUrl?: string | null;
	/** Tautan verifikasi yang dicetak di bawah QR (opsional). */
	verifyUrl?: string | null;
	now?: Date;
}

/** Batas tunggu QR sebelum slip dicetak tanpa QR. */
export const QR_TIMEOUT_MS = 4000;

const esc = (s: unknown) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const rp = (n: unknown) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
const tgl = (d?: string | null) => {
	const t = d ? Date.parse(d) : NaN;
	return Number.isNaN(t) ? '-' : new Date(t).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });
};

const STEP_ICON: Record<string, string> = { disetujui: '[v]', approved: '[v]', ditolak: '[x]', rejected: '[x]', dikembalikan: '[<]', menunggu: '[ ]' };
const stepIcon = (s?: string | null) => STEP_ICON[String(s || '').toLowerCase()] || '[ ]';

export function buildSlipPengajuanHtml(
	pengajuan: any,
	items: any[] | null | undefined,
	steps: SlipStep[] | null | undefined,
	{ qrDataUrl = null, verifyUrl = null, now = new Date() }: SlipOptions = {}
): string {
	const p = pengajuan || {};
	const list = Array.isArray(items) ? items : [];
	const chain = Array.isArray(steps) ? steps : [];
	const proyek = p.fetched_project?.name || (typeof p.project_id === 'object' ? p.project_id?.name : '') || '';
	const itemsTotal = list.reduce((s, it) => s + (Number(it?.harga) || 0) * (Number(it?.quantity) || 0), 0);
	const total = itemsTotal > 0 ? itemsTotal : Number(p.total_amount) || 0;
	const disetujui = Number(p.jumlah_disetujui) || 0;

	const itemRows = list
		.slice(0, 40)
		.map((it) => {
			const qty = Number(it?.quantity) || 0;
			const sub = qty * (Number(it?.harga) || 0);
			return `<div class="it"><div>${esc(it?.deskripsi || '-')}</div><div class="r">${esc(qty)} ${esc(it?.units || '')} × ${esc(rp(it?.harga))} = <b>${esc(rp(sub))}</b></div></div>`;
		})
		.join('');
	const more = list.length > 40 ? `<div class="s">… +${list.length - 40} item lain (lihat dokumen lengkap)</div>` : '';
	const stepRows = chain
		.map((s) => `<div class="st">${esc(stepIcon(s.status))} ${esc(s.label || 'Tahap')} — ${esc(s.actor_name || 'menunggu')}${s.date ? ' · ' + esc(tgl(s.date)) : ''}</div>`)
		.join('');

	return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Slip ${esc(p.nomor_pengajuan || '')}</title>
<style>
@page{size:80mm auto;margin:3mm}
*{box-sizing:border-box}
body{font:9pt/1.3 'Courier New',monospace;margin:0 auto;width:74mm;max-width:100%;color:#000}
h1{font-size:11pt;text-align:center;margin:0 0 1mm}.c{text-align:center}.s{font-size:7.5pt;color:#333}
hr{border:0;border-top:1px dashed #000;margin:2mm 0}.row{display:flex;justify-content:space-between;gap:2mm}
.it{margin:1mm 0}.r{text-align:right}.st{font-size:8pt}.tot{font-size:11pt;font-weight:bold}
.warn{border:1px solid #000;padding:1mm;text-align:center;font-size:7.5pt;margin-top:2mm}
img.qr{display:block;margin:2mm auto 0;width:28mm;height:28mm}
</style></head><body>
<h1>PT. ELTAMA PRIMA INDO</h1>
<div class="c s">SLIP RINGKAS PENGAJUAN ANGGARAN</div>
<hr>
<div class="row"><span>No.</span><b>${esc(p.nomor_pengajuan || '#' + (p.id ?? '-'))}</b></div>
<div class="row"><span>Tanggal</span><span>${esc(tgl(p.date_created))}</span></div>
<div class="row"><span>Pengaju</span><span>${esc(p.nama_pengaju || '-')}</span></div>
<div class="row"><span>Dept</span><span>${esc(p.department || '-')}</span></div>
${proyek ? `<div class="row"><span>Proyek</span><span>${esc(proyek)}</span></div>` : ''}
<div>Tujuan: ${esc(p.tujuan_pengajuan || '-')}</div>
<div class="row"><span>Status</span><b>${esc(p.status || '-')}</b></div>
<hr>
${itemRows || '<div class="s">Rincian item tidak tercatat terstruktur.</div>'}${more}
<hr>
<div class="row tot"><span>TOTAL</span><span>${esc(rp(total))}</span></div>
${disetujui > 0 ? `<div class="row"><span>Disetujui</span><b>${esc(rp(disetujui))}</b></div>` : ''}
${stepRows ? `<hr><div class="s">Persetujuan saat dicetak:</div>${stepRows}` : ''}
${qrDataUrl ? `<img class="qr" src="${esc(qrDataUrl)}" alt="QR verifikasi">${verifyUrl ? `<div class="c s" style="word-break:break-all">${esc(verifyUrl)}</div>` : ''}<div class="c s">Pindai untuk memeriksa keaslian slip</div>` : ''}
<div class="warn">BUKAN dokumen disposisi resmi. Tidak untuk pencairan dana.</div>
<div class="c s" style="margin-top:2mm">Dicetak ${esc(now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }))}</div>
</body></html>`;
}

/** Cetak slip. Jendela dibuka SINKRON (tanpa await sebelumnya); QR (async) menyusul bila disediakan. */
export function printSlipPengajuanLapangan(
	pengajuan: any,
	items: any[] | null | undefined,
	steps: SlipStep[] | null | undefined,
	opts: SlipOptions & { qrProvider?: () => Promise<{ qrDataUrl: string; verifyUrl: string } | null> } = {}
): boolean {
	if (typeof window === 'undefined' || !pengajuan) return false;
	const w = window.open('', '_blank');
	if (!w) return false;
	w.document.write('<html><body style="font-family:Arial;padding:20px;text-align:center;"><p>Menyusun slip…</p></body></html>');
	w.document.close();

	const finish = (extra: SlipOptions = {}) => {
		w.document.open();
		w.document.write(buildSlipPengajuanHtml(pengajuan, items, steps, { ...opts, ...extra }));
		w.document.close();
		w.focus();
		setTimeout(() => w.print(), 250);
	};
	if (opts.qrProvider) {
		// QR pelengkap: lambat (>4 dtk, sinyal lemah) diperlakukan sama dengan gagal → slip tetap tercetak tanpa QR.
		Promise.race([opts.qrProvider(), new Promise<null>((r) => setTimeout(() => r(null), QR_TIMEOUT_MS))])
			.then((qr) => finish(qr || {}))
			.catch((e) => {
				// Slip tetap tercetak tanpa QR — QR bukan syarat isi slip (dan jangan diam-diam: log jelas).
				console.warn('[slipPengajuan] QR verifikasi gagal dibuat, slip dicetak tanpa QR:', e?.message || e);
				finish();
			});
	} else {
		finish();
	}
	return true;
}
