// Cetak Blasting & Painting Inspection Report (BPIR) — pola printSPKManpower.ts:
// print window (window.open + document.write) meniru layout Excel resmi
// (PT. PLP PO 31391). Approved (klien) sengaja dikosongkan — TTD basah/scan.
import { secureDirectusFetch } from '$lib/services/secureDirectus';
import type { InspectionReport, InspectionPaintLayer, InspectionDftReading } from '$lib/services/inspectionApi';

async function fetchAssetAsDataUrl(fileId: string): Promise<string | null> {
	try {
		const res = await secureDirectusFetch(`/assets/${fileId}`);
		if (!res.ok) return null;
		const blob = await res.blob();
		return await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = reject;
			reader.readAsDataURL(blob);
		});
	} catch {
		return null;
	}
}

function formatDatePrint(dateString: string | null | undefined): string {
	if (!dateString) return '-';
	return new Date(dateString).toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
}

const STYLES = `
	* { margin:0; padding:0; box-sizing:border-box; }
	body {
		font-family: Arial, Helvetica, sans-serif;
		font-size: 9.5pt;
		color: #000;
		background: #fff;
		max-width: 210mm;
		margin: 0 auto;
		padding: 12mm;
		line-height: 1.35;
	}
	@page { margin: 0; size: A4 portrait; }
	@media print { body { padding: 10mm; max-width: none; } }
	.header { display:flex; align-items:center; justify-content:space-between; border-bottom:3px double #000; padding-bottom:8px; margin-bottom:12px; }
	.company-name { font-size:13pt; font-weight:bold; }
	.company-addr { font-size:8pt; color:#333; }
	.doc-title { text-align:center; margin:10px 0; }
	.doc-title h2 { font-size:13pt; font-weight:bold; text-decoration:underline; text-transform:uppercase; }
	.doc-title .sub { font-size:9pt; margin-top:2px; }
	table.info { width:100%; border-collapse:collapse; margin-bottom:10px; }
	table.info td { padding:2px 4px; vertical-align:top; font-size:9.5pt; }
	table.info td.label { width:110px; color:#333; }
	table.info td.colon { width:12px; }
	.sec-title { font-weight:bold; font-size:10pt; background:#eee; padding:3px 6px; margin:10px 0 4px; border:1px solid #000; }
	table.data { width:100%; border-collapse:collapse; margin-bottom:8px; }
	table.data th, table.data td { border:1px solid #000; padding:3px 5px; font-size:9pt; text-align:left; }
	table.data th { background:#f0f0f0; text-align:center; }
	table.data td.num { text-align:center; }
	.hold-point { border:2px solid #b91c1c; background:#fee2e2; color:#7f1d1d; padding:6px 8px; margin:8px 0; font-size:9pt; font-weight:bold; }
	.signatures { display:flex; justify-content:space-between; margin-top:20px; }
	.sig-block { width:31%; text-align:center; }
	.sig-label { font-size:9pt; font-weight:bold; margin-bottom:4px; }
	.sig-img-box { height:55px; display:flex; align-items:center; justify-content:center; margin-bottom:2px; }
	.sig-line { border-top:1px solid #000; padding-top:3px; font-size:9pt; }
	.stamp-note { text-align:center; font-size:7.5pt; color:#666; margin-top:16px; border-top:1px dashed #ccc; padding-top:6px; }
`;

function companyHeader(reportNo: string | null) {
	return `
	<div class="header">
		<div>
			<div class="company-name">PT. ELTAMA PRIMA INDO</div>
			<div class="company-addr">Jl. Raya Parpostel Gang Nangka RT. 02 RW. 03 No 88, Bojong Kulur, Gunung Putri, Bogor</div>
		</div>
		<div style="text-align:right; font-size:9pt;">${reportNo ? `No: ${reportNo}` : ''}</div>
	</div>`;
}

function dftTable(readings: InspectionDftReading[]): string {
	if (readings.length === 0) return '<p style="font-size:8.5pt;color:#666;">Belum ada titik ukur DFT.</p>';
	const rows = readings
		.map((r) => `<tr><td class="num">${r.point_index}</td><td>${r.unit_no || '-'}</td><td>${r.material || '-'}</td><td class="num">${r.value_um}</td></tr>`)
		.join('');
	return `<table class="data"><thead><tr><th>No</th><th>Unit/Material</th><th>Keterangan</th><th>Nilai (µm)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export async function printInspectionReport(
	report: InspectionReport,
	layers: InspectionPaintLayer[],
	dftReadingsByLayer: Map<number, InspectionDftReading[]>
) {
	const win = window.open('', '_blank');
	if (!win) { alert('Popup diblokir browser. Izinkan popup untuk halaman ini.'); return; }

	const [preparedSig, inspectedSig] = await Promise.all([
		report.prepared_signature_file ? fetchAssetAsDataUrl(report.prepared_signature_file) : null,
		report.inspected_signature_file ? fetchAssetAsDataUrl(report.inspected_signature_file) : null
	]);

	const sigImg = (dataUrl: string | null) =>
		dataUrl
			? `<img src="${dataUrl}" alt="ttd" style="max-height:50px;max-width:90%;object-fit:contain;" />`
			: '';

	const layerBlocks = layers
		.map((l) => `
		<div class="sec-title">Layer ${l.layer_no}${l.painting_system ? ' — ' + l.painting_system : ''}</div>
		<table class="info">
			<tr><td class="label">Paint Name</td><td class="colon">:</td><td>${l.paint_name || '-'}</td>
				<td class="label">Colour</td><td class="colon">:</td><td>${l.paint_colour || '-'}</td></tr>
			<tr><td class="label">Date/Time Application</td><td class="colon">:</td><td>${formatDatePrint(l.date_application)} ${l.time_application || ''}</td>
				<td class="label">Pot Life</td><td class="colon">:</td><td>${l.pot_life || '-'}</td></tr>
			<tr><td class="label">Mixing Ratio</td><td class="colon">:</td><td>${l.mixing_ratio || '-'}</td>
				<td class="label">Thinner</td><td class="colon">:</td><td>${l.thinner_name || '-'}</td></tr>
			<tr><td class="label">Visual Appearance</td><td class="colon">:</td><td>${l.visual_appearance || '-'}</td>
				<td class="label">Paint/Thinner Ratio</td><td class="colon">:</td><td>${l.paint_thinner_ratio || '-'}</td></tr>
			<tr><td class="label">Batch (A/B/Thinner)</td><td class="colon">:</td><td colspan="4">${l.batch_part_a || '-'} / ${l.batch_part_b || '-'} / ${l.batch_thinner || '-'}</td></tr>
			<tr><td class="label">DFT Spec (min/max)</td><td class="colon">:</td><td>${l.dft_spec_min ?? '-'} / ${l.dft_spec_max ?? '-'} µm</td>
				<td class="label">DFT Avg</td><td class="colon">:</td><td><strong>${l.dft_avg ?? '-'} µm</strong> ${l.dft_pass_8515 === true ? '✓ Lolos 85/15' : l.dft_pass_8515 === false ? '✗ Gagal 85/15' : ''}</td></tr>
		</table>
		${dftTable(dftReadingsByLayer.get(l.layer_no) || [])}
	`).join('');

	const holdPointBlock = report.hold_point_flag
		? `<div class="hold-point">⚠ HOLD POINT — Steel Temp terlalu dekat/dibawah Dew Point (margin &lt; 3°C). ${report.hold_point_justification ? 'Justifikasi: ' + report.hold_point_justification : ''}</div>`
		: '';

	const body = `
	<div class="doc-title"><h2>Blasting &amp; Painting Inspection Report</h2><div class="sub">${report.report_no || '(nomor belum diterbitkan)'}</div></div>

	<div class="sec-title">Header</div>
	<table class="info">
		<tr><td class="label">PO No</td><td class="colon">:</td><td>${report.po_no || '-'}</td>
			<td class="label">Client</td><td class="colon">:</td><td>${report.client_name || '-'}</td></tr>
		<tr><td class="label">Part Number</td><td class="colon">:</td><td>${report.part_number || '-'}</td>
			<td class="label">Part Name</td><td class="colon">:</td><td>${report.part_name || '-'}</td></tr>
		<tr><td class="label">Qty</td><td class="colon">:</td><td>${report.qty ?? '-'} ${report.satuan || ''}</td>
			<td class="label">Workshop</td><td class="colon">:</td><td>${report.workshop || '-'}</td></tr>
		<tr><td class="label" style="vertical-align:top;">Description</td><td class="colon">:</td><td colspan="4">${report.description || '-'}</td></tr>
	</table>

	<div class="sec-title">Ambient Condition</div>
	<table class="info">
		<tr><td class="label">Dry Bulb</td><td class="colon">:</td><td>${report.dry_bulb ?? '-'} °C</td>
			<td class="label">Wet Bulb</td><td class="colon">:</td><td>${report.wet_bulb ?? '-'} °C</td></tr>
		<tr><td class="label">RH (auto)</td><td class="colon">:</td><td>${report.rh_pct ?? '-'} %</td>
			<td class="label">Dew Point (auto)</td><td class="colon">:</td><td>${report.dew_point ?? '-'} °C</td></tr>
		<tr><td class="label">Steel Temp</td><td class="colon">:</td><td>${report.steel_temp ?? '-'} °C</td>
			<td class="label">Weather</td><td class="colon">:</td><td>${report.weather || '-'}</td></tr>
	</table>
	${holdPointBlock}

	<div class="sec-title">Surface Preparation</div>
	<table class="info">
		<tr><td class="label">Method</td><td class="colon">:</td><td>${report.prep_method || '-'}</td>
			<td class="label">Abrasive Type</td><td class="colon">:</td><td>${report.abrasive_type || '-'}</td></tr>
		<tr><td class="label">Dust Level</td><td class="colon">:</td><td>${report.dust_level || '-'}</td>
			<td class="label">Surface Profile</td><td class="colon">:</td><td>${report.surface_profile || '-'}</td></tr>
		<tr><td class="label">Method of Application</td><td class="colon">:</td><td colspan="4">${report.method_of_application || '-'}</td></tr>
	</table>

	<div class="sec-title">Paint Record &amp; DFT</div>
	${layerBlocks}

	${report.note ? `<div class="sec-title">Note</div><p style="font-size:9pt;">${report.note}</p>` : ''}

	<div class="signatures">
		<div class="sig-block">
			<div class="sig-label">Prepared by</div>
			<div class="sig-img-box">${sigImg(preparedSig)}</div>
			<div class="sig-line">${report.prepared_by || '-'}</div>
		</div>
		<div class="sig-block">
			<div class="sig-label">Inspected by</div>
			<div class="sig-img-box">${sigImg(inspectedSig)}</div>
			<div class="sig-line">${report.inspected_by || '-'}</div>
		</div>
		<div class="sig-block">
			<div class="sig-label">Approved by (Klien)</div>
			<div class="sig-img-box"></div>
			<div class="sig-line">&nbsp;</div>
		</div>
	</div>`;

	win.document.write(`<!DOCTYPE html>
<html lang="id">
<head><meta charset="UTF-8"><title>BPIR - ${report.report_no || report.id}</title><style>${STYLES}</style></head>
<body>
	${companyHeader(report.report_no)}
	${body}
	<div class="stamp-note">Dokumen dicetak dari sistem ERP EPI &bull; ${new Date().toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
	<script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`);
	win.document.close();
}
