<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		getProjectContractSummary, getProjectContractTermins, retentionDaysRemaining,
		submitAddendumRequest, TERMIN_STATUS_CONFIG,
		getSubcontractorPerformance, getProjectBaDocuments, getOverdueBastTermins,
		getBastRequestsForTermins, requestBAST,
		type ProjectContractSummary, type ProjectContractTermin, type SubcontractorPerformance, type ProjectBaDocument
	} from '$lib/services/projectContract';
	import { getPreviewUrl } from '$lib/services/dokumenApi';
	import {
		getActiveBillingBlocks, uploadBastFollowupProof, penyebabLabel,
		type ProjectBillingBlock
	} from '$lib/services/projectBillingBlock';
	import { estimateNextTerminThreshold, type NextTerminEstimate } from '$lib/utils/estimateNextTerminThreshold';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import { authStore } from '$lib/stores/auth';
	import { get } from 'svelte/store';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import {
		fetchMilestonePhotos, uploadMilestonePhotoFile, createMilestonePhoto, deleteMilestonePhoto,
		type MilestonePhoto, type MilestonePhotoType
	} from '$lib/services/projectMilestonePhotosApi';
	import { loadProjectSettings, getProjectSetting } from '$lib/services/projectSettings';
	import { fetchB2BStatusForProjects, type B2BTerminStatusRow } from '$lib/services/b2bStatusApi';

	let { project }: { project: any } = $props();

	let contract = $state<ProjectContractSummary | null>(null);
	let termins = $state<ProjectContractTermin[]>([]);
	let loading = $state(true);
	let sisaRetensi = $state<number | null>(null);
	let mitraList = $state<SubcontractorPerformance[]>([]);

	// Target Termin Berikutnya + checklist kesiapan BA — Timeline Termin Pembayaran,
	// Cashflow Inflow & Forecast Terpadu v2, Fase 4 (lapangan, 17 Sep 2026). TANPA Rupiah
	// (Aturan lapangan). WARN-ONLY: tombol Ajukan BA tetap aktif walau checklist merah
	// (Aturan #6 — dilarang mematikan tombol aksi utama tanpa alternatif).
	let nextTermin = $state<NextTerminEstimate | null>(null);
	let laporanHarian7HariCount = $state<number | null>(null); // null = belum dicek/gagal

	// Rencana B2B Payment — Fase 2 (Dashboard Lapangan, 3 Okt 2026). READ-ONLY, TANPA rupiah
	// & TANPA nama vendor/subkon (keputusan Lead, Q5) — hanya status hold/release per termin.
	let b2bByTermin = $state<Record<string, B2BTerminStatusRow>>({});
	const B2B_HOLD_LABEL: Record<string, { label: string; cls: string }> = {
		waiting_client: { label: '🔒 Ditahan', cls: 'bg-amber-50 text-amber-700' },
		partial_released: { label: '◐ Sebagian Dirilis', cls: 'bg-blue-50 text-blue-700' },
		released: { label: '✅ Dirilis', cls: 'bg-green-50 text-green-700' }
	};

	// Status BA (Auto-Generate BA — Fase 3, 16 Agustus 2026) — VIEW-ONLY. Generate tetap lewat
	// Admin ERP (mesin jsPDF/Document Generator sengaja tidak diduplikasi ke Lapangan).
	let baDocuments = $state<ProjectBaDocument[]>([]);
	let overdueBaTerminIds = $state<Set<number>>(new Set());
	function baDocForTermin(t: ProjectContractTermin): ProjectBaDocument | null {
		if (!t.ba_document_output_id) return null;
		return baDocuments.find((d) => d.generator_output_id === t.ba_document_output_id) || null;
	}

	// Fase 4 Finance Hardening (18 Agu 2026) — R7/R14: tombol "Ajukan Pembuatan BA" untuk termin
	// yang sudah lewat ambang tapi BA belum ada. bapRequestByTermin dibaca ulang tiap load() supaya
	// tombol berubah jadi status begitu sudah pernah diajukan (tidak dobel submit).
	let bapRequestByTermin = $state<Record<string, { id: number; status: string }>>({});
	let requestingTermin = $state<ProjectContractTermin | null>(null);
	let requestNotes = $state('');
	let requestHasStandby = $state(false);
	let requestStandbyType = $state('standby');
	let requestStandbyNotes = $state('');
	let requestTargetDate = $state('');
	let requestSubmitting = $state(false);
	let requestError = $state('');

	const BAP_REQUEST_STATUS_LABEL: Record<string, string> = {
		requested: 'Diajukan, menunggu Finance',
		submitted: 'Diproses Finance',
		draft: 'Sedang disusun Finance',
		approved: 'BA disetujui',
		rejected: 'BA ditolak',
		cancelled: 'BA dibatalkan'
	};
	function bapRequestCls(status: string): string {
		if (status === 'approved') return 'color: var(--sys-positive, #16a34a)';
		if (status === 'rejected' || status === 'cancelled') return 'color: var(--sys-negative, #dc2626)';
		return 'color: var(--p)';
	}

	async function submitRequestBA() {
		if (!requestingTermin) return;
		requestSubmitting = true;
		requestError = '';
		try {
			const extra = requestHasStandby ? {
				dispositionType: requestStandbyType,
				standbyNotes: requestStandbyNotes.trim() || 'Standby operasional site',
				targetDate: requestTargetDate || undefined
			} : undefined;

			await requestBAST(project.id, String(requestingTermin.id), requestNotes.trim(), extra);
			bapRequestByTermin[String(requestingTermin.id)] = { id: 0, status: 'requested' };
			requestingTermin = null;
			requestNotes = '';
			requestHasStandby = false;
			requestStandbyNotes = '';
			requestTargetDate = '';
		} catch (e: any) {
			requestError = e?.message || 'Gagal mengajukan BA';
		} finally {
			requestSubmitting = false;
		}
	}

	const SUPPLIER_STATUS_LABELS: Record<string, string> = { aktif: 'Aktif', hold: 'Hold', blacklist: 'Blacklist' };
	const SUPPLIER_STATUS_CLS: Record<string, string> = {
		aktif: 'bg-green-100 text-green-700',
		hold: 'bg-amber-100 text-amber-700',
		blacklist: 'bg-red-100 text-red-700'
	};

	let showForm = $state(false);
	let submitting = $state(false);
	let form = $state({ jenisPerubahan: 'jadwal' as 'jadwal' | 'judul_scope' | 'lainnya', alasan: '', proposedValue: '' });

	// §7 FL2/FL4 — Klaim Tersandera (Penajaman Sistem AR v2, Fase 7, 26 Agu 2026). Read-only,
	// TANPA nominal — Leader tahu ADA masalah, tidak perlu tahu angka labanya.
	let billingBlocks = $state<ProjectBillingBlock[]>([]);
	let holdBlock = $derived(billingBlocks.find((b) => b.keputusan === 'hold' || b.keputusan === 'stop') ?? null);

	// §7 FL3 — upload bukti pengiriman BAST
	let uploadingTerminId = $state<string | null>(null);
	let uploadChannel = $state<'wa' | 'email' | 'visit' | 'other'>('wa');
	let uploadContactPerson = $state('');
	let uploadFile = $state<File | null>(null);
	let uploadBusy = $state(false);
	let uploadError = $state('');

	// Fase 3 Dokumentasi Foto (27 Sep 2026) — foto before/during/after per termin. WARN-only,
	// belum wajib (masa sosialisasi) — lihat gate G_TERMIN_FOTO_WAJIB di admin ERP.
	const MILESTONE_SLOTS: { key: MilestonePhotoType; label: string; hint: string }[] = [
		{ key: 'before', label: 'Before', hint: 'Kondisi sebelum pekerjaan termin ini dimulai' },
		{ key: 'during', label: 'During', hint: 'Progres pekerjaan berlangsung (opsional)' },
		{ key: 'after', label: 'After', hint: 'Hasil akhir setelah pekerjaan termin ini selesai' }
	];
	let milestonePhotoTerminId = $state<string | null>(null);
	let milestonePhotos = $state<MilestonePhoto[]>([]);
	let milestonePhotoLoading = $state(false);
	let milestonePhotoBusySlot = $state<MilestonePhotoType | null>(null);
	let milestonePhotoError = $state('');

	async function toggleMilestonePhotoPanel(terminId: number) {
		const key = String(terminId);
		if (milestonePhotoTerminId === key) {
			milestonePhotoTerminId = null;
			return;
		}
		milestonePhotoTerminId = key;
		milestonePhotoLoading = true;
		milestonePhotoError = '';
		try {
			milestonePhotos = await fetchMilestonePhotos({
				projectId: project.id, milestoneType: 'termin', milestoneRef: terminId, milestoneSystem: 'project_contract_termin'
			});
		} finally {
			milestonePhotoLoading = false;
		}
	}

	function milestonePhotosFor(slotKey: MilestonePhotoType): MilestonePhoto[] {
		return milestonePhotos.filter((p) => p.photo_type === slotKey);
	}

	async function handleMilestonePhotoUpload(terminId: number, slotKey: MilestonePhotoType, event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		milestonePhotoBusySlot = slotKey;
		milestonePhotoError = '';
		try {
			const fileId = await uploadMilestonePhotoFile(file, `Milestone termin #${terminId} — ${slotKey}`);
			if (!fileId) throw new Error('Upload tidak mengembalikan ID file');
			await createMilestonePhoto({
				projectId: project.id, milestoneType: 'termin', milestoneRef: terminId, milestoneSystem: 'project_contract_termin',
				photoType: slotKey, fileId, uploadedBy: get(authStore).karyawanId || null
			});
			milestonePhotos = await fetchMilestonePhotos({
				projectId: project.id, milestoneType: 'termin', milestoneRef: terminId, milestoneSystem: 'project_contract_termin'
			});
		} catch (e) {
			milestonePhotoError = (e as Error).message || 'Gagal mengunggah foto.';
		} finally {
			milestonePhotoBusySlot = null;
			target.value = '';
		}
	}

	async function handleMilestonePhotoDelete(terminId: number, photo: MilestonePhoto) {
		if (!confirm('Hapus foto ini?')) return;
		try {
			await deleteMilestonePhoto(photo.id);
			milestonePhotos = await fetchMilestonePhotos({
				projectId: project.id, milestoneType: 'termin', milestoneRef: terminId, milestoneSystem: 'project_contract_termin'
			});
		} catch (e) {
			alert((e as Error).message || 'Gagal menghapus foto.');
		}
	}

	async function handleUploadProof(terminId: string) {
		if (!uploadFile) { uploadError = 'Pilih foto/screenshot dulu.'; return; }
		uploadBusy = true;
		uploadError = '';
		try {
			await uploadBastFollowupProof({
				projectId: project.id,
				terminId,
				channel: uploadChannel,
				contactPerson: uploadContactPerson,
				file: uploadFile
			});
			uploadingTerminId = null;
			uploadFile = null;
			uploadContactPerson = '';
			alert('Bukti pengiriman BAST berhasil diunggah.');
		} catch (e) {
			uploadError = (e as Error).message;
		} finally {
			uploadBusy = false;
		}
	}

	function formatDate(dateStr: string | null | undefined): string {
		if (!dateStr) return '-';
		try {
			return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateStr));
		} catch {
			return '-';
		}
	}

	onMount(load);

	async function load() {
		loading = true;
		contract = await getProjectContractSummary(project.id);
		if (contract) {
			termins = await getProjectContractTermins(contract.id);
			sisaRetensi = retentionDaysRemaining(contract);
			baDocuments = await getProjectBaDocuments(project.id);
			overdueBaTerminIds = new Set(getOverdueBastTermins(project, termins).map((t) => t.id));
			bapRequestByTermin = await getBastRequestsForTermins(termins.map((t) => String(t.id)));
		}
		mitraList = await getSubcontractorPerformance(project.id);
		billingBlocks = await getActiveBillingBlocks(project.id);
		loading = false;

		if (contract && termins.length > 0) {
			await loadProjectSettings();
			if (getProjectSetting('project.b2b.enabled') === true) {
				const rows = await fetchB2BStatusForProjects([{ id: project.id, name: project.name }]);
				b2bByTermin = Object.fromEntries(rows.map((r) => [String(r.termin_id), r]));
			}
		}

		if (contract) {
			nextTermin = estimateNextTerminThreshold(project, termins);
			await loadLaporanHarian7Hari();
		}
	}

	/** Hitung berapa dari 7 hari terakhir yang punya Laporan Harian terisi (koleksi `reports`). */
	async function loadLaporanHarian7Hari() {
		try {
			const sevenDaysAgo = new Date();
			sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); // termasuk hari ini = 7 hari
			const sevenDaysAgoStr = sevenDaysAgo.toISOString().slice(0, 10);
			const rows = (await directus.request(
				readItems('reports', {
					filter: { project_id: { _eq: project.id }, date: { _gte: sevenDaysAgoStr } },
					fields: ['date'],
					limit: -1
				})
			)) as any[];
			laporanHarian7HariCount = new Set(rows.map((r) => r.date)).size;
		} catch (e) {
			console.error('[ProjectKontrakPanel] Gagal memuat Laporan Harian 7 hari:', e);
			laporanHarian7HariCount = null;
		}
	}

	/**
	 * Checklist kesiapan BA (warn-only — Aturan #6, tidak mematikan tombol Ajukan BA).
	 * TANPA nilai kontrak/margin (Aturan lapangan). Item yang belum bisa diverifikasi
	 * (mis. gate foto before/after belum live) ditandai netral, bukan dipaksa hijau/merah.
	 */
	function baReadinessChecklist(t: ProjectContractTermin) {
		const progresOk = overdueBaTerminIds.has(t.id);
		const laporanOk = laporanHarian7HariCount !== null ? laporanHarian7HariCount >= 5 : null; // >=5/7 hari, toleransi akhir pekan
		const tidakAdaBlokir = !holdBlock && billingBlocks.length === 0;
		return [
			{ label: `Progres ≥ ambang (${t.progress_trigger_pct ?? '?'}%)`, ok: progresOk },
			{ label: 'Laporan harian 7 hari terakhir terisi', ok: laporanOk, note: laporanOk === null ? 'gagal memuat' : (laporanHarian7HariCount != null ? `${laporanHarian7HariCount}/7 hari` : '') },
			{ label: 'Foto before/after ada', ok: null, note: 'gate belum aktif — dicek manual dulu' },
			{ label: 'Tidak ada tagihan tertahan/hold', ok: tidakAdaBlokir }
		];
	}

	async function submitForm() {
		if (!contract || !form.alasan.trim()) return;
		submitting = true;
		try {
			await submitAddendumRequest({
				projectId: project.id,
				contractId: contract.id,
				jenisPerubahan: form.jenisPerubahan,
				alasan: form.alasan,
				proposedValue: form.proposedValue
			});
			showForm = false;
			form = { jenisPerubahan: 'jadwal', alasan: '', proposedValue: '' };
			alert('Pengajuan amandemen berhasil dikirim ke Admin/Legal.');
		} catch (e) {
			alert('Gagal mengajukan: ' + (e as Error).message);
		} finally {
			submitting = false;
		}
	}
</script>

<div class="px-4 py-4 flex flex-col gap-3">
	{#if loading}
		<CircularProgressGauge size={48} strokeWidth={4} label="Memuat kontrak proyek..." />
	{:else if !contract}
		<div class="px-4 py-8 text-center">
			<div class="text-4xl mb-3">📄</div>
			<p class="text-[14px] font-semibold" style="color: var(--sys-label)">Kontrak</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Kontrak proyek ini belum terdaftar di Admin ERP.</p>
		</div>
	{:else}
		<!-- §7 FL4 — Spanduk status hold/stop (Penajaman Sistem AR v2, Fase 7) -->
		{#if holdBlock}
			<div class="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200">
				<p class="text-[12px] font-semibold text-red-700">
					🚫 Proyek ini sedang {holdBlock.keputusan === 'stop' ? 'DIHENTIKAN' : 'DITAHAN'} sejak {formatDate(holdBlock.tanggal_hak_lahir)}
					karena {holdBlock.keputusan_alasan || 'alasan tidak tercatat'}.
				</p>
				{#if holdBlock.tinjau_ulang_tanggal}
					<p class="text-[11px] text-red-600 mt-0.5">Tinjauan berikutnya: {formatDate(holdBlock.tinjau_ulang_tanggal)}.</p>
				{/if}
			</div>
		{/if}

		<!-- §7 FL2 — Kartu Tagihan Tertahan, read-only tanpa nominal -->
		{#if billingBlocks.length > 0 && !holdBlock}
			<div class="card-section">
				<h4 class="text-[13px] font-semibold mb-2" style="color: var(--sys-label)">🔒 Tagihan Tertahan</h4>
				<p class="text-[11px] mb-2" style="color: var(--sys-label3)">
					Nilai pekerjaan yang haknya sudah lahir tapi belum bisa ditagih. Angka ini tidak masuk laporan piutang — itulah sebabnya perlu dipantau.
				</p>
				{#each billingBlocks as b (b.id)}
					<div class="text-[12px] py-1" style="color: var(--sys-label)">
						• {penyebabLabel(b.penyebab)} (sejak {formatDate(b.tanggal_hak_lahir)})
					</div>
				{/each}
			</div>
		{/if}

		<!-- Ringkasan -->
		<div class="card-section">
			<h4 class="text-[13px] font-semibold mb-3" style="color: var(--sys-label)">Ringkasan Kontrak</h4>
			<div class="grid grid-cols-2 gap-3 text-[13px]">
				<div>
					<div class="text-[11px]" style="color: var(--sys-label3)">Tanggal Mulai</div>
					<div style="color: var(--sys-label)">{formatDate(project.start_date)}</div>
				</div>
				<div>
					<div class="text-[11px]" style="color: var(--sys-label3)">Tanggal Berakhir</div>
					<div style="color: var(--sys-label)">{formatDate(project.end_date)}</div>
				</div>
				<div>
					<div class="text-[11px]" style="color: var(--sys-label3)">Status DP</div>
					<div style="color: var(--sys-label)">{contract.dp_status || '-'}</div>
				</div>
				{#if contract.bast_final_date}
					<div>
						<div class="text-[11px]" style="color: var(--sys-label3)">Retensi</div>
						<div style="color: var(--sys-label)">
							{sisaRetensi !== null ? `${sisaRetensi} hari lagi` : '-'}
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Target Termin Berikutnya (Fase 4 lapangan, TANPA Rupiah) -->
		{#if nextTermin}
			<div class="card-section">
				<h4 class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">🎯 Target Termin Berikutnya</h4>
				<p class="text-[13px]" style="color: var(--sys-label)">
					Ambang {nextTermin.thresholdPct}% · progres sekarang {nextTermin.currentPct.toFixed(1)}%
					{#if nextTermin.daysEstimate !== null}
						· perkiraan tercapai ~{nextTermin.daysEstimate} hari lagi
					{/if}
				</p>
				<p class="text-[11px] mt-1" style="color: var(--sys-label3)">{nextTermin.reason}</p>
			</div>
		{/if}

		<!-- Termin -->
		{#if termins.length > 0}
			<div class="card-section">
				<h4 class="text-[13px] font-semibold mb-3" style="color: var(--sys-label)">Progress Termin</h4>
				<div class="flex flex-col gap-2">
					{#each termins as t (t.id)}
						{@const baDoc = baDocForTermin(t)}
						{@const bapRequest = bapRequestByTermin[String(t.id)]}
						<div class="flex flex-col gap-1">
							<div class="flex items-center justify-between text-[13px]">
								<span style="color: var(--sys-label)">{t.label || `Termin ${t.urutan}`}</span>
								<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold {TERMIN_STATUS_CONFIG[t.status]?.cls || 'bg-gray-100 text-gray-500'}">
									{TERMIN_STATUS_CONFIG[t.status]?.label || t.status}
								</span>
							</div>
							{#if baDoc}
								<a
									href={getPreviewUrl(baDoc.file_id || '')}
									target="_blank"
									rel="noopener noreferrer"
									class="text-[11px] font-medium"
									style="color: var(--p)"
								>
									📄 {baDoc.nama_dokumen} — Unduh BA
								</a>
							{:else if bapRequest}
								<!-- Audit kesesuaian engine BAST (20 Agu 2026): status BAST (collection `bast`,
								     dibaca via getBastRequestsForTermins) HARUS tampil terlepas dari overdueBaTerminIds
								     — sebelumnya cuma tampil selama termin dianggap "overdue"; begitu status termin
								     maju (mis. bast_signed/billed), BAST yang sudah approved jadi tidak terlihat lagi. -->
								<div class="text-[11px] font-medium" style={bapRequestCls(bapRequest.status)}>
									✅ {BAP_REQUEST_STATUS_LABEL[bapRequest.status] || bapRequest.status}
								</div>

								<!-- §7 FL3 — bukti pengiriman BAST, hanya relevan selama menunggu TTD pelanggan -->
								{#if ['requested', 'submitted'].includes(bapRequest.status)}
									{#if uploadingTerminId === String(t.id)}
										<div class="flex flex-col gap-1.5 px-2 py-1.5 rounded-lg bg-blue-50 border border-blue-200">
											<select bind:value={uploadChannel} class="text-[11px] border rounded px-2 py-1">
												<option value="wa">WhatsApp</option>
												<option value="email">Email</option>
												<option value="visit">Kunjungan langsung</option>
												<option value="other">Lainnya</option>
											</select>
											<input type="text" bind:value={uploadContactPerson} placeholder="Nama PIC pelanggan (opsional)" class="text-[11px] border rounded px-2 py-1" />
											<input type="file" accept="image/*" onchange={(e) => (uploadFile = (e.currentTarget.files || [])[0] || null)} class="text-[11px]" />
											{#if uploadError}<p class="text-[10px] text-red-600">{uploadError}</p>{/if}
											<div class="flex gap-2">
												<button onclick={() => handleUploadProof(String(t.id))} disabled={uploadBusy} class="flex-1 text-[11px] font-semibold text-white py-1.5 rounded" style="background: var(--p)">
													{uploadBusy ? 'Mengunggah...' : 'Simpan Bukti'}
												</button>
												<button onclick={() => (uploadingTerminId = null)} class="text-[11px] px-2" style="color: var(--sys-label3)">Batal</button>
											</div>
										</div>
									{:else}
										<button
											onclick={() => (uploadingTerminId = String(t.id))}
											class="text-[11px] font-medium text-left"
											style="color: var(--p)"
										>
											📎 Unggah bukti pengiriman BAST ke pelanggan
										</button>
									{/if}
								{/if}
							{:else if overdueBaTerminIds.has(t.id)}
								{@const checklist = baReadinessChecklist(t)}
								<div class="flex flex-col gap-1.5 px-2 py-1.5 rounded-lg bg-red-50 border border-red-200">
									<div class="text-[11px] font-medium text-red-700">
										⚠️ Progres fisik sudah capai ambang wajib-BA ({t.progress_trigger_pct}%) — BA belum digenerate.
									</div>

									<!-- Checklist kesiapan BA — WARN-ONLY, tidak memblokir tombol (Aturan #6). -->
									<div class="flex flex-col gap-0.5 px-2 py-1.5 rounded bg-white/70">
										{#each checklist as item}
											<div class="flex items-center gap-1.5 text-[11px]">
												<span>{item.ok === true ? '✅' : item.ok === false ? '🔴' : '⚪'}</span>
												<span style="color: var(--sys-label)">{item.label}</span>
												{#if item.note}<span style="color: var(--sys-label3)">({item.note})</span>{/if}
											</div>
										{/each}
									</div>
									<p class="text-[10px]" style="color: var(--sys-label3)">
										Checklist ini tidak memblokir. Item merah = kemungkinan BA dikembalikan Finance.
									</p>

									{#if requestingTermin?.id === t.id}
										<div class="mt-2 flex flex-col gap-2 p-2.5 rounded-lg border border-blue-200 bg-blue-50/70 dark:bg-blue-950/20 text-[11px]">
											<div class="font-semibold text-blue-900 dark:text-blue-200">
												Pengajuan BA ke Admin/Finance
											</div>
											<input
												type="text"
												bind:value={requestNotes}
												placeholder="Catatan untuk Finance (opsional)"
												class="w-full text-[11px] px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
											/>

											<label class="flex items-center gap-2 cursor-pointer font-medium text-gray-700 dark:text-gray-300">
												<input type="checkbox" bind:checked={requestHasStandby} class="rounded text-blue-600" />
												<span>Ada alat / personil yang masih standby di site?</span>
											</label>

											{#if requestHasStandby}
												<div class="flex flex-col gap-1.5 pl-3 border-l-2 border-blue-300">
													<label class="text-[10px] text-gray-500 font-medium">Jenis Disposisi:</label>
													<select
														bind:value={requestStandbyType}
														class="w-full text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
													>
														<option value="standby">Testing &amp; Commissioning (Standby Resmi)</option>
														<option value="transferred">Alih Tugas / Estafet ke Proyek Baru</option>
														<option value="waiver">Kendala Gate Pass / Izin Keluar Pabrik</option>
													</select>
													<input
														type="text"
														bind:value={requestStandbyNotes}
														placeholder="Rincian alat / personil yang standby..."
														class="w-full text-[11px] px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
													/>
													<div class="flex items-center gap-2">
														<span class="text-[10px] text-gray-500 whitespace-nowrap">Tenggat s/d:</span>
														<input
															type="date"
															bind:value={requestTargetDate}
															class="text-[11px] px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800"
														/>
													</div>
												</div>
											{/if}

											{#if requestError}
												<p class="text-[10px] text-red-600">{requestError}</p>
											{/if}

											<div class="flex items-center gap-2 pt-1">
												<button
													onclick={submitRequestBA}
													disabled={requestSubmitting}
													class="flex-1 py-1.5 rounded-lg text-white font-semibold text-center transition disabled:opacity-50"
													style="background: var(--p)"
												>
													{requestSubmitting ? 'Mengirim...' : 'Kirim Pengajuan BA'}
												</button>
												<button
													onclick={() => { requestingTermin = null; requestError = ''; }}
													disabled={requestSubmitting}
													class="px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 text-center"
												>
													Batal
												</button>
											</div>
										</div>
									{:else}
										<button
											onclick={() => { requestingTermin = t; requestError = ''; }}
											class="text-[11px] font-semibold text-center py-1.5 rounded-lg"
											style="background: var(--pl); color: var(--p)"
										>
											Ajukan Pembuatan BA
										</button>
									{/if}
								</div>
							{/if}

							<!-- Rencana B2B Payment, Fase 2 (3 Okt 2026) — status hold/release, TANPA rupiah &
							     TANPA nama vendor/subkon (keputusan Lead). Hanya tampil bila ada item di-link. -->
							{#if b2bByTermin[String(t.id)]?.items?.length}
								{@const b2b = b2bByTermin[String(t.id)]}
								<div class="flex flex-col gap-1 px-2 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200">
									<div class="text-[11px] font-medium text-indigo-700">
										🔗 Back-to-Back: {b2b.items.length} item terkait
										{#if b2b.waitingCount > 0}· {b2b.waitingCount} ditahan{/if}
										{#if b2b.partialCount > 0}· {b2b.partialCount} sebagian{/if}
										{#if b2b.releasedCount > 0}· {b2b.releasedCount} dirilis{/if}
									</div>
									{#each b2b.items as item}
										{@const cfg = B2B_HOLD_LABEL[item.hold_status || ''] || { label: '—', cls: 'bg-gray-100 text-gray-500' }}
										<div class="flex items-center justify-between text-[11px]">
											<span style="color: var(--sys-label3)">• {item.label}</span>
											<span class="px-1.5 py-0.5 rounded-full {cfg.cls}">{cfg.label}</span>
										</div>
									{/each}
									{#if b2b.waitingCount > 0}
										<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">
											💡 Item yang ditahan akan otomatis terbuka begitu termin ini dinyatakan lunas oleh Finance.
										</p>
										<!-- Rekomendasi B5 "Payment Timeline Visual" (4 Okt 2026) — estimasi hari berdasar
										     laju progres aktual (estimateNextTerminThreshold, sudah ada sejak Fase 4
										     Cashflow Timeline lapangan). TANPA rupiah, murni perkiraan waktu. -->
										{#if nextTermin && t.status === 'not_started' && t.progress_trigger_pct === nextTermin.thresholdPct}
											<p class="text-[10px]" style="color: var(--p)">
												⏱️ {#if nextTermin.daysEstimate != null}
													Estimasi termin ini tercapai ~{nextTermin.daysEstimate} hari lagi — item di atas diperkirakan cair sekitar itu.
												{:else}
													{nextTermin.reason}
												{/if}
											</p>
										{/if}
									{/if}
								</div>
							{/if}

							<!-- Fase 3 Dokumentasi Foto (27 Sep 2026) — before/during/after per termin, WARN-only. -->
							<button
								onclick={() => toggleMilestonePhotoPanel(t.id)}
								class="text-[11px] font-medium text-left"
								style="color: var(--p)"
							>
								📷 {milestonePhotoTerminId === String(t.id) ? 'Tutup Foto Milestone' : 'Foto Milestone (before/during/after)'}
							</button>
							{#if milestonePhotoTerminId === String(t.id)}
								<div class="flex flex-col gap-2 px-2 py-2 rounded-lg bg-white/70 border" style="border-color: var(--sys-separator)">
									{#if milestonePhotoLoading}
										<p class="text-[11px] text-center py-2" style="color: var(--sys-label3)">Memuat…</p>
									{:else}
										{#if milestonePhotoError}
											<p class="text-[10.5px] text-red-600">{milestonePhotoError}</p>
										{/if}
										{#each MILESTONE_SLOTS as slot}
											<div class="flex flex-col gap-1">
												<div class="flex items-center justify-between">
													<span class="text-[11px] font-semibold" style="color: var(--sys-label)">{slot.label}</span>
													<span class="text-[10px]" style="color: var(--sys-label3)">{slot.hint}</span>
												</div>
												{#if milestonePhotosFor(slot.key).length > 0}
													<div class="grid grid-cols-3 gap-1.5">
														{#each milestonePhotosFor(slot.key) as photo}
															<div class="relative aspect-square border rounded-lg overflow-hidden" style="border-color: var(--sys-separator)">
																<img use:secureAssetSrc={photo.file_id} alt={slot.label} class="w-full h-full object-cover" />
																<button
																	class="absolute top-1 right-1 w-5 h-5 bg-black/50 text-white rounded-full flex items-center justify-center text-[10px]"
																	onclick={() => handleMilestonePhotoDelete(t.id, photo)}
																>✕</button>
															</div>
														{/each}
													</div>
												{/if}
												<label class="block border border-dashed rounded-lg p-2 text-center cursor-pointer text-[10.5px]" style="border-color: var(--sys-separator); color: var(--sys-label3)">
													{milestonePhotoBusySlot === slot.key ? 'Mengunggah…' : `+ Tambah foto ${slot.label}`}
													<input type="file" accept="image/*" class="hidden" disabled={milestonePhotoBusySlot !== null} onchange={(e) => handleMilestonePhotoUpload(t.id, slot.key, e)} />
												</label>
											</div>
										{/each}
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- R10: Mitra/Subkontraktor Terkait -->
		{#if mitraList.length > 0}
			<div class="card-section">
				<h4 class="text-[13px] font-semibold mb-3" style="color: var(--sys-label)">Mitra/Subkontraktor Terkait</h4>
				<div class="flex flex-col gap-2.5">
					{#each mitraList as m (m.contractJudul + (m.namaMitra || ''))}
						<div class="flex flex-col gap-1">
							<div class="flex items-center justify-between text-[13px]">
								<span style="color: var(--sys-label)">{m.namaMitra || m.contractJudul}</span>
								{#if m.supplierStatus}
									<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold {SUPPLIER_STATUS_CLS[m.supplierStatus] || 'bg-gray-100 text-gray-500'}">
										{SUPPLIER_STATUS_LABELS[m.supplierStatus] || m.supplierStatus}
									</span>
								{/if}
							</div>
							<div class="flex items-center justify-between text-[11px]" style="color: var(--sys-label3)">
								<span>{m.skorTotal != null ? `Skor: ${m.skorTotal.toFixed(0)}` : 'Skor belum dihitung'}</span>
								<span>Kontrak berakhir: {formatDate(m.tanggalBerakhir)}</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Ajukan Addendum -->
		<div class="card-section">
			{#if !showForm}
				<button
					onclick={() => (showForm = true)}
					class="w-full text-[13px] font-semibold text-center py-2 rounded-lg"
					style="background: var(--pl); color: var(--p)"
				>
					Ajukan Perubahan (Addendum)
				</button>
			{:else}
				<h4 class="text-[13px] font-semibold mb-2" style="color: var(--sys-label)">Ajukan Perubahan</h4>
				<div class="flex flex-col gap-2">
					<select bind:value={form.jenisPerubahan} class="text-[13px] border rounded-lg px-2 py-1.5">
						<option value="jadwal">Perubahan Jadwal</option>
						<option value="judul_scope">Perubahan Judul/Scope</option>
						<option value="lainnya">Lainnya</option>
					</select>
					{#if form.jenisPerubahan === 'jadwal'}
						<input type="date" bind:value={form.proposedValue} class="text-[13px] border rounded-lg px-2 py-1.5" placeholder="Tanggal berakhir baru" />
					{:else if form.jenisPerubahan === 'judul_scope'}
						<input type="text" bind:value={form.proposedValue} class="text-[13px] border rounded-lg px-2 py-1.5" placeholder="Judul baru" />
					{/if}
					<textarea bind:value={form.alasan} rows="3" class="text-[13px] border rounded-lg px-2 py-1.5" placeholder="Alasan pengajuan..."></textarea>
					<div class="flex gap-2">
						<button
							onclick={submitForm}
							disabled={submitting}
							class="flex-1 text-[13px] font-semibold text-white py-2 rounded-lg"
							style="background: var(--p)"
						>
							{submitting ? 'Mengirim...' : 'Kirim Pengajuan'}
						</button>
						<button onclick={() => (showForm = false)} class="text-[13px] px-3 py-2" style="color: var(--sys-label3)">
							Batal
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
