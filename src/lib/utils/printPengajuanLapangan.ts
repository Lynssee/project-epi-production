// src/lib/utils/printPengajuanLapangan.ts
// Cetak "Lembar Disposisi & Pengajuan Resmi" pengajuan_anggaran dari Dashboard Lapangan
// — keluaran 100% sama dengan Admin (erp-epi: printPengajuanAnggaran.js). Field-field
// yang dipakai di sini identik karena kedua repo berbagi koleksi Directus yang sama
// (pengajuan_anggaran / items_pengajuan_anggaran), jadi tidak ada mapping/transform.
//
// Beda dari versi Admin: pengajuan/items/approvalTimeline SUDAH dimuat di halaman
// pemanggil (anggaran/[id]/+page.svelte lewat getPengajuanById/getPengajuanItems/
// realChain) — fungsi ini menerima itu langsung sebagai parameter, TIDAK fetch ulang,
// supaya hemat API (aturan proyek: minimalkan call yang tidak perlu).

import { secureDirectusFetch } from '$lib/services/secureDirectus';

interface ApprovalStep {
	step_order?: number;
	label?: string | null;
	status?: string | null;
	actor_name?: string | null;
	date?: string | null;
	ttd_file?: string | null;
	hash_keputusan?: string | null;
}

interface ApprovalTimeline {
	status?: string | null;
	steps?: ApprovalStep[];
}

async function getFileDataUri(fileId: string | null | undefined): Promise<string> {
	if (!fileId) return '';
	try {
		const res = await secureDirectusFetch(`/assets/${fileId}`);
		if (!res.ok) return '';
		const blob = await res.blob();
		return await new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => resolve('');
			reader.readAsDataURL(blob);
		});
	} catch {
		return '';
	}
}

function formatDatePrint(dateString: string | null | undefined): string {
	if (!dateString) return '-';
	return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatDateTimePrint(dateString: string | null | undefined): string {
	if (!dateString) return '-';
	return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
		+ ' ' + new Date(dateString).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatCurrencyPrint(amount: number | string | null | undefined): string {
	return Math.round(Number(amount) || 0).toLocaleString('id-ID');
}

function buildItemsTable(items: any[]): string {
	if (!items || items.length === 0) {
		return `<tr><td colspan="6" style="text-align:center;padding:8px;color:#999;font-style:italic;border:1px solid #ccc;">Tidak ada item</td></tr>`;
	}
	return items.map((item, idx) => {
		const qty = parseFloat(item.quantity) || 0;
		const harga = parseFloat(item.harga) || 0;
		const total = qty * harga;
		return `
			<tr>
				<td style="text-align:center;border:1px solid #ccc;padding:4px 6px;font-size:8.5pt;">${idx + 1}</td>
				<td style="text-align:left;border:1px solid #ccc;padding:4px 6px;font-size:8.5pt;">${item.deskripsi || '-'}</td>
				<td style="text-align:center;border:1px solid #ccc;padding:4px 6px;font-size:8.5pt;">${qty} ${item.units || ''}</td>
				<td style="text-align:right;border:1px solid #ccc;padding:4px 6px;font-size:8.5pt;">Rp ${formatCurrencyPrint(harga)}</td>
				<td style="text-align:right;border:1px solid #ccc;padding:4px 6px;font-size:8.5pt;font-weight:600;">Rp ${formatCurrencyPrint(total)}</td>
				<td style="text-align:left;border:1px solid #ccc;padding:4px 6px;font-size:8pt;color:#555;">${item.vendor_name || '-'}</td>
			</tr>
		`;
	}).join('');
}

async function buildSignatureSlot(
	label: string,
	signatureFileId: string | null | undefined,
	approvedBy: string | null | undefined,
	approvedDate: string | null | undefined,
	slotWidth = '23%',
	hashKeputusan: string | null | undefined = null
): Promise<string> {
	const dataUri = signatureFileId ? await getFileDataUri(signatureFileId) : '';
	const sigImg = dataUri
		? `<div style="height:85px;display:flex;align-items:center;justify-content:center;padding:0 4px;margin:4px 0;">
			<img src="${dataUri}" style="max-width:100%;max-height:85px;width:auto;height:auto;object-fit:contain;display:block;" />
		</div>`
		: `<div style="height:85px;margin:4px 0;"></div>`;
	const nameText = approvedBy ? `<div style="font-size:7.5pt;color:#333;margin-top:2px;">${approvedBy}</div>` : '';
	const dateText = dataUri && approvedDate
		? `<div style="font-size:6.5pt;color:#15803d;font-weight:600;margin-top:1px;">✓ TTD Digital ERP &middot; ${formatDateTimePrint(approvedDate)}</div>`
		: approvedDate
		? `<div style="font-size:7pt;color:#888;">${formatDatePrint(approvedDate)}</div>`
		: '';
	const hashText = hashKeputusan
		? `<div style="font-size:6pt;color:#94a3b8;margin-top:1px;font-family:monospace;" title="${hashKeputusan}">#${String(hashKeputusan).slice(0, 12)}</div>`
		: '';

	return `
		<div style="width:${slotWidth};text-align:center;">
			<div style="font-size:8pt;font-weight:bold;margin-bottom:4px;">${label}</div>
			${sigImg}
			<div style="border-top:1px solid #000;padding-top:3px;font-size:8pt;">
				${nameText}
				${dateText}
				${hashText}
			</div>
		</div>
	`;
}

/** Kotak paraf/TTD FISIK — selalu kosong, untuk diisi tangan Finance/Kasir di kertas. */
function buildPhysicalSignBox(label: string, subLabel = '', lines = 0): string {
	const notesLines = lines > 0
		? Array.from({ length: lines }).map(() => '<div style="border-bottom:1px dotted #999;height:16px;"></div>').join('')
		: '';
	return `
		<div style="flex:1;border:1px solid #cbd5e1;border-radius:6px;padding:8px 10px;">
			<div style="font-size:8pt;font-weight:bold;">${label}</div>
			${subLabel ? `<div style="font-size:7pt;color:#64748b;margin-bottom:4px;">${subLabel}</div>` : ''}
			${notesLines}
			<div style="height:60px;"></div>
			<div style="border-top:1px solid #000;padding-top:3px;font-size:7.5pt;color:#888;">Nama &amp; Tanggal</div>
		</div>
	`;
}

/**
 * Bangun konten dokumen (header, ringkasan, tabel item, TTD digital, kotak fisik) TANPA
 * pembungkus <html>/<head>/<script> — dipakai bareng oleh printPengajuanLapangan()
 * (dibungkus dokumen A4 penuh utk window print) dan downloadPengajuanLapanganPdf()
 * (disuntik ke <div> tersembunyi utk ditangkap html2pdf), supaya markup satu sumber.
 */
/** QR verifikasi keaslian dokumen (opsional) — lihat $lib/utils/qrVerifikasi.ts. */
export interface QrVerifikasiPrint {
	qrDataUrl: string;
	verifyUrl: string;
}

export async function buildPengajuanLapanganBodyHtml(pengajuan: any, items: any[], approvalTimeline: ApprovalTimeline | null, qr: QrVerifikasiPrint | null = null): Promise<string> {
	const totalAmount = (items || []).reduce((sum, item) => sum + ((parseFloat(item.harga) || 0) * (parseFloat(item.quantity) || 0)), 0);
	const urgencyLabel = ({
		'Very Urgent': '🔴 Sangat Mendesak',
		'Urgent': '🟠 Mendesak',
		'Normal': '🟢 Normal'
	} as Record<string, string>)[pengajuan.urgency] || pengajuan.urgency || '-';

	const engineSteps = (approvalTimeline?.steps || []).filter((s) => String(s.status || '').toLowerCase() === 'disetujui');
	const totalSlots = engineSteps.length > 0 ? engineSteps.length + 1 : 1;
	const slotWidth = totalSlots > 4 ? `${Math.floor(95 / totalSlots)}%` : '23%';

	const signatureSlots = (await Promise.all([
		buildSignatureSlot('Pengaju', pengajuan.pengaju_signature, pengajuan.nama_pengaju, pengajuan.date_created, slotWidth),
		...engineSteps.map((s) => buildSignatureSlot(s.label || `Tahap ${s.step_order}`, s.ttd_file, s.actor_name, s.date, slotWidth, s.hash_keputusan))
	])).join('');

	const isFinalized = ['Completed', 'Selesai', 'Dibukukan', 'Rejected'].includes(pengajuan.status);
	const physicalFinanceSection = isFinalized ? '' : `
		<div style="margin-top:20px;padding-top:12px;border-top:2px dashed #94a3b8;page-break-inside:avoid;">
			<div style="font-size:8.5pt;font-weight:bold;color:#334155;margin-bottom:8px;">
				✍️ Verifikasi &amp; Otorisasi Fisik Meja Keuangan <span style="font-weight:normal;color:#94a3b8;">(diisi tangan setelah dokumen ini diterima Finance)</span>
			</div>
			<div style="display:flex;gap:10px;">
				${buildPhysicalSignBox('Paraf Verifikator Keuangan', 'Kelengkapan &amp; kesesuaian dokumen')}
				${buildPhysicalSignBox('Catatan Fisik Kuitansi', 'No. kuitansi / bukti fisik terlampir', 2)}
				${buildPhysicalSignBox('Otorisasi Pencairan Kasir', 'Dana dicairkan sesuai nominal disetujui')}
			</div>
		</div>
	`;

	return `
		<div style="display:flex;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px;">
			<div style="width:55px;margin-right:12px;">
				<img src="/src/lib/assets/logo-eltama.png" alt="Logo" style="width:48px;height:48px;object-fit:contain;border-radius:50%;" onerror="this.style.display='none'" />
			</div>
			<div style="flex:1;">
				<div style="font-size:13pt;font-weight:bold;margin-bottom:2px;">PT. ELTAMA PRIMA INDO</div>
				<div style="font-size:7.5pt;line-height:1.2;color:#333;">
					<div>Jl. Raya Parpostel Gang Nangka RT. 02 RW. 03</div>
					<div>No 88 Kel. Bojong Kulur Kec. Gunung Putri, Bogor, Jawa Barat</div>
				</div>
			</div>
			${qr ? `<div style="width:24mm;text-align:center;"><img src="${qr.qrDataUrl}" alt="QR verifikasi" style="width:22mm;height:22mm;display:block;margin:0 auto;" /><div style="font-size:5.5pt;color:#555;line-height:1.1;">Pindai untuk memeriksa keaslian dokumen</div></div>` : ''}
		</div>

		<div style="text-align:center;margin-bottom:15px;">
			<div style="font-size:12pt;font-weight:bold;text-decoration:underline;margin-bottom:4px;">
				FORM PENGAJUAN ANGGARAN
			</div>
			<div style="font-size:9pt;color:#555;">
				${pengajuan.nomor_pengajuan || 'No. ' + pengajuan.id}
			</div>
		</div>

		<div style="display:flex;gap:20px;margin-bottom:15px;font-size:8.5pt;">
			<div style="flex:1;">
				<table style="width:100%;font-size:8.5pt;">
					<tr><td style="width:110px;padding:2px 0;color:#555;">Nama Pengaju</td><td style="padding:2px 0;">: <strong>${pengajuan.nama_pengaju || '-'}</strong></td></tr>
					<tr><td style="padding:2px 0;color:#555;">Departemen</td><td style="padding:2px 0;">: ${pengajuan.department || '-'}</td></tr>
					<tr><td style="padding:2px 0;color:#555;">Tujuan</td><td style="padding:2px 0;">: ${pengajuan.tujuan_pengajuan || '-'}</td></tr>
					<tr><td style="padding:2px 0;color:#555;">Kategori</td><td style="padding:2px 0;">: ${pengajuan.kategori || '-'}</td></tr>
				</table>
			</div>
			<div style="flex:1;">
				<table style="width:100%;font-size:8.5pt;">
					<tr><td style="width:110px;padding:2px 0;color:#555;">Tanggal Pengajuan</td><td style="padding:2px 0;">: ${formatDatePrint(pengajuan.date_created)}</td></tr>
					<tr><td style="padding:2px 0;color:#555;">Tgl Dibutuhkan</td><td style="padding:2px 0;">: ${formatDatePrint(pengajuan.tanggal_dibutuhkan)}</td></tr>
					<tr><td style="padding:2px 0;color:#555;">Urgency</td><td style="padding:2px 0;">: ${urgencyLabel}</td></tr>
					<tr><td style="padding:2px 0;color:#555;">Status</td><td style="padding:2px 0;">: <strong>${pengajuan.status || '-'}</strong></td></tr>
				</table>
			</div>
		</div>

		${pengajuan.penerima_dana_nama || pengajuan.bank_name ? `
		<div style="margin-bottom:10px;padding:6px 10px;background:#faf5ff;border:1px solid #e9d5ff;border-radius:4px;font-size:8.5pt;">
			${pengajuan.penerima_dana_nama ? `<strong>Penerima Dana:</strong> ${pengajuan.penerima_dana_nama} ${pengajuan.penerima_dana_type ? `(${pengajuan.penerima_dana_type})` : ''}` : ''}
			${pengajuan.bank_name ? `&nbsp;&middot;&nbsp; <strong>Bank:</strong> ${pengajuan.bank_name}` : ''}
			${pengajuan.bank_account_number ? `&nbsp;&middot;&nbsp; <strong>No. Rek:</strong> ${pengajuan.bank_account_number}` : ''}
			${pengajuan.bank_account_name ? `&nbsp;&middot;&nbsp; <strong>a.n:</strong> ${pengajuan.bank_account_name}` : ''}
		</div>
		` : ''}

		<table style="width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:10px;">
			<thead>
				<tr style="background:#e2e8f0;">
					<th style="width:30px;text-align:center;border:1px solid #ccc;padding:4px 6px;">No</th>
					<th style="text-align:left;border:1px solid #ccc;padding:4px 6px;">Deskripsi</th>
					<th style="width:65px;text-align:center;border:1px solid #ccc;padding:4px 6px;">Qty</th>
					<th style="width:100px;text-align:right;border:1px solid #ccc;padding:4px 6px;">Harga</th>
					<th style="width:100px;text-align:right;border:1px solid #ccc;padding:4px 6px;">Total</th>
					<th style="width:110px;text-align:left;border:1px solid #ccc;padding:4px 6px;">Vendor</th>
				</tr>
			</thead>
			<tbody>
				${buildItemsTable(items)}
			</tbody>
			<tfoot>
				<tr style="background:#fef3c7;">
					<td colspan="4" style="text-align:right;border:1px solid #ccc;padding:5px 8px;font-weight:bold;font-size:9pt;">TOTAL</td>
					<td style="text-align:right;border:1px solid #ccc;padding:5px 8px;font-weight:bold;font-size:9pt;">Rp ${formatCurrencyPrint(totalAmount)}</td>
					<td style="border:1px solid #ccc;"></td>
				</tr>
			</tfoot>
		</table>

		${pengajuan.jumlah_disetujui ? `
		<div style="text-align:right;font-size:9pt;margin-bottom:5px;">
			<strong>Jumlah Disetujui:</strong> <span style="color:#15803d;font-weight:bold;">Rp ${formatCurrencyPrint(pengajuan.jumlah_disetujui)}</span>
		</div>
		` : ''}

		${pengajuan.comments ? `
		<div style="margin-bottom:15px;font-size:8.5pt;">
			<strong>Catatan:</strong> ${pengajuan.comments}
		</div>
		` : ''}

		<div style="display:flex;justify-content:space-between;margin-top:25px;page-break-inside:avoid;">
			${signatureSlots}
		</div>

		${physicalFinanceSection}
	`;
}

function wrapFullPrintDocument(pengajuan: any, bodyHtml: string): string {
	return `
	<html>
	<head>
		<title>Pengajuan Anggaran - ${pengajuan.nomor_pengajuan || '#' + pengajuan.id}</title>
		<meta charset="UTF-8">
		<style>
			* { margin: 0; padding: 0; box-sizing: border-box; }
			body {
				font-family: Arial, sans-serif;
				background: #fff;
				color: #000;
				max-width: 210mm;
				margin: 0 auto;
				padding: 12mm 15mm;
				font-size: 9pt;
				line-height: 1.3;
			}
			@page { margin: 0; size: A4 portrait; }
			@media print {
				body {
					margin: 0; padding: 12mm 15mm; box-shadow: none;
					max-width: none; width: 100%;
					-webkit-print-color-adjust: exact;
					print-color-adjust: exact;
				}
			}
		</style>
	</head>
	<body>
		${bodyHtml}
		<script>window.onload = function() { if (window.print) { setTimeout(function() { window.print(); }, 600); } };</script>
	</body>
	</html>
	`;
}

/**
 * Cetak pengajuan anggaran dari Dashboard Lapangan — window.open() dipanggil SINKRON
 * di sini (tidak ada await sebelumnya) supaya tidak diblokir popup blocker browser.
 * @param pengajuan - Objek pengajuan_anggaran (dari getPengajuanById, atau `budget` di halaman)
 * @param items - Array items_pengajuan_anggaran (dari getPengajuanItems, atau `budgetItems`)
 * @param approvalTimeline - `{status, steps}` dari realChain (proxy /api/pengajuan-anggaran-timeline), boleh null
 */
export function printPengajuanLapangan(
	pengajuan: any,
	items: any[],
	approvalTimeline: ApprovalTimeline | null = null,
	opts: { qrProvider?: () => Promise<QrVerifikasiPrint | null> } = {}
) {
	if (!pengajuan) {
		alert('Tidak ada data pengajuan');
		return;
	}
	const printWindow = window.open('', '_blank');
	if (!printWindow) {
		alert('Pop-up diblokir browser. Izinkan pop-up untuk halaman ini agar bisa mencetak.');
		return;
	}
	printWindow.document.write('<html><body style="font-family:Arial;padding:50px;text-align:center;"><p>Memuat pengajuan anggaran...</p></body></html>');
	printWindow.document.close();

	// QR bersifat pelengkap: gagal/lambat (>4 dtk, mis. sinyal lemah) → dokumen tetap tercetak tanpa QR.
	const qrPromise: Promise<QrVerifikasiPrint | null> = opts.qrProvider
		? Promise.race([opts.qrProvider().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))])
		: Promise.resolve(null);

	qrPromise
		.then((qr) => buildPengajuanLapanganBodyHtml(pengajuan, items, approvalTimeline, qr))
		.then((bodyHtml) => {
			printWindow.document.open();
			printWindow.document.write(wrapFullPrintDocument(pengajuan, bodyHtml));
			printWindow.document.close();
		})
		.catch((error) => {
			printWindow.document.open();
			printWindow.document.write(`<html><body style="font-family:Arial;padding:50px;text-align:center;"><p style="color:red;">Error: ${error.message}</p></body></html>`);
			printWindow.document.close();
		});
}

/**
 * Download PDF (Mode Ringkas Mobile & Offline-Tolerant, rekomendasi rencana Fase Lapangan):
 * bangun HTML sekali (sama dgn printPengajuanLapangan), render lewat html2pdf.js — sudah
 * jadi dependency terpasang (lihat pola sama di ProjectPayrollRecap.svelte / slip-gaji),
 * TANPA request berulang ke Directus. Mengembalikan Blob untuk ditampilkan lewat
 * PdfBlobViewer (preview + tombol unduh — cara yang sudah terbukti jalan di HP/mobile,
 * beda dari <a download> yang tidak selalu reliable di browser mobile).
 */
export async function downloadPengajuanLapanganPdf(pengajuan: any, items: any[], approvalTimeline: ApprovalTimeline | null = null): Promise<Blob> {
	const bodyHtml = await buildPengajuanLapanganBodyHtml(pengajuan, items, approvalTimeline);
	const html2pdf = (await import('html2pdf.js')).default;

	const tempDiv = document.createElement('div');
	tempDiv.style.fontFamily = 'Arial, sans-serif';
	tempDiv.style.fontSize = '9pt';
	tempDiv.style.color = '#000';
	tempDiv.style.background = '#fff';
	tempDiv.style.padding = '4mm';
	tempDiv.innerHTML = bodyHtml;
	document.body.appendChild(tempDiv);

	try {
		const opt = {
			margin: 8,
			filename: `Pengajuan-Anggaran-${pengajuan.nomor_pengajuan || pengajuan.id}.pdf`,
			image: { type: 'jpeg', quality: 0.98 },
			html2canvas: { scale: 2, useCORS: true },
			jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
		};
		return await html2pdf().set(opt).from(tempDiv).output('blob');
	} finally {
		document.body.removeChild(tempDiv);
	}
}
