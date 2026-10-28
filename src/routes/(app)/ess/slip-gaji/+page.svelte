<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getPayrollStatus, type PayrollSlip } from '$lib/services/ess/payroll';
	import { IconLoader2, IconAlertTriangle, IconDownload, IconChevronDown, IconHistory, IconCalendarCheck, IconCreditCard } from '@tabler/icons-svelte';
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let slips = $state<PayrollSlip[]>([]);
	let expandedId = $state<string | null>(null);
	let downloadingId = $state<string | null>(null);
	let previewBlob = $state<Blob | null>(null);
	let previewTitle = $state<string>('');
	let showPreviewModal = $state(false);
	let isOffline = $state(typeof navigator !== 'undefined' ? !navigator.onLine : false);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getPayrollStatus();
			slips = res.slips;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat slip gaji.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		const setOnline = () => (isOffline = false);
		const setOffline = () => (isOffline = true);
		window.addEventListener('online', setOnline);
		window.addEventListener('offline', setOffline);
		return () => {
			window.removeEventListener('online', setOnline);
			window.removeEventListener('offline', setOffline);
		};
	});

	function formatRupiah(n: number | null | undefined) {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	function formatPeriode(periode: string) {
		const [year, month] = periode.split('-');
		const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
		return `${monthNames[parseInt(month) - 1] || month} ${year}`;
	}

	function formatTimestamp(isoStr: string | null | undefined) {
		if (!isoStr) return '-';
		try {
			const d = new Date(isoStr);
			if (isNaN(d.getTime())) return String(isoStr);
			return d.toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
		} catch {
			return String(isoStr);
		}
	}

	function toggleExpand(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	// T7 (Delegasi Peran Fase 0.4) — dulu dimuat dari CDN cdnjs, diblokir CSP
	// produksi (script-src 'self' + Google saja). html2pdf.js sudah jadi
	// dependency — import lokal lewat bundler.
	async function ensureHtml2Pdf(): Promise<any> {
		return (await import('html2pdf.js')).default;
	}

	async function downloadPdf(slip: PayrollSlip) {
		downloadingId = slip.id;
		try {
			const html2pdf = await ensureHtml2Pdf();
			const tempDiv = document.createElement('div');
			tempDiv.style.padding = '24px';
			tempDiv.style.fontFamily = 'sans-serif';

			let historyHtml = '';
			if (slip.historyGaji && slip.historyGaji.length > 0) {
				const rows = slip.historyGaji.map((h: any, idx: number) => {
					const ts = formatTimestamp(h.berlaku_mulai || h.date_created || h.created_at);
					const totTunj = Number(h.tunjangan_jabatan || 0) + Number(h.tunjangan_makan || 0) + Number(h.tunjangan_transport || 0) + Number(h.tunjangan_lainnya || 0);
					return `<tr style="border-bottom:1px solid #eee">
						<td style="padding:4px">${ts}</td>
						<td style="padding:4px">${formatRupiah(h.gaji_pokok)}</td>
						<td style="padding:4px">${formatRupiah(totTunj)}</td>
						<td style="padding:4px">${h.catatan || (idx === 0 ? 'Versi Terkini' : `Perubahan #${h.id}`)}</td>
					</tr>`;
				}).join('');

				historyHtml = `
					<h3 style="margin:16px 0 8px;font-size:14px;border-bottom:2px solid #333;padding-bottom:4px">Log Pergerakan Gaji & Atribut</h3>
					<table style="width:100%;border-collapse:collapse;font-size:11px">
						<thead><tr style="background:#f3f4f6"><th style="text-align:left;padding:4px">Timestamp / Tanggal</th><th style="text-align:left;padding:4px">Gaji Pokok</th><th style="text-align:left;padding:4px">Total Tunjangan</th><th style="text-align:left;padding:4px">Keterangan</th></tr></thead>
						<tbody>${rows}</tbody>
					</table>
				`;
			}

			let absensiHtml = '';
			if (slip.absensiList && slip.absensiList.length > 0) {
				const rows = slip.absensiList.map((abs: any) => {
					const tgl = abs.tanggal || '-';
					const masuk = abs.jam_masuk ? `${tgl} ${abs.jam_masuk}` : '-';
					const keluar = abs.jam_keluar ? `${tgl} ${abs.jam_keluar}` : '-';
					return `<tr style="border-bottom:1px solid #eee">
						<td style="padding:4px">${tgl}</td>
						<td style="padding:4px">${masuk}</td>
						<td style="padding:4px">${keluar}</td>
						<td style="padding:4px">${abs.status || '-'}</td>
						<td style="padding:4px">${abs.lokasi || abs.keterangan || '-'}</td>
					</tr>`;
				}).join('');

				absensiHtml = `
					<h3 style="margin:16px 0 8px;font-size:14px;border-bottom:2px solid #333;padding-bottom:4px">Log & Detail Absensi Periode ${slip.periode}</h3>
					<table style="width:100%;border-collapse:collapse;font-size:11px">
						<thead><tr style="background:#f3f4f6"><th style="text-align:left;padding:4px">Tanggal</th><th style="text-align:left;padding:4px">Jam Masuk (Timestamp)</th><th style="text-align:left;padding:4px">Jam Keluar (Timestamp)</th><th style="text-align:left;padding:4px">Status</th><th style="text-align:left;padding:4px">Lokasi / Ket</th></tr></thead>
						<tbody>${rows}</tbody>
					</table>
				`;
			}

			let kasbonHtml = '';
			if (slip.kasbonList && slip.kasbonList.length > 0) {
				const rows = slip.kasbonList.map((k: any) => {
					const ts = formatTimestamp(k.tanggal_cair || k.tanggal_pengajuan || k.date_created || k.created_at);
					const nominalNom = Number(k.nominal) || 0;
					let cicilanNom = Number(k.potongan_per_bulan) || 0;
					if (cicilanNom <= 0) {
						const tenor = Number(k.tenor) || Number(k.jumlah_bulan) || 1;
						cicilanNom = Math.round(nominalNom / Math.max(1, tenor));
					}
					const totalPaid = Number(k.total_paid) || Number(k.terbayar) || 0;
					let sisaNom = (k.sisa_kasbon != null && Number(k.sisa_kasbon) > 0)
						? Number(k.sisa_kasbon)
						: Math.max(0, nominalNom - totalPaid);
					const potPeriode = Number(slip.potongan_kasbon) || 0;

					return `<tr style="border-bottom:1px solid #eee">
						<td style="padding:4px">${ts}</td>
						<td style="padding:4px">${formatRupiah(nominalNom)}</td>
						<td style="padding:4px">${formatRupiah(cicilanNom)}</td>
						<td style="padding:4px">${formatRupiah(potPeriode)}</td>
						<td style="padding:4px">${formatRupiah(sisaNom)}</td>
						<td style="padding:4px">${k.status || '-'}</td>
					</tr>`;
				}).join('');

				kasbonHtml = `
					<h3 style="margin:16px 0 8px;font-size:14px;border-bottom:2px solid #333;padding-bottom:4px">Log & Detail Kasbon / Pinjaman</h3>
					<table style="width:100%;border-collapse:collapse;font-size:11px">
						<thead><tr style="background:#f3f4f6"><th style="text-align:left;padding:4px">Timestamp Cair/Ajukan</th><th style="text-align:left;padding:4px">Nominal Kasbon</th><th style="text-align:left;padding:4px">Cicilan/Bln</th><th style="text-align:left;padding:4px">Pot. Periode Ini</th><th style="text-align:left;padding:4px">Sisa Kasbon</th><th style="text-align:left;padding:4px">Status</th></tr></thead>
						<tbody>${rows}</tbody>
					</table>
				`;
			}

			let kpiHtml = '';
			const kpiItem = slip.kpiList && slip.kpiList.length > 0 ? slip.kpiList[0] : null;
			if (kpiItem) {
				const totalSkor = Number(kpiItem.total_skor) || 0;
				let kat = 'Cukup';
				if (totalSkor >= 90) kat = 'Sangat Baik';
				else if (totalSkor >= 75) kat = 'Baik';
				else if (totalSkor < 60) kat = 'Perlu Perbaikan';

				kpiHtml = `
					<h3 style="margin:16px 0 8px;font-size:14px;border-bottom:2px solid #333;padding-bottom:4px">KPI Karyawan Periode ${kpiItem.periode || slip.periode}</h3>
					<table style="width:100%;border-collapse:collapse;font-size:11px">
						<thead><tr style="background:#f3f4f6"><th style="text-align:left;padding:4px">Status</th><th style="text-align:left;padding:4px">Total Skor</th><th style="text-align:left;padding:4px">Kategori</th><th style="text-align:left;padding:4px">Objektif</th><th style="text-align:left;padding:4px">Kehadiran</th><th style="text-align:left;padding:4px">Perilaku</th><th style="text-align:left;padding:4px">Pelatihan</th></tr></thead>
						<tbody>
							<tr>
								<td style="padding:4px">${kpiItem.status || '-'}</td>
								<td style="padding:4px">${totalSkor}</td>
								<td style="padding:4px">${kat}</td>
								<td style="padding:4px">${kpiItem.skor_objektif ?? '-'}</td>
								<td style="padding:4px">${kpiItem.skor_kehadiran ?? '-'}</td>
								<td style="padding:4px">${kpiItem.skor_perilaku ?? '-'}</td>
								<td style="padding:4px">${kpiItem.skor_pelatihan ?? '-'}</td>
							</tr>
						</tbody>
					</table>
				`;
			} else {
				kpiHtml = `
					<h3 style="margin:16px 0 8px;font-size:14px;border-bottom:2px solid #333;padding-bottom:4px">KPI Karyawan Periode ${slip.periode}</h3>
					<p style="font-size:11px;color:#666;margin:4px 0">Belum ada record / evaluasi KPI untuk periode ini.</p>
				`;
			}

			const totPenghasilan = (slip.gaji_pokok || 0) + (slip.tunjangan_jabatan || 0) + (slip.tunjangan_makan || 0) + (slip.tunjangan_transport || 0) + (slip.tunjangan_lainnya || 0) + (slip.uang_lembur || 0) + (slip.reimbursement || 0) + (slip.insentif_bonus || 0) + (slip.kpi_bonus || 0) + (slip.income_lain_lain || 0);
			const totPotongan = (slip.potongan_terlambat || 0) + (slip.potongan_alpa || 0) + (slip.potongan_bpjs_kesehatan || 0) + (slip.potongan_bpjs_ketenagakerjaan || 0) + (slip.potongan_pph21 || 0) + (slip.potongan_kasbon || 0) + (slip.potongan_lainnya || 0) + (slip.potongan_lain_lain || 0);

			tempDiv.innerHTML = `
				<h2 style="margin:0 0 4px">Slip Gaji ${formatPeriode(slip.periode)}</h2>
				<p style="margin:0 0 16px;color:#666;font-size:12px">Status: ${slip.status} &bull; Dicetak: ${new Date().toLocaleString('id-ID')}</p>
				<table style="width:100%;border-collapse:collapse;font-size:13px">
					<tr><td style="padding:4px 0">Gaji Pokok</td><td style="text-align:right">${formatRupiah(slip.gaji_pokok)}</td></tr>
					<tr><td style="padding:4px 0">Tunjangan Jabatan</td><td style="text-align:right">${formatRupiah(slip.tunjangan_jabatan)}</td></tr>
					<tr><td style="padding:4px 0">Tunjangan Makan</td><td style="text-align:right">${formatRupiah(slip.tunjangan_makan)}</td></tr>
					<tr><td style="padding:4px 0">Tunjangan Transport</td><td style="text-align:right">${formatRupiah(slip.tunjangan_transport)}</td></tr>
					<tr><td style="padding:4px 0">Tunjangan Lainnya</td><td style="text-align:right">${formatRupiah(slip.tunjangan_lainnya)}</td></tr>
					<tr><td style="padding:4px 0">Uang Lembur</td><td style="text-align:right">${formatRupiah(slip.uang_lembur)}</td></tr>
					<tr><td style="padding:4px 0">Reimbursement</td><td style="text-align:right">${formatRupiah(slip.reimbursement)}</td></tr>
					${(slip.kpi_bonus || 0) > 0 ? `<tr><td style="padding:4px 0">Bonus KPI (Skor: ${slip.kpi_skor ?? '-'}/100)</td><td style="text-align:right">${formatRupiah(slip.kpi_bonus)}</td></tr>` : ''}
					<tr style="background:#EEF2FF;font-weight:bold;color:#1E1B4B"><td style="padding:6px">TOTAL PENGHASILAN</td><td style="text-align:right;padding:6px">${formatRupiah(totPenghasilan)}</td></tr>
					<tr><td style="padding:4px 0;color:#B91C1C">Potongan Terlambat</td><td style="text-align:right;color:#B91C1C">-${formatRupiah(slip.potongan_terlambat)}</td></tr>
					<tr><td style="padding:4px 0;color:#B91C1C">Potongan Alpa</td><td style="text-align:right;color:#B91C1C">-${formatRupiah(slip.potongan_alpa)}</td></tr>
					<tr><td style="padding:4px 0;color:#B91C1C">Potongan BPJS Kesehatan</td><td style="text-align:right;color:#B91C1C">-${formatRupiah(slip.potongan_bpjs_kesehatan)}</td></tr>
					<tr><td style="padding:4px 0;color:#B91C1C">Potongan BPJS Ketenagakerjaan</td><td style="text-align:right;color:#B91C1C">-${formatRupiah(slip.potongan_bpjs_ketenagakerjaan)}</td></tr>
					<tr><td style="padding:4px 0;color:#B91C1C">Potongan PPh21</td><td style="text-align:right;color:#B91C1C">-${formatRupiah(slip.potongan_pph21)}</td></tr>
					<tr><td style="padding:4px 0;color:#B91C1C">Potongan Kasbon</td><td style="text-align:right;color:#B91C1C">-${formatRupiah(slip.potongan_kasbon)}</td></tr>
					<tr><td style="padding:4px 0;color:#B91C1C">Potongan Lainnya</td><td style="text-align:right;color:#B91C1C">-${formatRupiah(slip.potongan_lainnya)}</td></tr>
					<tr style="background:#FEF2F2;font-weight:bold;color:#991B1B"><td style="padding:6px">TOTAL POTONGAN</td><td style="text-align:right;padding:6px">-${formatRupiah(totPotongan)}</td></tr>
					<tr style="border-top:2px solid #333"><td style="padding:8px 0;font-weight:bold">Gaji Bersih</td><td style="text-align:right;font-weight:bold">${formatRupiah(slip.gaji_bersih)}</td></tr>
				</table>
				${historyHtml}
				${absensiHtml}
				${kasbonHtml}
				${kpiHtml}
				<div style="page-break-before:always;margin-top:24px">
					<h3 style="margin:0 0 2px;font-size:13px;border-bottom:2px solid #333;padding-bottom:4px">Lampiran Rekapitulasi Matriks Payroll Bulanan (${slip.periode})</h3>
					<p style="margin:0 0 8px;font-size:10px;font-weight:bold;color:#B91C1C;text-align:center">(SANGAT RAHASIA, HANYA BOLEH DIKETAHUI OLEH MANAGER MASING-MASING, HRD, FINANCE, GM DAN DIREKTUR. KEBOCORAN DATA BERISIKO HUKUM)</p>
					<table style="width:100%;border-collapse:collapse;font-size:10px">
						<thead>
							<tr style="background:#1E1B4B;color:#fff">
								<th style="padding:4px;text-align:left">Periode</th>
								<th style="padding:4px;text-align:right">Gaji Pokok</th>
								<th style="padding:4px;text-align:right">Total Tunjangan</th>
								<th style="padding:4px;text-align:right">Uang Lembur</th>
								<th style="padding:4px;text-align:right">Total Potongan</th>
								<th style="padding:4px;text-align:right">Gaji Bersih</th>
								<th style="padding:4px;text-align:center">Status</th>
							</tr>
						</thead>
						<tbody>
							<tr style="border-bottom:1px solid #ddd;background:#E0E7FF;font-weight:bold">
								<td style="padding:4px;text-align:left">${slip.periode}</td>
								<td style="padding:4px;text-align:right">${formatRupiah(slip.gaji_pokok)}</td>
								<td style="padding:4px;text-align:right">${formatRupiah((slip.tunjangan_jabatan||0) + (slip.tunjangan_makan||0) + (slip.tunjangan_transport||0) + (slip.tunjangan_lainnya||0))}</td>
								<td style="padding:4px;text-align:right">${formatRupiah(slip.uang_lembur)}</td>
								<td style="padding:4px;text-align:right">${formatRupiah(slip.potongan)}</td>
								<td style="padding:4px;text-align:right">${formatRupiah(slip.gaji_bersih)}</td>
								<td style="padding:4px;text-align:center">${slip.status}</td>
							</tr>
						</tbody>
					</table>
				</div>
			`;
			document.body.appendChild(tempDiv);
			const opt = {
				margin: 0.4,
				filename: `Slip-Gaji-${slip.periode}.pdf`,
				image: { type: 'jpeg', quality: 0.98 },
				html2canvas: { scale: 2 },
				jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
			};
			const pdfBlob = await html2pdf().set(opt).from(tempDiv).output('blob');
			document.body.removeChild(tempDiv);
			previewBlob = pdfBlob;
			previewTitle = `Slip-Gaji-${slip.periode}.pdf`;
			showPreviewModal = true;
		} catch (err) {
			console.error('Gagal membuat PDF slip gaji:', err);
			errorMsg = 'Gagal membuat PDF.';
		} finally {
			downloadingId = null;
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Slip Gaji</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Slip gaji yang sudah disetujui/dibayarkan</p>
	</div>

	{#if isOffline}
		<div class="rounded-xl px-4 py-2.5 mb-4 text-xs font-medium" style="background: #FEF3C7; color: #92400E;">
			📶 Tidak ada koneksi internet — menampilkan data tersimpan terakhir, mungkin belum yang terbaru.
		</div>
	{/if}

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data slip gaji..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else if slips.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada slip gaji yang tersedia.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-4">
			{#each slips as slip (slip.id)}
				<div class="glass-panel rounded-2xl overflow-hidden transition-all duration-300 {expandedId === slip.id ? 'shadow-lg border-blue-200/50' : 'hover-lift'}">
					<button class="w-full flex items-center justify-between p-5 focus:outline-none" onclick={() => toggleExpand(slip.id)}>
						<div class="text-left flex flex-col gap-1">
							<p class="text-lg font-bold" style="color: var(--sys-label)">{formatPeriode(slip.periode)}</p>
							<span class="text-xs font-bold px-2 py-0.5 rounded-full border shadow-sm w-fit bg-emerald-50 text-emerald-700 border-emerald-200">{slip.status}</span>
						</div>
						<div class="flex items-center gap-4">
							<p class="text-xl font-black gradient-text tracking-tight">{formatRupiah(slip.gaji_bersih)}</p>
							<div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
								<IconChevronDown size={18} class="transition-transform duration-300 {expandedId === slip.id ? 'rotate-180 text-blue-600' : ''}" style="color: var(--sys-label4)" />
							</div>
						</div>
					</button>

					{#if expandedId === slip.id}
						{@const totalPenghasilan = (slip.gaji_pokok || 0) + (slip.tunjangan_jabatan || 0) + (slip.tunjangan_bk || slip.bk || 0) + (slip.tunjangan_jabodetabek || 0) + (slip.tunjangan_luar_jabodetabek || 0) + (slip.tunjangan_luar_pulau || 0) + (slip.tunjangan_makan || 0) + (slip.tunjangan_transport || 0) + (slip.tunjangan_lainnya || 0) + (slip.uang_lembur || 0) + (slip.reimbursement || 0) + (slip.insentif_bonus || 0) + (slip.kpi_bonus || 0) + (slip.income_lain_lain || 0)}
						{@const totalPotongan = (slip.potongan_terlambat || 0) + (slip.potongan_alpa || 0) + (slip.potongan_bpjs_kesehatan || 0) + (slip.potongan_bpjs_ketenagakerjaan || 0) + (slip.potongan_pph21 || 0) + (slip.potongan_kasbon || 0) + (slip.potongan_lainnya || 0) + (slip.potongan_lain_lain || 0)}
						<div class="px-6 pb-6 bg-slate-50/50 border-t border-slate-200/50">
							<div class="text-sm pt-4 flex flex-col gap-3 font-medium" style="color: var(--sys-label)">
								<div class="flex justify-between items-center"><span class="text-slate-500">Gaji Pokok</span><span>{formatRupiah(slip.gaji_pokok)}</span></div>
								<div class="flex justify-between items-center"><span class="text-slate-500">Tunjangan Jabatan</span><span>{formatRupiah(slip.tunjangan_jabatan)}</span></div>
								{#if (slip.tunjangan_bk || slip.bk || 0) > 0}
									<div class="flex justify-between items-center"><span class="text-slate-500">Tunjangan BK</span><span>{formatRupiah(slip.tunjangan_bk || slip.bk)}</span></div>
								{/if}
								{#if (slip.tunjangan_jabodetabek || 0) > 0}
									<div class="flex justify-between items-center"><span class="text-slate-500">Tunjangan Jabodetabek</span><span>{formatRupiah(slip.tunjangan_jabodetabek)}</span></div>
								{/if}
								{#if (slip.tunjangan_luar_jabodetabek || 0) > 0}
									<div class="flex justify-between items-center"><span class="text-slate-500">Tunjangan Luar Jabodetabek</span><span>{formatRupiah(slip.tunjangan_luar_jabodetabek)}</span></div>
								{/if}
								{#if (slip.tunjangan_luar_pulau || 0) > 0}
									<div class="flex justify-between items-center"><span class="text-slate-500">Tunjangan Luar Pulau</span><span>{formatRupiah(slip.tunjangan_luar_pulau)}</span></div>
								{/if}
								{#if (slip.tunjangan_makan || 0) > 0}
									<div class="flex justify-between items-center"><span class="text-slate-500">Tunjangan Makan</span><span>{formatRupiah(slip.tunjangan_makan)}</span></div>
								{/if}
								{#if (slip.tunjangan_transport || 0) > 0}
									<div class="flex justify-between items-center"><span class="text-slate-500">Tunjangan Transport</span><span>{formatRupiah(slip.tunjangan_transport)}</span></div>
								{/if}
								{#if (slip.tunjangan_lainnya || 0) > 0}
									<div class="flex justify-between items-center"><span class="text-slate-500">Tunjangan Lainnya</span><span>{formatRupiah(slip.tunjangan_lainnya)}</span></div>
								{/if}
								<div class="flex justify-between items-center"><span class="text-slate-500">Uang Lembur</span><span>{formatRupiah(slip.uang_lembur)}</span></div>
								{#if (slip.reimbursement || 0) > 0}
									<div class="flex justify-between items-center"><span class="text-slate-500">Reimbursement</span><span>{formatRupiah(slip.reimbursement)}</span></div>
								{/if}
								{#if (slip.kpi_bonus || 0) > 0}
									<div class="flex justify-between items-center">
										<a href="/ess/kinerja" class="text-slate-500 hover:text-indigo-600 hover:underline flex items-center gap-1">
											Bonus KPI <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-200">Skor {slip.kpi_skor ?? '-'}/100</span>
										</a>
										<span>{formatRupiah(slip.kpi_bonus)}</span>
									</div>
								{/if}
								<div class="flex justify-between items-center font-bold text-indigo-700 bg-indigo-50/80 p-2 rounded-lg border border-indigo-100 mt-1">
									<span>TOTAL PENGHASILAN</span>
									<span>{formatRupiah(totalPenghasilan)}</span>
								</div>

								<!-- Deductions -->
								<div class="h-px w-full bg-slate-200 my-1"></div>
								<div class="flex justify-between items-center text-red-600"><span>Potongan Terlambat</span><span>-{formatRupiah(slip.potongan_terlambat)}</span></div>
								{#if slip.rincianAbsensi?.telat?.length}
									<p class="text-[10px] pl-2" style="color: var(--sys-label4)">
										Tercatat telat: {slip.rincianAbsensi.telat.map((t) => `${t.tanggal} (+${t.menitTelat}mnt)`).join(', ')}
									</p>
								{/if}
								{#if (slip.potongan_alpa || 0) > 0}
									<div class="flex justify-between items-center text-red-600"><span>Potongan Alpa</span><span>-{formatRupiah(slip.potongan_alpa)}</span></div>
									{#if slip.rincianAbsensi?.alpa?.length}
										<p class="text-[10px] pl-2" style="color: var(--sys-label4)">Tercatat alpa: {slip.rincianAbsensi.alpa.join(', ')}</p>
									{/if}
								{/if}
								{#if (slip.potongan_lainnya || 0) > 0}
									<div class="flex justify-between items-center text-red-600"><span>Potongan Lainnya</span><span>-{formatRupiah(slip.potongan_lainnya)}</span></div>
								{/if}
								<div class="flex justify-between items-center text-red-600"><span>Potongan BPJS</span><span>-{formatRupiah((slip.potongan_bpjs_kesehatan || 0) + (slip.potongan_bpjs_ketenagakerjaan || 0))}</span></div>
								<div class="flex justify-between items-center text-red-600"><span>Potongan PPh21</span><span>-{formatRupiah(slip.potongan_pph21)}</span></div>
								{#if (slip.potongan_kasbon || 0) > 0}
									<div class="flex justify-between items-center text-red-600"><span>Potongan Kasbon</span><span>-{formatRupiah(slip.potongan_kasbon)}</span></div>
								{/if}
								{#if (slip.potongan_lain_lain || 0) > 0}
									{#if slip.rincianPotonganLain && slip.rincianPotonganLain.length > 0}
										<details class="group">
											<summary class="flex justify-between items-center text-red-600 cursor-pointer list-none">
												<span class="flex items-center gap-1">
													Potongan Lain-Lain (Sanksi/Denda)
													<IconChevronDown size={13} class="transition-transform group-open:rotate-180" />
												</span>
												<span>-{formatRupiah(slip.potongan_lain_lain)}</span>
											</summary>
											<div class="mt-1 pl-2 space-y-1 border-l-2 border-red-100">
												{#each slip.rincianPotonganLain as r}
													<div class="text-[10px]" style="color: var(--sys-label3)">
														<div class="flex justify-between">
															<span class="font-semibold uppercase">{r.kategori}</span>
															<span>cicilan -{formatRupiah(r.cicilan_per_bulan || r.nominal)}</span>
														</div>
														{#if r.keterangan}<p class="italic">{r.keterangan}</p>{/if}
													</div>
												{/each}
											</div>
										</details>
									{:else}
										<div class="flex justify-between items-center text-red-600"><span>Potongan Lain-Lain</span><span>-{formatRupiah(slip.potongan_lain_lain)}</span></div>
									{/if}
								{/if}
								<div class="flex justify-between items-center font-bold text-red-700 bg-red-50/80 p-2 rounded-lg border border-red-100 mt-1">
									<span>TOTAL POTONGAN</span>
									<span>-{formatRupiah(totalPotongan)}</span>
								</div>

								{#if slip.catatan}
									<div class="mt-1 p-2 rounded-lg bg-amber-50 border border-amber-200">
										<p class="text-[10px] text-amber-700">{slip.catatan}</p>
									</div>
								{/if}

								<div class="flex justify-between items-center font-black text-base pt-3 border-t border-slate-200 mt-1">
									<span>Gaji Bersih</span>
									<span class="gradient-text text-xl tracking-tight">{formatRupiah(slip.gaji_bersih)}</span>
								</div>

								<!-- TABEL 1: LOG PERGERAKAN GAJI -->
								{#if slip.historyGaji && slip.historyGaji.length > 0}
									<div class="mt-4 pt-3 border-t border-slate-200">
										<div class="flex items-center gap-2 font-bold text-xs text-slate-700 mb-2">
											<IconHistory size={16} class="text-blue-600" />
											<span>Log Pergerakan Gaji & Atribut</span>
										</div>
										<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
											<table class="w-full text-xs text-left">
												<thead class="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
													<tr>
														<th class="p-2">Timestamp / Tgl</th>
														<th class="p-2">Gaji Pokok</th>
														<th class="p-2">Total Tunjangan</th>
														<th class="p-2">Keterangan</th>
													</tr>
												</thead>
												<tbody class="divide-y divide-slate-100">
													{#each slip.historyGaji as h, idx}
														{@const totTunj = Number(h.tunjangan_jabatan || 0) + Number(h.tunjangan_makan || 0) + Number(h.tunjangan_transport || 0) + Number(h.tunjangan_lainnya || 0)}
														<tr class="hover:bg-slate-50">
															<td class="p-2 text-slate-600 font-mono text-[11px]">{formatTimestamp(h.berlaku_mulai || h.date_created || h.created_at)}</td>
															<td class="p-2 font-medium">{formatRupiah(h.gaji_pokok)}</td>
															<td class="p-2 text-slate-600">{formatRupiah(totTunj)}</td>
															<td class="p-2 text-slate-500 text-[11px]">{h.catatan || (idx === 0 ? 'Versi Terkini' : `Perubahan #${h.id}`)}</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									</div>
								{/if}

								<!-- TABEL 2: DETAIL ABSENSI -->
								{#if slip.absensiList && slip.absensiList.length > 0}
									<div class="mt-4 pt-3 border-t border-slate-200">
										<div class="flex items-center gap-2 font-bold text-xs text-slate-700 mb-2">
											<IconCalendarCheck size={16} class="text-emerald-600" />
											<span>Log & Detail Absensi Periode {slip.periode}</span>
										</div>
										<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white max-h-60 overflow-y-auto">
											<table class="w-full text-xs text-left">
												<thead class="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200 sticky top-0 bg-slate-100">
													<tr>
														<th class="p-2">Tanggal</th>
														<th class="p-2">Jam Masuk (Timestamp)</th>
														<th class="p-2">Jam Keluar (Timestamp)</th>
														<th class="p-2">Status</th>
														<th class="p-2">Lokasi / Ket</th>
													</tr>
												</thead>
												<tbody class="divide-y divide-slate-100">
													{#each slip.absensiList as abs}
														<tr class="hover:bg-slate-50">
															<td class="p-2 font-medium">{abs.tanggal}</td>
															<td class="p-2 font-mono text-[11px] text-blue-600">{abs.jam_masuk ? `${abs.tanggal} ${abs.jam_masuk}` : '-'}</td>
															<td class="p-2 font-mono text-[11px] text-slate-600">{abs.jam_keluar ? `${abs.tanggal} ${abs.jam_keluar}` : '-'}</td>
															<td class="p-2">
																<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border
																	{abs.status === 'HADIR' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
																	 abs.status === 'TERLAMBAT' ? 'bg-amber-50 text-amber-700 border-amber-200' :
																	 abs.status === 'ALPA' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-700 border-slate-200'}">
																	{abs.status || '-'}
																</span>
															</td>
															<td class="p-2 text-slate-500 text-[11px]">{abs.lokasi || abs.keterangan || '-'}</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									</div>
								{/if}

								<!-- TABEL 3: DETAIL KASBON -->
								{#if slip.kasbonList && slip.kasbonList.length > 0}
									<div class="mt-4 pt-3 border-t border-slate-200">
										<div class="flex items-center gap-2 font-bold text-xs text-slate-700 mb-2">
											<IconCreditCard size={16} class="text-purple-600" />
											<span>Log & Detail Kasbon / Pinjaman</span>
										</div>
										<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
											<table class="w-full text-xs text-left">
												<thead class="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
													<tr>
														<th class="p-2">Timestamp Cair/Ajukan</th>
														<th class="p-2">Nominal Kasbon</th>
														<th class="p-2">Cicilan/Bln</th>
														<th class="p-2">Pot. Periode Ini</th>
														<th class="p-2">Sisa Kasbon</th>
														<th class="p-2">Status</th>
													</tr>
												</thead>
												<tbody class="divide-y divide-slate-100">
													{#each slip.kasbonList as k}
														{@const nominalNom = Number(k.nominal) || 0}
														{@const cicilanNom = Number(k.potongan_per_bulan) > 0 ? Number(k.potongan_per_bulan) : Math.round(nominalNom / Math.max(1, Number(k.tenor || k.jumlah_bulan || 1)))}
														{@const totalPaid = Number(k.total_paid || k.terbayar || 0)}
														{@const sisaNom = (k.sisa_kasbon != null && Number(k.sisa_kasbon) > 0) ? Number(k.sisa_kasbon) : Math.max(0, nominalNom - totalPaid)}
														<tr class="hover:bg-slate-50">
															<td class="p-2 text-slate-600 font-mono text-[11px]">{formatTimestamp(k.tanggal_cair || k.tanggal_pengajuan || k.date_created || k.created_at)}</td>
															<td class="p-2 font-medium">{formatRupiah(nominalNom)}</td>
															<td class="p-2 text-slate-600">{formatRupiah(cicilanNom)}</td>
															<td class="p-2 text-amber-700 font-medium">{formatRupiah(slip.potongan_kasbon)}</td>
															<td class="p-2 text-purple-700 font-semibold">{formatRupiah(sisaNom)}</td>
															<td class="p-2">
																<span class="px-1.5 py-0.5 rounded text-[10px] font-bold border bg-purple-50 text-purple-700 border-purple-200">
																	{k.status || '-'}
																</span>
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
										</div>
									</div>
								{/if}

								<!-- TABEL 4: KPI KARYAWAN PERIODE INI -->
								{#if slip.kpiList && slip.kpiList.length > 0}
									{@const kpiItem = slip.kpiList[0]}
									<div class="mt-4 pt-3 border-t border-slate-200">
										<div class="flex items-center justify-between font-bold text-xs text-slate-700 mb-2">
											<div class="flex items-center gap-2">
												<span class="text-indigo-600">🎯</span>
												<span>KPI Karyawan Periode {kpiItem.periode || slip.periode}</span>
											</div>
											<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
												Skor: {Number(kpiItem.total_skor) || 0}
											</span>
										</div>
										<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white">
											<table class="w-full text-xs text-left">
												<thead class="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
													<tr>
														<th class="p-2">Status</th>
														<th class="p-2">Total Skor</th>
														<th class="p-2">Objektif</th>
														<th class="p-2">Kehadiran</th>
														<th class="p-2">Perilaku</th>
														<th class="p-2">Pelatihan</th>
													</tr>
												</thead>
												<tbody>
													<tr>
														<td class="p-2 font-medium">{kpiItem.status || '-'}</td>
														<td class="p-2 font-bold text-indigo-700">{Number(kpiItem.total_skor) || 0}</td>
														<td class="p-2">{kpiItem.skor_objektif ?? '-'}</td>
														<td class="p-2">{kpiItem.skor_kehadiran ?? '-'}</td>
														<td class="p-2">{kpiItem.skor_perilaku ?? '-'}</td>
														<td class="p-2">{kpiItem.skor_pelatihan ?? '-'}</td>
													</tr>
												</tbody>
											</table>
										</div>
									</div>
								{:else}
									<div class="mt-4 pt-3 border-t border-slate-200">
										<div class="flex items-center gap-2 font-bold text-xs text-slate-700 mb-2">
											<span class="text-indigo-600">🎯</span>
											<span>KPI Karyawan Periode {slip.periode}</span>
										</div>
										<div class="p-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-500">
											Belum ada data / evaluasi KPI untuk karyawan pada periode ini.
										</div>
									</div>
								{/if}
							</div>
							<button
								class="w-full h-12 mt-6 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 gradient-bg shadow-lg hover:shadow-xl transition-all hover:scale-[1.02] active:scale-95"
								disabled={downloadingId === slip.id}
								onclick={() => downloadPdf(slip)}
							>
								{#if downloadingId === slip.id}<IconLoader2 size={18} class="animate-spin" />{:else}<IconDownload size={18} />{/if}
								Unduh PDF Slip Gaji
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<PdfBlobViewer
		src={previewBlob}
		title={previewTitle}
		show={showPreviewModal}
		onClose={() => {
			showPreviewModal = false;
			previewBlob = null;
		}}
	/>
</div>
