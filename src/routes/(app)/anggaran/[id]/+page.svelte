<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { isDeferredGate, deferredHandlerLabel } from '$lib/utils/paGateStage';
	import GateFixBapBorongan from '$lib/components/anggaran/GateFixBapBorongan.svelte';
	let bapDialogOpen = $state(false);
	import {
		IconArrowLeft, IconListNumbers, IconTimeline,
		IconCheck, IconClock, IconX, IconEdit, IconLoader2,
		IconPrinter, IconThumbUp, IconThumbDown, IconCopy, IconDownload
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import {
		getPengajuanById, getPengajuanItems, approvePengajuan, rejectPengajuan,
		getBuktiBayarInfo, confirmDanaDiterima, fetchPayableQueueStatus,
		reevaluatePengajuanGates
	} from '$lib/services/finance';
	import { readItems, updateItem, uploadFiles } from '@directus/sdk';
	import directus from '$lib/services/directus';
	import { authStore, isFinanceRole } from '$lib/stores/auth';
	import { getBudgetActivity, getActionLabel, getActionIcon } from '$lib/services/auditApi';
	import { secureAssetHref } from '$lib/actions/secureAsset';
	import {
		getBudgetStatusLabel,
		getBudgetStatusClass,
		getBudgetStatusHint,
		isBudgetFinanceApproved,
		isBudgetRejected,
		isBudgetPaid
	} from '$lib/constants/status';
	import { isReadyForPaperApproval } from '$lib/utils/approvalPrintEvaluator';
	import { printPengajuanLapangan, downloadPengajuanLapanganPdf } from '$lib/utils/printPengajuanLapangan';
	import { printSlipPengajuanLapangan } from '$lib/utils/printSlipPengajuanLapangan';
	import { buatQrVerifikasi } from '$lib/utils/qrVerifikasi';
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let id = $derived($page.params.id);
	let budget = $state<any>(null);
	let budgetItems = $state<any[]>([]);
	let loading = $state(true);

	// Fase 3 Bagian D (AI Analysis Engine v2.0): "kenapa pengajuan saya belum cair" —
	// current_stage & threshold_tier sudah ada di kolom budget (diisi Fase 0.4/Fase 1
	// admin), tinggal dipakai. sla_hari_kerja dibaca dari approval_sla_config (koleksi
	// yang sama, dibaca langsung read-only, tidak butuh proxy khusus).
	// F4.2 (Akuntabilitas Pembayaran Manpower v3): dari gate gagal -> tautan dalam ke layar
	// yang tepat, sama pola dgn anggaran/cek-gate::linkFor(). G13/G14 (verifikasi & koridor
	// tarif) sengaja tanpa tautan lapangan — keduanya wewenang HRD, bukan hal yang bisa
	// diperbaiki sendiri dari sini.
	function gateLinkFor(g: any): { href: string; label: string } | null {
		const projectId = typeof budget?.project_id === 'object' ? budget.project_id?.id : budget?.project_id;
		if (g.gate_key === 'G12') {
			return { href: projectId ? `/proyek/${projectId}?tab=manpower&sub=gajian` : '/manpower/payroll-terpusat', label: 'Tambah rincian per pekerja (Tarik dari Absensi)' };
		}
		if (g.gate_key === 'G15') {
			return { href: '/manpower', label: 'Lengkapi dokumen pekerja' };
		}
		if (g.gate_key === 'G16') {
			return { href: '/manpower', label: 'Periksa rekening pekerja' };
		}
		// Fase 3 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026, matriks §4) — deep link
		// per gate supaya "Anti-Stuck": pengaju tahu persis ke mana harus pergi, bukan
		// hanya membaca pesan gagal.
		if (g.gate_key === 'G9') {
			return { href: projectId ? `/timeline/${projectId}` : '/timeline', label: 'Isi Timeline Proyek' };
		}
		if (g.gate_key === 'G10') {
			return { href: projectId ? `/laporan/${projectId}` : '/laporan', label: 'Isi Laporan Hari Ini' };
		}
		if (g.gate_key === 'G11') {
			return { href: projectId ? `/proyek/${projectId}?tab=manpower` : '/manpower', label: 'Tugaskan Manpower' };
		}
		if (g.gate_key === 'G17') {
			return { href: '/anggaran', label: 'Lihat pengajuan saya yang menunggak SPJ' };
		}
		if (g.gate_key === 'G_BAP_BORONGAN') {
			return { href: projectId ? `/proyek/${projectId}?tab=manpower&sub=borongan` : '/manpower', label: 'Lengkapi BAP & progres borongan' };
		}
		if (g.gate_key === 'G_P2H_UNIT') {
			return { href: '/fleet-booking', label: 'Isi P2H Kendaraan' };
		}
		return null;
	}

	// Fase 3 — "Cek Ulang": evaluasi ulang snapshot gate tanpa reload halaman. Dipakai
	// pengaju/approver setelah melengkapi data yang diminta gate (F2 di rencana: snapshot
	// basi adalah akar utama 159 PA tertahan per 25 Sep 2026).
	let rechecking = $state(false);
	let recheckMsg = $state<string | null>(null);
	async function recheckGates() {
		if (!budget?.id || rechecking) return;
		rechecking = true;
		recheckMsg = null;
		const result = await reevaluatePengajuanGates(budget.id);
		rechecking = false;
		if (!result.success) {
			recheckMsg = result.message || 'Cek Ulang gagal — coba lagi.';
			return;
		}
		budget = { ...budget, interlocking_status: result.status, interlocking_gates: result.gates };
		recheckMsg =
			result.status === 'blocked'
				? 'Masih ada syarat yang belum terpenuhi — lihat daftar di bawah.'
				: 'Syarat sudah terpenuhi. Pengajuan bisa dilanjutkan approver.';
	}

	// R5 — rantai persetujuan NYATA dari admin erp-epi (Kadept/GM/Direktur/Finance
	// sesuai nominal + siapa yang giliran sekarang). Fail-soft: kalau admin tak
	// terjangkau, kartu ini disembunyikan & timeline hardcoded di bawah tetap tampil.
	let realChain = $state<{ status?: string; currentStep?: number; steps?: any[]; can_approve?: boolean } | null>(null);
	let realChainLoading = $state(false);
	async function loadRealChain() {
		realChainLoading = true;
		try {
			const { getIdToken } = await import('$lib/services/secureDirectus');
			const token = await getIdToken();
			const res = await fetch(`/api/pengajuan-anggaran-timeline?pengajuanId=${id}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {}
			});
			const j = await res.json().catch(() => ({}));
			realChain = j?.available && j?.data?.steps?.length ? j.data : null;
		} catch {
			realChain = null;
		} finally {
			realChainLoading = false;
		}
	}
	let activeApproverName = $derived(
		(realChain?.steps || []).find(
			(s: any) => ['menunggu', 'aktif', 'active'].includes(String(s.status || '').toLowerCase())
		)?.actor_name || null
	);

	// Fase 5 (Rencana KPI Lifecycle v2, L1, 26 Sep 2026): "menunggu: Jabatan X sejak N HK" —
	// hari kerja (Senin-Jumat) sejak step aktif MULAI menunggu (tanggal keputusan step
	// sebelumnya, atau budget.date_created kalau ini step pertama). INFORMATIF saja.
	function jedaHariKerja(dariISO: string, sampaiISO: string) {
		const dari = new Date(dariISO);
		dari.setHours(0, 0, 0, 0);
		const sampai = new Date(sampaiISO);
		sampai.setHours(0, 0, 0, 0);
		let n = 0;
		const cur = new Date(dari);
		while (cur < sampai) {
			cur.setDate(cur.getDate() + 1);
			const dow = cur.getDay();
			if (dow !== 0 && dow !== 6) n++;
		}
		return n;
	}
	let activeStepWaitHariKerja = $derived.by(() => {
		if (!realChain?.steps?.length) return null;
		const idx = realChain.steps.findIndex((s: any) => ['menunggu', 'aktif', 'active'].includes(String(s.status || '').toLowerCase()));
		if (idx === -1) return null;
		const prevStep = idx > 0 ? realChain.steps[idx - 1] : null;
		const sinceRaw = prevStep?.date || budget?.date_created;
		if (!sinceRaw) return null;
		return jedaHariKerja(sinceRaw, new Date().toISOString());
	});

	// L2 — estimasi berbasis data (P50/P90 waktu tunggu per-approver, 30 hari terakhir
	// live) dari process_metric_snapshot APPROVAL_SLA yang sudah dihitung erp-epi (Fase 1).
	// Dibaca langsung (koleksi sama, read-only) — bukan proxy khusus, sama pola dengan
	// approval_sla_config di komentar atas file.
	let approvalP50P90 = $state<{ p50: number; p90: number } | null>(null);
	async function loadApprovalEstimate() {
		try {
			const rows = await directus.request(
				readItems('process_metric_snapshot', {
					filter: { process_code: { _eq: 'APPROVAL_SLA' }, stage_key: { _eq: 'per_approver' } },
					sort: ['-dihitung_pada'],
					limit: 1,
					fields: ['median_value', 'p90_value']
				})
			);
			const r = rows?.[0];
			if (r?.median_value != null && r?.p90_value != null) {
				approvalP50P90 = { p50: Math.round(r.median_value * 10) / 10, p90: Math.round(r.p90_value * 10) / 10 };
			}
		} catch {
			approvalP50P90 = null;
		}
	}

	// L6 (Rencana KPI Lifecycle v2, 26 Sep 2026) — "Ingatkan Approver". Tombol pemohon,
	// pengganti "Colek WA" manual (berisiko spam). Guard sesungguhnya (pemohon, SLA,
	// rate-limit 1x/24 jam) di sisi admin (erp-epi) — proxy ini hanya UI state.
	let ingatkanSubmitting = $state(false);
	let ingatkanMsg = $state('');
	let ingatkanDisabledUntil = $state<number | null>(null);
	async function kirimIngatkan() {
		if (!budget?.approval_request_id) return;
		ingatkanSubmitting = true;
		ingatkanMsg = '';
		try {
			const { getIdToken } = await import('$lib/services/secureDirectus');
			const token = await getIdToken();
			const res = await fetch(`/api/pengajuan-anggaran-ingatkan?approvalRequestId=${encodeURIComponent(budget.approval_request_id)}`, {
				method: 'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : {}
			});
			const j = await res.json().catch(() => ({}));
			ingatkanMsg = j?.message || (j?.success ? 'Approver sudah diingatkan.' : 'Gagal mengingatkan approver.');
			if (j?.success || j?.rateLimited) ingatkanDisabledUntil = Date.now() + 24 * 3600 * 1000;
		} catch (e: any) {
			ingatkanMsg = e?.message || 'Gagal mengingatkan approver.';
		} finally {
			ingatkanSubmitting = false;
		}
	}

	// Fitur Cetak Pengajuan Pra-Finance (Fase 3): tombol cetak resmi reaktif terhadap
	// status manajer, bukan window.print() mentah. Kalau realChain belum berhasil dimuat
	// (admin tak terjangkau, lihat loadRealChain), gagal-lunak ke TIDAK siap (jangan
	// izinkan cetak dokumen resmi tanpa bisa memverifikasi rantai approval-nya).
	let readyForPaperPrint = $derived(
		!!budget && isReadyForPaperApproval({
			pengajuanStatus: budget.status,
			requestStatus: realChain?.status ?? null,
			steps: realChain?.steps || []
		})
	);
	let pdfBlob = $state<Blob | null>(null);
	let pdfTitle = $state('');
	let showPdfPreview = $state(false);
	let downloadingPdf = $state(false);

	function handleCetakResmi() {
		// window.open() HARUS sinkron di sini (dipanggil langsung dari handler klik,
		// tanpa await sebelumnya) — kalau tidak, browser modern mematikan user
		// activation token dan popup cetak diblokir (Aturan Anti-Kesalahan #5).
		printPengajuanLapangan(budget, budgetItems, realChain, { qrProvider: () => buatQrVerifikasi('pa', budget.id) });
	}

	// Slip ringkas (80mm, teks-saja, tanpa library) — alternatif ringan kapan saja, termasuk saat dokumen resmi belum
	// boleh dicetak. window.open dibuka SINKRON di util (Aturan #5); QR menyusul bila server menerbitkannya.
	function handleCetakSlip() {
		const ok = printSlipPengajuanLapangan(budget, budgetItems, realChain?.steps ?? [], { qrProvider: () => buatQrVerifikasi('pa', budget.id) });
		if (!ok) showToast('Pop-up diblokir browser. Izinkan pop-up untuk mencetak slip.', 'err');
	}

	async function handleDownloadPdf() {
		if (downloadingPdf) return;
		downloadingPdf = true;
		try {
			pdfBlob = await downloadPengajuanLapanganPdf(budget, budgetItems, realChain);
			pdfTitle = `Pengajuan-Anggaran-${budget.nomor_pengajuan || budget.id}.pdf`;
			showPdfPreview = true;
		} catch (e) {
			showToast('Gagal membuat PDF', 'err');
		} finally {
			downloadingPdf = false;
		}
	}

	// R6 — Unggah SPJ langsung dari lokasi (foto bon/nota di tempat, tak menumpuk).
	// Menulis field yg SAMA dgn admin submitPertanggungjawaban(): status_pertanggungjawaban
	// 'menunggu_verifikasi' + bukti_pertanggungjawaban[] + catatan + tanggal (+ sisa dana).
	let spjFiles = $state<File[]>([]);
	let spjCatatan = $state('');
	let spjSisaDana = $state('');
	let spjSubmitting = $state(false);
	let spjMsg = $state('');
	const SPJ_DONE = ['menunggu_verifikasi', 'diverifikasi', 'selesai'];
	let isPengaju = $derived(
		!!budget && !!$authStore.user?.email &&
		String(budget.created_by_email || '').toLowerCase() === String($authStore.user.email).toLowerCase()
	);
	let canSubmitSpj = $derived(
		!!budget && isDisbursed && isPengaju &&
		!SPJ_DONE.includes(String(budget.status_pertanggungjawaban || '').toLowerCase())
	);

	// Fase 5 (Rencana KPI Lifecycle v2, L5, 25 Sep 2026): countdown SPJ sejak dana cair.
	// Batas default 14 hari (sama dengan fallback readSpjBatasHari() di erp-epi
	// spjTunggakanHelper.js) — INFORMATIF SAJA, gate sesungguhnya (G17, blocking) tetap
	// ditegakkan server-side saat pengajuan berikutnya, bukan di sini.
	const SPJ_BATAS_HARI_DEFAULT = 14;
	let spjCountdown = $derived.by(() => {
		if (!budget || !canSubmitSpj) return null;
		const tanggalCair = budget.tanggal_dicairkan || budget.finance_processed_date;
		if (!tanggalCair) return null;
		const hariSejakCair = Math.floor((Date.now() - new Date(tanggalCair).getTime()) / 86_400_000);
		const sisaHari = SPJ_BATAS_HARI_DEFAULT - hariSejakCair;
		return { hariSejakCair, sisaHari, terlambat: sisaHari < 0 };
	});

	function onSpjPick(e: Event) {
		const t = e.target as HTMLInputElement;
		spjFiles = [...spjFiles, ...Array.from(t.files || [])];
		t.value = '';
	}
	function removeSpjFile(i: number) {
		spjFiles = spjFiles.filter((_, idx) => idx !== i);
	}
	async function submitSpj() {
		if (spjFiles.length === 0) { spjMsg = 'Unggah minimal 1 foto bon/nota/kwitansi.'; return; }
		spjSubmitting = true;
		spjMsg = '';
		try {
			const ids: string[] = [];
			for (const f of spjFiles) {
				const fd = new FormData();
				fd.append('title', `SPJ ${budget.nomor_pengajuan || budget.id} — ${f.name}`);
				// Foto bon/nota dikompres di HP dulu (sadar jaringan, lihat photoCompress.ts); PDF diunggah apa adanya.
				// Gagal kompres → compressPhoto mengembalikan berkas asli, unggahan tetap jalan.
				const toUpload = f.type.startsWith('image/') ? await compressPhoto(f) : f;
				fd.append('file', toUpload, f.name);
				const up: any = await directus.request(uploadFiles(fd));
				if (up?.id) ids.push(up.id);
			}
			if (ids.length === 0) throw new Error('Berkas gagal diunggah.');
			const patch: any = {
				status_pertanggungjawaban: 'menunggu_verifikasi',
				bukti_pertanggungjawaban: ids,
				catatan_pertanggungjawaban: spjCatatan || '',
				tanggal_pertanggungjawaban: new Date().toISOString().split('T')[0]
			};
			const sisa = parseFloat(spjSisaDana);
			if (!isNaN(sisa) && sisa > 0) patch.sisa_dana_dikembalikan = sisa;
			await directus.request(updateItem('pengajuan_anggaran', budget.id, patch));
			budget = { ...budget, ...patch };
			spjFiles = [];
			spjCatatan = '';
			spjSisaDana = '';
			spjMsg = 'SPJ terkirim — menunggu verifikasi Finance.';
		} catch (e: any) {
			spjMsg = e?.message || 'Gagal mengirim SPJ.';
		} finally {
			spjSubmitting = false;
		}
	}

	let slaHariKerja = $state<number | null>(null);
	let umurPendingHari = $derived(
		budget?.date_created ? Math.floor((Date.now() - new Date(budget.date_created).getTime()) / 86400000) : null
	);
	let terlambatSla = $derived(slaHariKerja !== null && umurPendingHari !== null && umurPendingHari > slaHariKerja);

	// Approval dialog state
	let showApproveDialog = $state(false);
	let showRejectDialog = $state(false);
	let approveAmount = $state('');
	let rejectReason = $state('');
	let approving = $state(false);
	let rejecting = $state(false);

	// Audit log
	let auditLog = $state<any[]>([]);
	let auditLoading = $state(false);
	let showAudit = $state(false);

	async function loadAuditLog() {
		if (auditLoading || auditLog.length > 0) return;
		auditLoading = true;
		const res = await getBudgetActivity(id as string);
		auditLog = res.data;
		auditLoading = false;
	}

	// BIZ-04 — Tarik Pengajuan oleh pengaju (soft-cancel: nomor tetap, status 'Dibatalkan'). Guard sesungguhnya ada di
	// admin (belum ada yang menyetujui, alasan >= 10 karakter); proxy: /api/pengajuan-anggaran-tarik.
	let showTarik = $state(false);
	let tarikReason = $state('');
	let tarikBusy = $state(false);
	let canTarik = $derived(!!budget && isPengaju && ['Pending', 'Perlu Revisi', 'Rejected'].includes(String(budget.status || '')));
	async function tarikPengajuan() {
		if (tarikBusy || !budget) return;
		if (tarikReason.trim().length < 10) { showToast('Alasan penarikan wajib diisi minimal 10 karakter.', 'err'); return; }
		tarikBusy = true;
		try {
			const { getIdToken } = await import('$lib/services/secureDirectus');
			const token = await getIdToken();
			const res = await fetch('/api/pengajuan-anggaran-tarik', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ pengajuanId: Number(id), reason: tarikReason.trim() })
			});
			const data = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
			showToast('Pengajuan ditarik. Nomor & riwayatnya tetap tersimpan.');
			showTarik = false;
			tarikReason = '';
			setTimeout(() => location.reload(), 900);
		} catch (e: any) {
			showToast(`Gagal menarik pengajuan: ${e?.message || e}`, 'err');
		} finally {
			tarikBusy = false;
		}
	}

	// Toast
	let toastMsg = $state('');
	let toastType = $state<'ok' | 'err'>('ok');
	let toastTimer = 0;

	function showToast(msg: string, type: 'ok' | 'err' = 'ok') {
		toastMsg = msg;
		toastType = type;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (toastMsg = ''), 3000) as unknown as number;
	}

	onMount(() => {
		async function loadData() {
			try {
				const result = await getPengajuanById(id as string);
				budget = result;
				if (budget) {
					const itemsResult = await getPengajuanItems(id as string);
					budgetItems = itemsResult || [];

					if (budget.status === 'Pending') {
						try {
							const slaRows = (await directus.request(
								readItems('approval_sla_config' as any, {
									filter: { module_key: { _eq: 'finance.budget' }, tier: { _eq: budget.threshold_tier || 'T1' } },
									fields: ['sla_hari_kerja'],
									limit: 1
								})
							)) as any[];
							slaHariKerja = slaRows?.[0]?.sla_hari_kerja ?? null;
						} catch (e) {
							console.warn('Gagal memuat SLA:', e);
						}
					}

					if (isBudgetPaid(budget.status)) {
						loadingBukti = true;
						try {
							buktiBayar = await getBuktiBayarInfo(budget.nomor_pengajuan, budget.id);
						} finally {
							loadingBukti = false;
						}
					}

					// PA-Rilis Hutang v2 (Fase 4) — status antrian bayar mingguan, hanya relevan
					// selama belum dibayar (sesudahnya buktiBayar di atas sudah cukup).
					if (budget.kategori_belanja === 'rilis_hutang' && !isBudgetPaid(budget.status)) {
						fetchPayableQueueStatus(budget.id).then((s) => { payableQueueStatus = s; }).catch(() => {});
					}

					// R5 — rantai persetujuan nyata (non-blocking, fail-soft).
					loadRealChain();
					// L1/L2 (Rencana KPI Lifecycle v2, Fase 5) — estimasi waktu tunggu, non-blocking.
					loadApprovalEstimate();
				}
			} catch (e) {
				console.error('Gagal memuat detail:', e);
			} finally {
				loading = false;
			}
		}

		loadData();
	});

	function formatCurrency(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
	}

	function formatDate(dateStr: string) {
		if (!dateStr) return '-';
		return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateStr));
	}

	// Predikat dipusatkan di $lib/constants/status. Versi lama di sini hanya mengenal
	// 'Diproses'/'Selesai'/'Verified', sehingga pengajuan berstatus 'Approved' (39 baris)
	// dan 'Completed' (121 baris) dianggap BELUM di-approve Finance — tombol approve
	// tetap muncul untuk pengajuan yang sebenarnya sudah dibayar.
	let isPfApproved = $derived(budget && (isBudgetFinanceApproved(budget.status) || !!budget.project_finance_approved_by));
	let isPfRejected = $derived(budget && isBudgetRejected(budget.status));
	let isDisbursed = $derived(budget && (isBudgetPaid(budget.status) || budget.finance_processed));
	let isDiproses = $derived(budget && getBudgetStatusLabel(budget.status) === 'Diproses');

	// Fase 2 (Lifecycle Bukti Bayar) — bukti transfer dari supplier_payments (admin), dijahit
	// lewat nomor_pengajuan == purchase_invoices.reference_number. dana_diterima_at field
	// terpisah (bukan status baru) supaya tidak mengubah semantik status yang sudah ada.
	let buktiBayar = $state<{ payment_date: string | null; payment_amount: number | null; bukti_bayar: string | null } | null>(null);
	let loadingBukti = $state(false);
	let confirmingDana = $state(false);

	// PA-Rilis Hutang v2 (Fase 4) — pelacak "Masuk Antrian Bayar" antara Disetujui & Dibayar.
	let payableQueueStatus = $state<{ payment_urgency: string | null; scheduled_payment_date: string | null; payment_status: string | null } | null>(null);
	let danaDiterimaAt = $derived(budget?.dana_diterima_at || null);

	// Rekomendasi Section 4 (Penajaman Penjurnalan v2): status pembukuan terlihat pengaju.
	// "Dibukukan" = Manager Finance mengakui pengeluaran masuk ke pos laporan keuangan.
	let isDibukukan = $derived(budget && (budget.dibukukan === true || budget.status === 'Dibukukan'));

	// Anti-yatim (Rencana Self-Service PL v2, FASE 1): pengajuan berstatus Menunggu tapi
	// tidak pernah masuk jalur approval (tanpa approval_request_id & tanpa current_stage)
	// akan mengendap selamanya. Tandai jujur, jangan tampilkan seolah aman.
	let belumMasukAntrean = $derived(
		budget &&
		budget.status === 'Pending' &&
		!budget.approval_request_id &&
		!(budget.current_stage && String(budget.current_stage).trim())
	);
	let canApprove = $derived(
		isFinanceRole($authStore.roleId) &&
		budget &&
		!isPfRejected &&
		!isPfApproved
	);

	const getStatusLabel = getBudgetStatusLabel;
	const getStatusClass = getBudgetStatusClass;

	function getItemCategoryLabel(cat: string) {
		const map: Record<string, string> = {
			operasional: 'Biaya Operasional',
			supplier: 'Supplier / Material',
			consumable: 'Consumables',
			jasa: 'Jasa / Subkon',
			safety: 'Safety',
			sewa_alat: 'Sewa Alat Internal',
			lain_lain: 'Biaya Lain-Lain'
		};
		return map[cat] || cat;
	}

	async function handleApprove() {
		if (approving) return;
		approving = true;
		const approverName = $authStore.user?.displayName || $authStore.user?.email || 'Finance';
		const amount = approveAmount ? parseFloat(approveAmount.replace(/[^0-9]/g, '')) : undefined;
		const result = await approvePengajuan(id as string, approverName, amount);
		if (result.success) {
			budget = {
				...budget,
				status: 'Verified',
				project_finance_approved_by: approverName,
				project_finance_approved_date: new Date().toISOString(),
				...(amount ? { jumlah_disetujui: amount } : {})
			};
			showApproveDialog = false;
			showToast('Pengajuan berhasil disetujui');
		} else {
			showToast('Gagal menyetujui pengajuan', 'err');
		}
		approving = false;
	}

	async function handleReject() {
		if (rejecting || !rejectReason.trim()) return;
		rejecting = true;
		const rejectorName = $authStore.user?.displayName || $authStore.user?.email || 'Finance';
		const result = await rejectPengajuan(id as string, rejectorName, rejectReason.trim());
		if (result.success) {
			budget = {
				...budget,
				status: 'Ditolak',
				reject_reason: rejectReason.trim(),
				project_finance_approved_by: rejectorName,
				project_finance_approved_date: new Date().toISOString()
			};
			showRejectDialog = false;
			showToast('Pengajuan telah ditolak');
		} else {
			showToast('Gagal menolak pengajuan', 'err');
		}
		rejecting = false;
	}

	async function handleConfirmDana() {
		if (confirmingDana || danaDiterimaAt) return;
		confirmingDana = true;
		const result = await confirmDanaDiterima(id as string);
		if (result.success) {
			budget = { ...budget, dana_diterima_at: new Date().toISOString() };
			showToast('Terima kasih, konfirmasi diterima.');
		} else {
			showToast('Gagal mengirim konfirmasi', 'err');
		}
		confirmingDana = false;
	}
</script>

<div class="flex-1 flex flex-col h-full">
	{#if loading}
		<div class="no-print"><CircularProgressGauge size={52} strokeWidth={4} label="Memuat rincian pengajuan anggaran..." /></div>
	{:else if !budget}
		<div class="flex-1 flex items-center justify-center py-16 no-print">
			<p class="text-gray-400 text-sm">Data tidak ditemukan.</p>
		</div>
	{:else}
		<div class="scroll-body px-4 py-4 max-w-5xl mx-auto w-full">
			<div class="mb-3 no-print">
				<button
					type="button"
					onclick={() => goto('/anggaran')}
					class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
				>
					<IconArrowLeft size={16} />
					<span>Kembali ke Daftar Anggaran</span>
				</button>
			</div>
			<!-- Print header (visible only when printing) -->
			<div class="print-only mb-6">
				<h2 class="text-[18px] font-bold text-gray-800">Keuangan</h2>
				<p class="text-[12px] text-gray-500 mt-1">Dicetak pada {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
			</div>

			<!-- Header card -->
			<div class="bg-gradient-to-br from-[var(--pl)] to-white rounded-xl p-4 mb-3.5 border border-[var(--p)]/10">
				<div class="flex justify-between items-start mb-3">
					<div class="flex-1 min-w-0 pr-2">
						<p class="text-[15px] font-semibold text-[var(--pd)]">{budget.tujuan_pengajuan || 'Keuangan'}</p>
						<p class="text-[11px] text-[var(--p)] mt-0.5">Proyek ID: {budget.project_id} · {budget.nomor_pengajuan || ''}</p>
					</div>
					<span class="badge {getStatusClass(budget.status)}" title={getBudgetStatusHint(budget.status)}>{getStatusLabel(budget.status)}</span>
				</div>
				<div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
					<div><span class="text-[var(--p)]/70">Kategori:</span> <span class="text-[var(--pd)] font-medium capitalize">{budget.kategori || '-'}</span></div>
					<div><span class="text-[var(--p)]/70">Urgensi:</span> <span class="text-[var(--amd)] font-medium">{budget.urgency || '-'}</span></div>
					<div><span class="text-[var(--p)]/70">Diajukan:</span> <span class="text-[var(--pd)] font-medium">{formatDate(budget.date_created)}</span></div>
					<div><span class="text-[var(--p)]/70">Butuh:</span> <span class="text-[var(--pd)] font-medium">{formatDate(budget.tanggal_dibutuhkan)}</span></div>
				</div>
			</div>

			{#if belumMasukAntrean}
				<div class="card-section no-print border-red-200 bg-red-50/60">
					<h4>⚠ Belum masuk antrean approval</h4>
					<div class="text-[12px] text-gray-700 space-y-1">
						<p>Pengajuan ini <strong>belum punya penanggung jawab</strong> — kemungkinan gagal terdaftar saat dikirim. Selama begini, tidak ada yang bisa menyetujuinya.</p>
						<p class="font-medium text-red-700">Hubungi admin Finance dan sebutkan nomor pengajuan ini agar didaftarkan ulang. Jangan menunggu — status "Menunggu" di sini tidak berarti sedang diproses.</p>
					</div>
				</div>
			{/if}

			<!-- BIZ-04: Tarik Pengajuan (pemilik) -->
			{#if canTarik}
				<div class="card-section no-print">
					{#if !showTarik}
						<button class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer disabled:opacity-50 border-red-200 text-red-700 hover:bg-red-50" onclick={() => (showTarik = true)} title="Hanya bisa sebelum ada yang menyetujui. Nomor & riwayat tetap tersimpan.">🚫 Tarik Pengajuan</button>
						<p class="text-[11px] text-gray-500 mt-1">Salah input atau ganda? Tarik pengajuan ini — hanya bisa sebelum ada yang menyetujui. Sudah ada yang menyetujui: minta Finance membatalkan.</p>
					{:else}
						<h4>🚫 Tarik pengajuan ini?</h4>
						<p class="text-[12px] text-gray-600 mb-2">Antrean approval ditutup dan status menjadi Dibatalkan. Nomor & riwayat tetap tersimpan.</p>
						<textarea bind:value={tarikReason} rows="2" placeholder="Alasan penarikan (min. 10 karakter)..." class="w-full px-3 py-2 border border-gray-300 rounded-lg text-[13px]"></textarea>
						<div class="flex gap-2 mt-2">
							<button class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer disabled:opacity-50 border-gray-300 text-gray-600 hover:bg-gray-50" onclick={() => { showTarik = false; tarikReason = ''; }}>Batal</button>
							<button class="px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer disabled:opacity-50 bg-red-600 border-red-600 text-white hover:bg-red-700" disabled={tarikBusy || tarikReason.trim().length < 10} title="Isi alasan minimal 10 karakter" onclick={tarikPengajuan}>{tarikBusy ? 'Menarik...' : 'Konfirmasi Tarik'}</button>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Fase 3 Bagian D: kenapa pengajuan saya belum cair -->
			{#if budget.status === 'Pending' && !belumMasukAntrean}
				<div class="card-section no-print {terlambatSla ? 'border-amber-200 bg-amber-50/40' : ''}">
					<h4>⏳ Kenapa pengajuan ini belum cair</h4>
					<div class="text-[12px] text-gray-600 space-y-1">
						<p>Tahap sekarang: <strong class="text-gray-800">{budget.current_stage || 'belum diketahui'}</strong></p>
						<p>Sudah menunggu: <strong class="text-gray-800">{umurPendingHari ?? '-'} hari</strong>{#if slaHariKerja !== null} (SLA {slaHariKerja} hari kerja){/if}</p>
						{#if terlambatSla}
							<p class="text-amber-600 font-medium mt-1">⚠ Melewati SLA — wajar bila Anda menanyakan langsung ke tahap di atas.</p>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Rincian -->
			<div class="card-section">
				<h4><IconListNumbers size={16} class="text-[var(--p)]" /> Rincian pengajuan</h4>

				{#if budget.nama_pengaju}
					<div class="flex justify-between py-2 border-b border-gray-100 text-[12px]">
						<span class="text-gray-400">Pengaju</span>
						<span class="font-medium text-gray-700">{budget.nama_pengaju}</span>
					</div>
				{/if}
				{#if budget.payment_method}
					<div class="flex justify-between py-2 border-b border-gray-100 text-[12px]">
						<span class="text-gray-400">Metode Bayar</span>
						<span class="font-medium text-gray-700">{budget.payment_method}</span>
					</div>
				{/if}
				{#if budget.penerima_dana_nama}
					<div class="flex justify-between py-2 border-b border-gray-100 text-[12px]">
						<span class="text-gray-400">Penerima</span>
						<span class="font-medium text-gray-700">{budget.penerima_dana_nama}</span>
					</div>
				{/if}
				{#if budget.bank_name}
					<div class="flex justify-between py-2 border-b border-gray-100 text-[12px]">
						<span class="text-gray-400">Bank</span>
						<span class="font-medium text-gray-700">{budget.bank_name} - {budget.bank_account_number}</span>
					</div>
				{/if}

				<div class="bg-[var(--pl)] rounded-xl p-3 flex justify-between items-center mt-2.5">
					<span class="text-[12px] font-semibold text-[var(--pd)]">Total</span>
					<strong class="text-[17px] font-semibold text-[var(--pd)]">{formatCurrency(budget.total_amount || 0)}</strong>
				</div>
			</div>

			<!-- Items list -->
			{#if budgetItems && budgetItems.length > 0}
				<div class="card-section">
					<h4><IconListNumbers size={16} class="text-[var(--p)]" /> Pos Rincian Anggaran</h4>
					<div class="space-y-3">
						{#each budgetItems as item}
							<div class="border-b border-gray-100 pb-2.5 last:border-none last:pb-0">
								<div class="flex justify-between items-start">
									<div class="flex-1 min-w-0 pr-2">
										<p class="text-[13px] font-semibold text-gray-800 break-words">{item.deskripsi}</p>
										<p class="text-[11px] text-gray-400 mt-1 flex flex-wrap gap-x-1.5 gap-y-0.5 items-center">
											<span class="px-1.5 py-0.5 bg-blue-50 text-[var(--p)] rounded text-[10px] font-semibold">
												{getItemCategoryLabel(item.kategori_item)}
											</span>
											<span class="text-gray-300">·</span>
											<span>Satuan: {item.units || '-'}</span>
											<span class="text-gray-300">·</span>
											<span>Qty: {item.quantity || 0}</span>
											{#if item.vendor_name}
												<span class="text-gray-300">·</span>
												<span>Vendor: {item.vendor_name}</span>
											{/if}
										</p>
									</div>
									<div class="text-right shrink-0">
										<p class="text-[11px] text-gray-400">{formatCurrency(item.harga || 0)}</p>
										<p class="text-[12px] font-semibold text-[var(--pd)] mt-0.5">{formatCurrency(item.total || 0)}</p>
									</div>
								</div>
								{#if item.notes}
									<p class="text-[11px] text-gray-500 bg-gray-50 p-2 rounded mt-1.5 italic">Catatan: {item.notes}</p>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- R5 — Rantai Persetujuan NYATA (dari admin): di meja siapa sekarang -->
			{#if realChain?.steps?.length}
				<div class="card-section">
					<h4><IconListNumbers size={16} class="text-[var(--p)]" /> Rantai Persetujuan</h4>
					{#if activeApproverName}
						<p class="text-[12px] text-gray-600 mb-2">
							Sekarang menunggu keputusan: <strong class="text-gray-900">{activeApproverName}</strong>
							{#if activeStepWaitHariKerja != null}
								<span class="text-gray-400">— sejak {activeStepWaitHariKerja} hari kerja</span>
							{/if}
						</p>
						{#if approvalP50P90}
							<p class="text-[11px] text-gray-400 mb-2">
								Biasanya {approvalP50P90.p50 < 24 ? `${approvalP50P90.p50} jam` : `${Math.round(approvalP50P90.p50 / 24)} hari`} (P50), paling lama {approvalP50P90.p90 < 24 ? `${approvalP50P90.p90} jam` : `${Math.round(approvalP50P90.p90 / 24)} hari`} (P90) — dari 30 hari terakhir lintas modul.
							</p>
						{/if}
						{#if isPengaju && budget?.approval_request_id}
							<button
								type="button"
								onclick={kirimIngatkan}
								disabled={ingatkanSubmitting || (ingatkanDisabledUntil != null && Date.now() < ingatkanDisabledUntil)}
								class="mt-1 mb-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-[var(--p)] text-[var(--p)] disabled:opacity-40 disabled:cursor-not-allowed"
							>
								{ingatkanSubmitting ? 'Mengirim…' : 'Ingatkan Approver'}
							</button>
							{#if ingatkanMsg}
								<p class="text-[11px] text-gray-500 mb-2">{ingatkanMsg}</p>
							{/if}
						{/if}
					{:else if realChain.status === 'approved'}
						<p class="text-[12px] text-[var(--ggd)] mb-2">Semua tahap persetujuan selesai.</p>
					{:else if realChain.status === 'rejected'}
						<p class="text-[12px] text-[var(--red)] mb-2">Pengajuan ditolak.</p>
					{:else if realChain.status === 'returned'}
						<p class="text-[12px] text-[var(--amd)] mb-2">Dikembalikan untuk revisi.</p>
					{/if}
					<ol class="space-y-1.5">
						{#each realChain.steps as s, i}
							{@const st = String(s.status || '').toLowerCase()}
							<li class="flex gap-2.5 items-start">
								<div class="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold
									{['disetujui', 'approved'].includes(st) ? 'bg-[var(--gg)] text-[var(--ggd)]'
										: ['ditolak', 'rejected'].includes(st) ? 'bg-[var(--rel)] text-[var(--red)]'
										: ['dikembalikan', 'returned'].includes(st) ? 'bg-amber-100 text-amber-700'
										: ['dilewati', 'skipped'].includes(st) ? 'bg-gray-100 text-gray-400'
										: st === 'menunggu' && i === (realChain.steps.findIndex((x: any) => String(x.status || '').toLowerCase() === 'menunggu')) ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
										: 'bg-gray-100 text-gray-400'}">
									{['disetujui', 'approved'].includes(st) ? '✓' : ['ditolak', 'rejected'].includes(st) ? '✕' : ['dikembalikan', 'returned'].includes(st) ? '↩' : ['dilewati', 'skipped'].includes(st) ? '–' : i + 1}
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-[13px] font-medium text-gray-800 truncate">{s.label || `Tahap ${i + 1}`}</p>
									<p class="text-[11px] text-gray-400">
										{s.status || 'menunggu'}{s.actor_name ? ` · ${s.actor_name}` : ''}{s.date ? ` · ${formatDate(s.date)}` : ''}
									</p>
									{#if s.note}
										<p class="text-[11px] text-gray-500 italic mt-0.5">"{s.note}"</p>
									{/if}
								</div>
							</li>
						{/each}
					</ol>
					<p class="text-[10px] text-gray-300 mt-2">Data langsung dari sistem approval admin.</p>
				</div>
			{/if}

			<!-- Timeline -->
			<div class="card-section">
				<h4><IconTimeline size={16} class="text-[var(--p)]" /> Proses pengajuan</h4>

				<!-- Step 1: Diajukan -->
				<div class="flex gap-3 items-start py-2.5 border-b border-gray-100">
					<div class="w-7 h-7 rounded-full bg-[var(--gg)] flex items-center justify-center shrink-0">
						<IconCheck size={14} class="text-[var(--ggd)]" />
					</div>
					<div>
						<p class="text-[13px] font-medium text-gray-800">Diajukan oleh {budget.nama_pengaju || 'Leader'}</p>
						<p class="text-[11px] text-gray-400">{formatDate(budget.date_created)}</p>
					</div>
				</div>

				<!-- Step 2: Project Finance Verification -->
				<div class="flex gap-3 items-start py-2.5 border-b border-gray-100">
					{#if isPfRejected}
						<div class="w-7 h-7 rounded-full bg-[var(--rel)] flex items-center justify-center shrink-0">
							<IconX size={14} class="text-[var(--red)]" />
						</div>
						<div class="flex-1">
							<p class="text-[13px] font-medium text-[var(--red)]">Ditolak Project Finance</p>
							{#if budget.project_finance_approved_by}
								<p class="text-[11px] text-gray-500">
									Oleh: {budget.project_finance_approved_by}
									{#if budget.project_finance_approved_date}· {formatDate(budget.project_finance_approved_date)}{/if}
								</p>
							{/if}
							{#if budget.reject_reason}
								<div class="mt-1.5 bg-red-50 border border-red-100 rounded-lg p-2.5">
									<p class="text-[11px] font-semibold text-red-600 mb-0.5">Alasan penolakan:</p>
									<p class="text-[12px] text-red-700">{budget.reject_reason}</p>
								</div>
							{/if}
						</div>
					{:else}
						{#if isPfApproved}
							<div class="w-7 h-7 rounded-full bg-[var(--gg)] flex items-center justify-center shrink-0">
								<IconCheck size={14} class="text-[var(--ggd)]" />
							</div>
							<div>
								<p class="text-[13px] font-medium text-gray-800">Disetujui Project Finance</p>
								<p class="text-[11px] text-gray-400">
									{#if budget.project_finance_approved_by}
										Oleh: {budget.project_finance_approved_by}
									{/if}
									{#if budget.project_finance_approved_date}
										· {formatDate(budget.project_finance_approved_date)}
									{/if}
									{#if budget.jumlah_disetujui}
										· Disetujui: {formatCurrency(budget.jumlah_disetujui)}
									{/if}
								</p>
							</div>
						{:else}
							<div class="w-7 h-7 rounded-full bg-[var(--aml)] flex items-center justify-center shrink-0">
								<IconClock size={14} class="text-[var(--amd)]" />
							</div>
							<div>
								<p class="text-[13px] font-medium text-gray-500">Menunggu Project Finance</p>
								<p class="text-[11px] text-gray-400">Belum diproses</p>
							</div>
						{/if}
					{/if}
				</div>

				<!-- Step 3: Diproses Finance -->
				<div class="flex gap-3 items-start py-2.5 border-b border-gray-100 {isPfApproved ? '' : 'opacity-30'}">
					{#if isDisbursed || isDiproses}
						<div class="w-7 h-7 rounded-full bg-[var(--gg)] flex items-center justify-center shrink-0">
							<IconCheck size={14} class="text-[var(--ggd)]" />
						</div>
					{:else}
						<div class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
							<IconClock size={14} class="text-gray-400" />
						</div>
					{/if}
					<div>
						<p class="text-[13px] font-medium {isDisbursed || isDiproses ? 'text-gray-800' : 'text-gray-500'}">Diproses Finance</p>
						<p class="text-[11px] text-gray-400">
							{#if isDisbursed}Sudah selesai diproses Finance
							{:else if isDiproses}Sedang diproses Finance, menunggu jadwal pembayaran
							{:else}Menunggu diproses setelah disetujui{/if}
						</p>
					</div>
				</div>

				<!-- Step 4: Dibayarkan -->
				<div class="flex gap-3 items-start py-2.5 border-b border-gray-100 {isPfApproved ? '' : 'opacity-30'}">
					{#if isDisbursed}
						<div class="w-7 h-7 rounded-full bg-[var(--gg)] flex items-center justify-center shrink-0">
							<IconCheck size={14} class="text-[var(--ggd)]" />
						</div>
						<div class="flex-1">
							<p class="text-[13px] font-medium text-gray-800">Dibayarkan</p>
							<p class="text-[11px] text-gray-400">
								Dana telah ditransfer
								{#if budget.jumlah_disetujui}
									(Disetujui: {formatCurrency(budget.jumlah_disetujui)})
								{/if}
								{#if budget.tanggal_dicairkan || budget.finance_processed_date}
									· {formatDate(budget.tanggal_dicairkan || budget.finance_processed_date)}
								{/if}
							</p>
							{#if loadingBukti}
								<p class="text-[11px] text-gray-400 mt-1">Memuat bukti transfer…</p>
							{:else if buktiBayar?.bukti_bayar}
								<a
									href="#"
									use:secureAssetHref={buktiBayar.bukti_bayar}
									target="_blank"
									rel="noopener"
									class="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--p)] mt-1 hover:underline"
								>
									📎 Lihat Bukti Transfer
								</a>
							{:else if buktiBayar}
								<p class="text-[11px] text-gray-400 mt-1">Bukti transfer belum diunggah Finance.</p>
							{/if}
						</div>
					{:else}
						<div class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
							<IconClock size={14} class="text-gray-400" />
						</div>
						<div>
							<p class="text-[13px] text-gray-500">Dibayarkan</p>
							{#if budget.kategori_belanja === 'rilis_hutang' && payableQueueStatus}
								{#if payableQueueStatus.payment_urgency === 'urgent' || payableQueueStatus.scheduled_payment_date}
									<p class="text-[11px] text-purple-600 font-medium mt-0.5">
										📅 Masuk antrian bayar
										{#if payableQueueStatus.scheduled_payment_date}
											— dijadwalkan {formatDate(payableQueueStatus.scheduled_payment_date)}
										{:else}
											— ditandai mendesak, menunggu rapat rencana bayar mingguan
										{/if}
									</p>
								{:else}
									<p class="text-[11px] text-gray-400">Menunggu masuk antrian rencana bayar mingguan Finance</p>
								{/if}
							{:else}
								<p class="text-[11px] text-gray-400">Menunggu transfer dari finance</p>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Step 5: Dana Diterima (konfirmasi pengaju) -->
				<div class="flex gap-3 items-start py-2.5 {isDisbursed ? '' : 'opacity-30'}">
					{#if danaDiterimaAt}
						<div class="w-7 h-7 rounded-full bg-[var(--gg)] flex items-center justify-center shrink-0">
							<IconCheck size={14} class="text-[var(--ggd)]" />
						</div>
						<div>
							<p class="text-[13px] font-medium text-gray-800">Dana Diterima</p>
							<p class="text-[11px] text-gray-400">Dikonfirmasi {formatDate(danaDiterimaAt)}</p>
						</div>
					{:else if isDisbursed}
						<div class="w-7 h-7 rounded-full bg-[var(--aml)] flex items-center justify-center shrink-0">
							<IconClock size={14} class="text-[var(--amd)]" />
						</div>
						<div class="flex-1">
							<p class="text-[13px] font-medium text-gray-700">Dana Diterima</p>
							<p class="text-[11px] text-gray-400 mb-1.5">Sudah cek rekening? Konfirmasi di sini.</p>
							<button
								type="button"
								class="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white flex items-center gap-1.5 disabled:opacity-60"
								style="background: var(--g)"
								onclick={handleConfirmDana}
								disabled={confirmingDana}
							>
								{#if confirmingDana}<IconLoader2 size={13} class="animate-spin" />{:else}<IconCheck size={13} />{/if}
								{confirmingDana ? 'Mengirim...' : 'Konfirmasi Terima Dana'}
							</button>
						</div>
					{:else}
						<div class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
							<IconClock size={14} class="text-gray-400" />
						</div>
						<div>
							<p class="text-[13px] text-gray-500">Dana Diterima</p>
						</div>
					{/if}
				</div>

				<!-- Step 6: Dibukukan (Rekomendasi Section 4 — status pembukuan terlihat pengaju) -->
				<div class="flex gap-3 items-start py-2.5 border-t border-gray-100 {isDisbursed ? '' : 'opacity-30'}">
					{#if isDibukukan}
						<div class="w-7 h-7 rounded-full bg-[var(--gg)] flex items-center justify-center shrink-0">
							<IconCheck size={14} class="text-[var(--ggd)]" />
						</div>
						<div>
							<p class="text-[13px] font-medium text-gray-800">Dibukukan</p>
							<p class="text-[11px] text-gray-400">
								Diakui masuk pos laporan keuangan
								{#if budget.dibukukan_date}· {formatDate(budget.dibukukan_date)}{/if}
								{#if budget.dibukukan_by}· oleh {budget.dibukukan_by}{/if}
							</p>
						</div>
					{:else}
						<div class="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
							<IconClock size={14} class="text-gray-400" />
						</div>
						<div>
							<p class="text-[13px] text-gray-500">Dibukukan</p>
							<p class="text-[11px] text-gray-400">Menunggu pembukuan Manager Finance</p>
						</div>
					{/if}
				</div>
			</div>

			<!-- R6 — Unggah SPJ dari lokasi -->
			{#if canSubmitSpj}
				<div class="card-section no-print">
					<h4><IconListNumbers size={16} class="text-[var(--p)]" /> Pertanggungjawaban (SPJ)</h4>
					{#if spjCountdown}
						<div class="mb-2 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold {spjCountdown.terlambat ? 'bg-[var(--red)]/10 text-[var(--red)]' : spjCountdown.sisaHari <= 3 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-600'}">
							{#if spjCountdown.terlambat}
								Terlambat {-spjCountdown.sisaHari} hari — segera unggah SPJ.
							{:else}
								Batas SPJ {SPJ_BATAS_HARI_DEFAULT} hari, sisa {spjCountdown.sisaHari} hari.
							{/if}
						</div>
					{/if}
					<p class="text-[12px] text-gray-500 mb-2">
						Dana sudah cair. Unggah foto bon/nota/kwitansi selagi di lokasi — tidak perlu dikumpulkan dulu.
					</p>
					<input type="file" accept="image/*,application/pdf" multiple capture="environment" onchange={onSpjPick}
						class="block w-full text-[12px] text-gray-600 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-gray-300 file:bg-gray-50 file:text-gray-700" />
					{#if spjFiles.length}
						<ul class="mt-2 space-y-1">
							{#each spjFiles as f, i}
								<li class="flex items-center gap-2 text-[12px] bg-gray-50 rounded-lg px-2.5 py-1.5">
									<span class="flex-1 truncate">{f.name}</span>
									<button type="button" class="text-[var(--red)]" onclick={() => removeSpjFile(i)}>Hapus</button>
								</li>
							{/each}
						</ul>
					{/if}
					<textarea bind:value={spjCatatan} rows="2" placeholder="Catatan (opsional)"
						class="mt-2 block w-full text-[12px] rounded-lg border border-gray-300 px-2.5 py-2"></textarea>
					<input type="number" min="0" bind:value={spjSisaDana} placeholder="Sisa dana dikembalikan (opsional)"
						class="mt-2 block w-full text-[12px] rounded-lg border border-gray-300 px-2.5 py-2" />
					{#if spjMsg}
						<p class="mt-2 text-[12px] {spjMsg.includes('terkirim') ? 'text-[var(--ggd)]' : 'text-[var(--red)]'}">{spjMsg}</p>
					{/if}
					<button type="button" onclick={submitSpj} disabled={spjSubmitting}
						class="mt-3 w-full py-2.5 rounded-xl bg-[var(--p)] text-white text-[13px] font-semibold disabled:opacity-50">
						{spjSubmitting ? 'Mengirim…' : 'Kirim Pertanggungjawaban'}
					</button>
				</div>
			{:else if budget && isDisbursed && isPengaju && SPJ_DONE.includes(String(budget.status_pertanggungjawaban || '').toLowerCase())}
				<div class="card-section no-print">
					<h4><IconListNumbers size={16} class="text-[var(--p)]" /> Pertanggungjawaban (SPJ)</h4>
					<p class="text-[12px] text-[var(--ggd)]">
						{String(budget.status_pertanggungjawaban).toLowerCase() === 'selesai' || String(budget.status_pertanggungjawaban).toLowerCase() === 'diverifikasi'
							? 'SPJ sudah diverifikasi Finance.'
							: 'SPJ sudah dikirim — menunggu verifikasi Finance.'}
					</p>
				</div>
			{/if}

			{#if budget.comments}
				<div class="card-section">
					<h4>Keterangan</h4>
					<p class="text-[13px] text-gray-600">{budget.comments}</p>
				</div>
			{/if}

			<!-- Fase 5 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — admin mengembalikan
			     PA ini karena syarat gate belum lengkap. BUKAN penolakan: status tetap Pending,
			     Anda bisa melengkapi lalu klik "Cek Ulang" di kartu Syarat Pengajuan di bawah. -->
			{#if budget.gate_return_requested}
				<div class="card-section no-print">
					<div class="p-2.5 rounded-lg bg-amber-50 border border-amber-200">
						<p class="text-[12px] font-semibold text-amber-800">↩️ Pengajuan Ini Dikembalikan — Lengkapi Datanya</p>
						{#if budget.gate_return_reason}
							<p class="text-[12px] text-amber-700 mt-1">{budget.gate_return_reason}</p>
						{/if}
						{#if budget.gate_return_by}
							<p class="text-[10px] text-amber-500 mt-1">
								Oleh {budget.gate_return_by}
								{#if budget.gate_return_date}
									· {new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(budget.gate_return_date))}
								{/if}
							</p>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Fase 4 Lapangan #5 (Penajaman Pengajuan Anggaran v2, 18 Agu 2026): interlocking_gates
			     sudah tersimpan per record sejak lama -- murni pekerjaan tampilan, nol query baru
			     (budget sudah dimuat penuh lewat getPengajuanById). -->
			{#if Array.isArray(budget.interlocking_gates) && budget.interlocking_gates.length > 0}
				<div class="card-section no-print">
					<h4 class="flex items-center gap-2">
						<span>🚦</span> Syarat yang Menahan Pengajuan Ini
						{#if budget.kategori_belanja}
							<span class="text-[10px] font-normal px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{budget.kategori_belanja}</span>
						{/if}
					</h4>
					{#if budget.interlocking_status === 'blocked' && budget.status === 'Pending'}
						<div class="mt-1 mb-2 rounded-lg bg-red-50 border border-red-200 px-2.5 py-2 text-[12px] text-red-700">
							Pengajuan ini tertahan karena ada syarat WAJIB yang belum terpenuhi (tanda 🔴 di bawah). Lengkapi datanya lalu klik <strong>Cek Ulang</strong> — snapshot ini bisa basi bila Anda baru saja melengkapi data.
						</div>
					{/if}
					<button type="button" onclick={recheckGates} disabled={rechecking}
						class="mb-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-[var(--p)] text-[var(--p)] text-[12px] font-semibold disabled:opacity-50">
						{#if rechecking}
							<IconLoader2 size={14} class="animate-spin" /> Mengecek ulang…
						{:else}
							🔄 Cek Ulang
						{/if}
					</button>
					{#if recheckMsg}
						<p class="mb-2 text-[12px] {budget.interlocking_status === 'blocked' ? 'text-[var(--red)]' : 'text-[var(--ggd)]'}">{recheckMsg}</p>
					{/if}
					<div class="grid grid-cols-1 gap-1.5 mt-1">
						{#each budget.interlocking_gates as g (g.gate_key)}
							{@const link = g.status === 'failed' ? gateLinkFor(g) : null}
							<div class="flex items-start gap-1.5 text-[12px]">
								<span>{g.status === 'passed' ? '✅' : g.status === 'not_applicable' ? '⚪' : isDeferredGate(g) ? '🕓' : g.severity === 'WAJIB' ? '🔴' : '🟡'}</span>
								<div class="min-w-0">
									<span class="text-gray-600"><strong class="text-gray-800">{g.gate_key} — {g.label}:</strong> {g.message}</span>
									{#if g.status === 'failed' && isDeferredGate(g)}
										<em class="block text-[11px] text-slate-500">Ditangani {deferredHandlerLabel(g)} saat tahapnya tiba.</em>
									{/if}
									{#if g.gate_key === 'G_BAP_BORONGAN' && g.status === 'failed' && !isDeferredGate(g)}
										<button type="button" onclick={() => (bapDialogOpen = true)}
											class="mt-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white">
											📷 Unggah BAP sekarang
										</button>
									{/if}
									{#if link}
										<a href={link.href} class="block text-[11px] text-[var(--p)] font-medium hover:underline mt-0.5">→ {link.label}</a>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Riwayat Aktivitas -->
			<div class="card-section no-print">
				<button
					class="w-full flex items-center justify-between"
					onclick={() => { showAudit = !showAudit; if (showAudit) loadAuditLog(); }}
				>
					<h4 class="!mb-0 flex items-center gap-2">
						<span>📋</span> Riwayat Perubahan
					</h4>
					<span class="text-[12px]" style="color: var(--sys-label3)">{showAudit ? '▲ Sembunyikan' : '▼ Lihat'}</span>
				</button>
				{#if showAudit}
					<div class="mt-3">
						{#if auditLoading}
							<div class="flex items-center gap-2 py-4 justify-center">
								<IconLoader2 size={16} class="animate-spin" style="color: var(--p)" />
								<span class="text-[12px]" style="color: var(--sys-label3)">Memuat riwayat...</span>
							</div>
						{:else if auditLog.length === 0}
							<p class="text-[12px] text-center py-4" style="color: var(--sys-label3)">Belum ada riwayat perubahan tercatat.</p>
						{:else}
							<div class="space-y-2">
								{#each auditLog as entry}
									<div class="flex gap-2.5 items-start py-2 border-b border-gray-100 last:border-none">
										<span class="text-base leading-none mt-0.5 shrink-0">{getActionIcon(entry.action)}</span>
										<div class="flex-1 min-w-0">
											<p class="text-[12px] font-medium" style="color: var(--sys-label)">
												{getActionLabel(entry.action)}
												{#if entry.user}<span class="font-normal text-[11px]" style="color: var(--sys-label3)"> oleh {entry.user}</span>{/if}
											</p>
											{#if entry.comment}
												<p class="text-[11px] mt-0.5 italic" style="color: var(--sys-label3)">{entry.comment}</p>
											{/if}
										</div>
										<span class="text-[10px] shrink-0" style="color: var(--sys-label3)">
											{new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(entry.timestamp))}
										</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Approval action (Finance role only, while status is pending) -->
			{#if canApprove}
				<div class="card-section no-print">
					<h4 class="!text-green-700"><IconCheck size={16} class="text-green-600" /> Aksi Approval</h4>
					<p class="text-[12px] text-gray-500 mb-3">Sebagai Project Finance, Anda dapat menyetujui atau menolak pengajuan ini.</p>
					<div class="flex gap-2">
						<button
							class="flex-1 py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
							style="background: var(--g); color: white;"
							onclick={() => { approveAmount = String(budget.total_amount || ''); showApproveDialog = true; }}
						>
							<IconThumbUp size={16} /> Setujui
						</button>
						<button
							class="flex-1 py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
							style="background: var(--re); color: white;"
							onclick={() => { rejectReason = ''; showRejectDialog = true; }}
						>
							<IconThumbDown size={16} /> Tolak
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Fitur Cetak Pengajuan Pra-Finance (Fase 3): hint edukatif status cetak dokumen resmi -->
		{#if budget && !['Completed', 'Selesai', 'Dibukukan', 'Rejected'].includes(budget.status)}
			<div class="mx-4 mb-3 no-print">
				{#if readyForPaperPrint}
					<div class="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-[12.5px] text-blue-800 flex items-start gap-2">
						<IconPrinter size={16} class="mt-0.5 shrink-0" />
						<span>Pengajuan telah disetujui Manajer. Silakan cetak Lembar Disposisi Fisik untuk diserahkan ke Finance.</span>
					</div>
				{:else}
					<div class="rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-[12.5px] text-gray-500 flex items-start gap-2">
						<IconPrinter size={16} class="mt-0.5 shrink-0" />
						<span>Belum bisa dicetak — menunggu persetujuan Manajer{activeApproverName ? ` (${activeApproverName})` : ''}.</span>
					</div>
				{/if}
			</div>
		{/if}

		<div class="bottom-bar shadow-[0_-2px_10px_rgba(0,0,0,0.04)] no-print">
			<div class="flex gap-2">
				<!-- Cetak Lembar Disposisi Fisik — reaktif terhadap status manajer (R3, bukan
				     window.print() mentah lagi). Tetap KLIKABEL walau belum siap (Aturan #6:
				     jangan disable tombol aksi utama tanpa alternatif) — klik saat belum siap
				     menampilkan alasan yang sama dengan banner di atas, bukan mencetak diam-diam. -->
				<button
					class="py-2.5 px-4 border rounded-xl text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-gray-50 transition-all shrink-0 {readyForPaperPrint ? 'border-blue-300 text-blue-700 bg-blue-50' : 'border-gray-200 text-gray-400'}"
					title={readyForPaperPrint ? 'Cetak Lembar Disposisi Fisik' : `Belum bisa dicetak — menunggu persetujuan Manajer${activeApproverName ? ` (${activeApproverName})` : ''}`}
					onclick={() => {
						if (!readyForPaperPrint) {
							showToast(`Belum bisa dicetak — menunggu persetujuan Manajer${activeApproverName ? ` (${activeApproverName})` : ''}.`, 'err');
							return;
						}
						handleCetakResmi();
					}}
				>
					<IconPrinter size={16} /> Cetak
				</button>

				<!-- Slip Ringkas: teks-saja 80mm, ringan untuk sinyal lemah & printer thermal/bluetooth. Selalu tersedia. -->
				<button
					class="py-2.5 px-4 border border-gray-200 rounded-xl text-gray-500 text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-gray-50 transition-all shrink-0"
					title="Cetak slip ringkas (80mm, teks saja) — bukan dokumen disposisi resmi"
					onclick={handleCetakSlip}
				>
					🧾 Slip
				</button>

				<!-- Download PDF (rekomendasi: Mode Ringkas Mobile & Offline-Tolerant) — alternatif
				     kalau tidak ada printer fisik di lokasi, atau untuk dibagikan lewat WA/email. -->
				{#if readyForPaperPrint}
					<button
						class="py-2.5 px-4 border border-gray-200 rounded-xl text-gray-500 text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-gray-50 transition-all shrink-0 disabled:opacity-50"
						disabled={downloadingPdf}
						onclick={handleDownloadPdf}
					>
						{#if downloadingPdf}
							<IconLoader2 size={16} class="animate-spin" />
						{:else}
							<IconDownload size={16} />
						{/if}
						PDF
					</button>
				{/if}

				<!-- L4 — Duplikat: salin isian ke pengajuan baru (cocok untuk operasional bulanan) -->
				<button
					class="py-2.5 px-4 border border-gray-200 rounded-xl text-gray-500 text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-gray-50 transition-all shrink-0"
					title="Buat pengajuan baru dengan isian disalin dari pengajuan ini"
					onclick={() => goto(`/anggaran/baru?duplikat=${id}`)}
				>
					<IconCopy size={16} /> Duplikat
				</button>

				<!-- Edit/Batalkan hanya untuk pengajuan yang belum diproses Finance & belum ditolak.
				     Sebelumnya cek ini hanya membandingkan 'Selesai'/'Verified'/'Ditolak', sehingga
				     pengajuan 'Completed' (sudah dibayar) & 'Rejected' masih bisa diedit/dibatalkan. -->
				{#if !isBudgetFinanceApproved(budget.status) && !isBudgetRejected(budget.status)}
					<button
						class="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-500 text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-gray-50 transition-all"
						onclick={() => { if(confirm('Batalkan pengajuan ini?')) alert('Pengajuan dibatalkan'); }}
					>
						<IconX size={16} /> Batalkan
					</button>
					<button
						class="flex-1 py-2.5 bg-[var(--p)] text-white border-none rounded-xl text-[13px] font-medium flex items-center justify-center gap-1.5 cursor-pointer active:bg-[var(--pd)] transition-all"
						onclick={() => goto(`/anggaran/${id}/edit`)}
					>
						<IconEdit size={16} /> Edit
					</button>
				{:else if isBudgetPaid(budget.status)}
					<div class="flex-1 text-center text-[12px] text-gray-400 font-semibold py-2">
						Dana telah dicairkan
					</div>
				{:else if isBudgetFinanceApproved(budget.status)}
					<div class="flex-1 text-center text-[12px] text-gray-400 font-semibold py-2">
						Pengajuan telah diproses
					</div>
				{:else if isBudgetRejected(budget.status)}
					<div class="flex-1 text-center text-[12px] text-[var(--re)] font-semibold py-2">
						Pengajuan telah ditolak
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Toast notification -->
{#if toastMsg}
	<div
		class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-xl text-[13px] font-medium text-white shadow-lg transition-all no-print"
		style="background: {toastType === 'ok' ? 'var(--g)' : 'var(--re)'}"
	>
		{toastMsg}
	</div>
{/if}

<!-- Approve dialog -->
{#if showApproveDialog}
	<div
		class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 no-print"
		role="dialog"
		aria-modal="true"
		onclick={(e) => { if (e.target === e.currentTarget) showApproveDialog = false; }}
	>
		<div class="w-full sm:w-[360px] bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl">
			<p class="text-[15px] font-semibold text-gray-800 mb-1">Setujui Pengajuan</p>
			<p class="text-[12px] text-gray-500 mb-4">Total diajukan: <strong>{budget ? formatCurrency(budget.total_amount || 0) : '-'}</strong></p>

			<label class="block text-[12px] font-medium text-gray-600 mb-1.5">
				Jumlah Disetujui (opsional)
			</label>
			<input
				type="text"
				class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] mb-4 outline-none focus:border-[var(--p)]"
				placeholder="Biarkan kosong = full amount"
				bind:value={approveAmount}
				oninput={(e) => { approveAmount = (e.target as HTMLInputElement).value; }}
			/>

			<div class="flex gap-2">
				<button
					class="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-500 text-[13px] font-medium"
					onclick={() => (showApproveDialog = false)}
					disabled={approving}
				>
					Batal
				</button>
				<button
					class="flex-1 py-2.5 rounded-xl text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-60"
					style="background: var(--g)"
					onclick={handleApprove}
					disabled={approving}
				>
					{#if approving}<IconLoader2 size={15} class="animate-spin" />{:else}<IconCheck size={15} />{/if}
					{approving ? 'Memproses...' : 'Konfirmasi Setujui'}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Reject dialog -->
{#if showRejectDialog}
	<div
		class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 no-print"
		role="dialog"
		aria-modal="true"
		onclick={(e) => { if (e.target === e.currentTarget) showRejectDialog = false; }}
	>
		<div class="w-full sm:w-[360px] bg-white rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl">
			<p class="text-[15px] font-semibold text-gray-800 mb-1">Tolak Pengajuan</p>
			<p class="text-[12px] text-gray-500 mb-4">Alasan penolakan akan ditampilkan kepada pengaju.</p>

			<label class="block text-[12px] font-medium text-gray-600 mb-1.5">
				Alasan Penolakan <span class="text-[var(--re)]">*</span>
			</label>
			<textarea
				class="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-[13px] mb-4 outline-none focus:border-[var(--re)] resize-none h-24"
				placeholder="Jelaskan alasan penolakan..."
				bind:value={rejectReason}
			></textarea>

			<div class="flex gap-2">
				<button
					class="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-500 text-[13px] font-medium"
					onclick={() => (showRejectDialog = false)}
					disabled={rejecting}
				>
					Batal
				</button>
				<button
					class="flex-1 py-2.5 rounded-xl text-white text-[13px] font-semibold flex items-center justify-center gap-1.5 transition-all disabled:opacity-60"
					style="background: var(--re)"
					onclick={handleReject}
					disabled={rejecting || !rejectReason.trim()}
				>
					{#if rejecting}<IconLoader2 size={15} class="animate-spin" />{:else}<IconX size={15} />{/if}
					{rejecting ? 'Memproses...' : 'Konfirmasi Tolak'}
				</button>
			</div>
		</div>
	</div>
{/if}

<PdfBlobViewer
	src={pdfBlob}
	title={pdfTitle}
	show={showPdfPreview}
	onClose={() => {
		showPdfPreview = false;
		pdfBlob = null;
	}}
/>

<GateFixBapBorongan
	open={bapDialogOpen}
	projectId={typeof budget?.project_id === 'object' ? budget.project_id?.id : budget?.project_id}
	onClose={() => (bapDialogOpen = false)}
	onSuccess={() => recheckGates()}
/>

<style>
	@media print {
		:global(.tb),
		:global(.bottom-bar),
		:global(.no-print) {
			display: none !important;
		}
		:global(.scroll-body) {
			overflow: visible !important;
			height: auto !important;
			padding-bottom: 0 !important;
		}
		:global(.card-section) {
			break-inside: avoid;
			page-break-inside: avoid;
		}
		.print-only {
			display: block !important;
		}
	}

	.print-only {
		display: none;
	}
</style>
