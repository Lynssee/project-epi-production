<!--
  ProjectHandoverBriefingCard.svelte
  Kartu Paket Serah Terima (Handover Briefing Pack) untuk Leader Baru di aplikasi lapangan (project-epi).
  Svelte 5 Runes ($props, $state, $derived).
-->
<script lang="ts">
	import type { DelegationInfo } from '$lib/services/plDelegation';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { getPreviewUrl } from '$lib/services/dokumenApi';
	import IconCheck from '@tabler/icons-svelte/icons/check';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconInfoCircle from '@tabler/icons-svelte/icons/info-circle';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import IconDownload from '@tabler/icons-svelte/icons/download';
	import IconFileCheck from '@tabler/icons-svelte/icons/file-check';
	import IconChevronDown from '@tabler/icons-svelte/icons/chevron-down';
	import IconChevronUp from '@tabler/icons-svelte/icons/chevron-up';

	let {
		delegationInfo = $bindable(),
		project,
		onackUpdated
	}: {
		delegationInfo: DelegationInfo;
		project: any;
		onackUpdated?: (detail: { status: string; catatan?: string }) => void;
	} = $props();

	let isExpanded = $state(false);
	let ackBusy = $state(false);
	let showKendalaForm = $state(false);
	let kendalaMode = $state<'kendala' | 'pendamping'>('kendala');
	let kendalaCatatan = $state('');
	let errorMessage = $state('');
	let successToast = $state('');

	const fk = $derived(delegationInfo.faktor_keputusan);
	const progressPct = $derived(fk?.handover_progress_pct ?? Number(project?.progress || project?.persentase_selesai || 0));
	const volumeDetail = $derived(fk?.handover_volume || '');
	const checklist = $derived(fk?.checklist || { progress: true, material: true, equipment: true, akses: true });
	const baFileId = $derived(fk?.ba_file_id || null);
	const baFileName = $derived(fk?.ba_file_name || 'Berita_Acara_Handover.pdf');

	function formatDate(dateStr: string | null | undefined): string {
		if (!dateStr) return '-';
		try {
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return dateStr;
			return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
		} catch {
			return String(dateStr);
		}
	}

	async function submitAck(status: 'diterima' | 'kendala' | 'pendamping') {
		if (status !== 'diterima' && !kendalaCatatan.trim()) {
			errorMessage = 'Catatan kendala / permintaan wajib diisi.';
			return;
		}

		ackBusy = true;
		errorMessage = '';
		try {
			const token = await getIdToken();
			const res = await fetch('/api/project/delegasi-ack', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					delegationLogId: delegationInfo.id,
					status,
					catatan: status !== 'diterima' ? kendalaCatatan.trim() : ''
				})
			});

			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);

			delegationInfo.ack_status = status;
			delegationInfo.ack_catatan = status !== 'diterima' ? kendalaCatatan.trim() : null;

			successToast = status === 'diterima' ? 'Penugasan proyek berhasil diterima!' : 'Laporan kendala berhasil dikirim ke admin.';
			setTimeout(() => { successToast = ''; }, 4000);

			showKendalaForm = false;
			kendalaCatatan = '';
			onackUpdated?.({ status, catatan: delegationInfo.ack_catatan || undefined });
		} catch (err: any) {
			console.error('[ProjectHandoverBriefingCard] ACK error:', err);
			errorMessage = err?.message || 'Gagal memproses konfirmasi.';
		} finally {
			ackBusy = false;
		}
	}
</script>

<div class="mb-4 overflow-hidden rounded-2xl border border-orange-200 bg-white shadow-xs dark:border-orange-900/50 dark:bg-slate-900">
	<!-- Top Accent Bar -->
	<div class="h-1.5 w-full bg-gradient-to-r from-orange-500 via-amber-500 to-emerald-500"></div>

	<!-- Header Card -->
	<div class="p-4 sm:p-5">
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-start gap-3">
				<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-xl text-orange-600 dark:bg-orange-950/60 dark:text-orange-400">
					🤝
				</div>
				<div>
					<div class="flex flex-wrap items-center gap-2">
						<h3 class="text-sm font-bold text-slate-900 dark:text-white">
							Paket Serah Terima Proyek (Handover Briefing)
						</h3>
						{#if delegationInfo.ack_status === 'diterima'}
							<span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
								<IconCheck size={12} /> Diterima
							</span>
						{:else if delegationInfo.ack_status === 'kendala'}
							<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
								<IconAlertTriangle size={12} /> Ada Kendala
							</span>
						{:else if delegationInfo.ack_status === 'pendamping'}
							<span class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
								<IconInfoCircle size={12} /> Minta Pendamping
							</span>
						{:else}
							<span class="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 animate-pulse">
								Perlu Konfirmasi Terima
							</span>
						{/if}
					</div>
					<p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
						Diserahkan oleh <span class="font-semibold text-slate-800 dark:text-slate-200">{delegationInfo.leader_lama_nama || 'Leader Demisioner'}</span>
						{#if delegationInfo.tanggal_efektif}
							• Efektif sejak {formatDate(delegationInfo.tanggal_efektif)}
						{/if}
					</p>
				</div>
			</div>

			<button
				type="button"
				class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
				onclick={() => (isExpanded = !isExpanded)}
				title={isExpanded ? 'Tutup rincian' : 'Buka rincian'}
			>
				{#if isExpanded}
					<IconChevronUp size={18} />
				{:else}
					<IconChevronDown size={18} />
				{/if}
			</button>
		</div>

		<!-- Ringkasan Progres & Catatan Singkat -->
		<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
			<div class="rounded-xl bg-orange-50/60 p-2.5 dark:bg-orange-950/20">
				<span class="text-[10px] font-semibold uppercase tracking-wider text-orange-700 dark:text-orange-400">Progres Capaian</span>
				<p class="mt-0.5 text-base font-bold text-orange-600 dark:text-orange-300">{progressPct}%</p>
			</div>
			<div class="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/40">
				<span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Volume Terpasang</span>
				<p class="mt-0.5 truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{volumeDetail || 'Sesuai SPK'}</p>
			</div>
			<div class="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/40">
				<span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Surat Tugas</span>
				<p class="mt-0.5 truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{delegationInfo.surat_tugas_nomor || 'ST Transisi'}</p>
			</div>
			<div class="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/40">
				<span class="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Dokumen BA</span>
				<p class="mt-0.5 truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{baFileId ? 'Tersedia' : 'Catatan Saja'}</p>
			</div>
		</div>

		<!-- Detail Rincian (Collapsible) -->
		{#if isExpanded}
			<div class="mt-4 space-y-3.5 border-t border-slate-100 pt-3.5 text-xs text-slate-700 dark:border-slate-800 dark:text-slate-300">
				<!-- Alasan / Pesan Lapangan -->
				{#if delegationInfo.alasan}
					<div class="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/30">
						<span class="font-bold text-slate-800 dark:text-slate-200">Catatan & Arahan Kantor:</span>
						<p class="mt-1 text-slate-600 dark:text-slate-300">{delegationInfo.alasan}</p>
					</div>
				{/if}

				<!-- Checklist Serah Terima -->
				<div>
					<span class="font-bold text-slate-800 dark:text-slate-200">Verifikasi Checklist Serah Terima:</span>
					<div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
						<div class="flex items-center gap-2 rounded-lg bg-emerald-50/60 px-2.5 py-1.5 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
							<IconCheck size={14} class="shrink-0" />
							<span>Progres fisik aktual site terverifikasi ({progressPct}%)</span>
						</div>
						<div class="flex items-center gap-2 rounded-lg bg-emerald-50/60 px-2.5 py-1.5 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
							<IconCheck size={14} class="shrink-0" />
							<span>Stock opname sisa cat & material lapangan</span>
						</div>
						<div class="flex items-center gap-2 rounded-lg bg-emerald-50/60 px-2.5 py-1.5 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
							<IconCheck size={14} class="shrink-0" />
							<span>Inventaris alat kerja & kompresor di site</span>
						</div>
						<div class="flex items-center gap-2 rounded-lg bg-emerald-50/60 px-2.5 py-1.5 text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
							<IconCheck size={14} class="shrink-0" />
							<span>Akses site customer & kontak PIC klien</span>
						</div>
					</div>
				</div>

				<!-- Tautan Unduh Berita Acara (BA) -->
				{#if baFileId}
					<div class="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-800">
						<div class="flex items-center gap-2.5 truncate">
							<span class="text-lg">📄</span>
							<div class="truncate">
								<p class="truncate font-semibold text-slate-800 dark:text-slate-100">{baFileName}</p>
								<p class="text-[10px] text-slate-400">Berita Acara (BA) Serah Terima Resmi</p>
							</div>
						</div>
						<a
							href={getPreviewUrl(String(baFileId))}
							target="_blank"
							rel="noopener noreferrer"
							class="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
						>
							<IconDownload size={14} /> Buka Berkas
						</a>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Feedback / Error Messages -->
		{#if successToast}
			<p class="mt-3 rounded-lg bg-emerald-50 p-2 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
				✓ {successToast}
			</p>
		{/if}

		{#if errorMessage}
			<p class="mt-3 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
				{errorMessage}
			</p>
		{/if}

		<!-- Form Lapor Kendala (Jika Diaktifkan) -->
		{#if showKendalaForm}
			<div class="mt-3.5 space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900/40 dark:bg-amber-950/30">
				<div class="flex items-center justify-between">
					<span class="font-bold text-amber-900 dark:text-amber-200">Form Laporan Kendala Transisi</span>
					<div class="flex items-center gap-3 text-xs">
						<label class="flex items-center gap-1.5 cursor-pointer">
							<input type="radio" bind:group={kendalaMode} value="kendala" class="text-amber-600 focus:ring-amber-500" />
							<span>Kendala Jadwal/Site</span>
						</label>
						<label class="flex items-center gap-1.5 cursor-pointer">
							<input type="radio" bind:group={kendalaMode} value="pendamping" class="text-amber-600 focus:ring-amber-500" />
							<span>Minta Pendamping</span>
						</label>
					</div>
				</div>

				<textarea
					rows="2"
					placeholder="Tuliskan kendala spesifik (misal: jadwal bentrok dengan proyek lain, mesin di lokasi butuh servis)..."
					bind:value={kendalaCatatan}
					class="w-full rounded-lg border border-amber-300 bg-white p-2.5 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 dark:border-amber-800 dark:bg-slate-900 dark:text-slate-100"
				></textarea>

				<div class="flex items-center justify-end gap-2">
					<button
						type="button"
						onclick={() => (showKendalaForm = false)}
						disabled={ackBusy}
						class="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/50 dark:text-slate-400"
					>
						Batal
					</button>
					<button
						type="button"
						onclick={() => submitAck(kendalaMode)}
						disabled={ackBusy || !kendalaCatatan.trim()}
						class="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
					>
						{#if ackBusy}
							<IconLoader2 size={13} class="animate-spin" /> Mengirim...
						{:else}
							Kirim Laporan Kendala
						{/if}
					</button>
				</div>
			</div>
		{/if}

		<!-- Aksi Tombol Konfirmasi ACK (Hanya bila belum di-ACK) -->
		{#if !delegationInfo.ack_status && !showKendalaForm}
			<div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
				<button
					type="button"
					onclick={() => (showKendalaForm = true)}
					disabled={ackBusy}
					class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
				>
					<IconAlertTriangle size={14} class="text-amber-500" />
					Ada Kendala / Minta Pendamping
				</button>

				<button
					type="button"
					onclick={() => submitAck('diterima')}
					disabled={ackBusy}
					class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-5 py-2 text-xs font-semibold text-white shadow-sm transition-all hover:bg-orange-700 active:scale-98 disabled:opacity-50"
				>
					{#if ackBusy}
						<IconLoader2 size={14} class="animate-spin" />
						<span>Memproses...</span>
					{:else}
						<IconFileCheck size={15} />
						<span>Konfirmasi Terima Proyek (Siap Lapangan)</span>
					{/if}
				</button>
			</div>
		{:else if delegationInfo.ack_status === 'diterima'}
			<div class="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
				<IconCheck size={15} class="shrink-0 font-bold" />
				<span>Anda telah resmi menerima serah terima proyek ini. Pelaporan harian site telah dialihkan ke akun Anda.</span>
			</div>
		{/if}
	</div>
</div>
