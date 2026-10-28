<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getMyHrDocuments, downloadMyHrDocument, type HrDocument } from '$lib/services/ess/hrDocuments';
	import { getDokumenList, type EssDokumen } from '$lib/services/ess/dokumen';
	import { getProfil, EDITABLE_PROFIL_FIELDS, type EssProfil } from '$lib/services/ess/profil';
	import {
		REQUIRED_DOCS,
		SELF_UPLOADABLE,
		isDocRequiredForStatus,
		getDocExpiryStatus
	} from '$lib/services/ess/hrdChecklist';
	import {
		IconLoader2,
		IconAlertTriangle,
		IconDownload,
		IconFileText,
		IconPencil,
		IconCheck,
		IconX,
		IconAlertCircle,
		IconMinus
	} from '@tabler/icons-svelte';
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let documents = $state<HrDocument[]>([]);
	let downloadingId = $state<number | null>(null);
	let previewDoc = $state<{ blob: Blob; title: string } | null>(null);
	let showPreviewModal = $state(false);

	let dokumenSaya = $state<EssDokumen[]>([]);
	let profil = $state<EssProfil | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const [hrRes, dokRes, profilRes] = await Promise.all([
				getMyHrDocuments(),
				getDokumenList(),
				getProfil()
			]);
			documents = hrRes.documents;
			dokumenSaya = dokRes.dokumen;
			profil = profilRes.profil;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat dokumen.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// Dokumen terbaru per tipe (dokumenSaya sudah terurut -tanggal_upload dari server).
	const latestDocByType = $derived.by(() => {
		const map: Record<string, EssDokumen> = {};
		for (const d of dokumenSaya) {
			if (!map[d.tipe_dokumen]) map[d.tipe_dokumen] = d;
		}
		return map;
	});

	const dokumenChecklist = $derived.by(() => {
		const statusKerja = profil?.status_kerja || profil?.status || null;
		return REQUIRED_DOCS.map((d) => {
			const doc = latestDocByType[d.value];
			const required = isDocRequiredForStatus(d.value, statusKerja);
			let state: 'ok' | 'expired' | 'expiring_soon' | 'missing' | 'optional';
			if (doc) {
				const expiry = getDocExpiryStatus(doc);
				state = expiry === 'active' ? 'ok' : expiry;
			} else {
				state = required ? 'missing' : 'optional';
			}
			return { ...d, state, canSelfUpload: SELF_UPLOADABLE.has(d.value) };
		});
	});

	const profilChecklist = $derived.by(() => {
		if (!profil) return [];
		return EDITABLE_PROFIL_FIELDS.map((f) => ({
			...f,
			filled: !!profil?.[f.key]
		}));
	});

	const kelengkapanTotal = $derived(dokumenChecklist.length + profilChecklist.length);
	const kelengkapanTerisi = $derived(
		dokumenChecklist.filter((d) => d.state === 'ok' || d.state === 'expiring_soon' || d.state === 'expired').length +
			profilChecklist.filter((f) => f.filled).length
	);
	const kelengkapanPct = $derived(kelengkapanTotal > 0 ? Math.round((kelengkapanTerisi / kelengkapanTotal) * 100) : 0);

	function formatTanggal(iso: string | null) {
		if (!iso) return '-';
		return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
	}

	const JENIS_LABEL: Record<string, string> = {
		offering: 'Offering Letter', pkwt: 'PKWT', pkwtt: 'PKWTT', nda: 'Pakta Integritas / NDA',
		sk: 'SK Pengangkatan', sertifikat: 'Sertifikat', memo: 'Memo Internal', bast: 'BAST',
		surat_panggilan: 'Surat Panggilan', berita_acara: 'Berita Acara', notulen: 'Notulen Rapat',
		penonaktifan: 'Surat Penonaktifan BPJS',
		tambah_bpjs: 'Pendaftaran BPJS',
		nonaktif_bpjs: 'Penonaktifan BPJS',
		surat_peringatan: 'Surat Peringatan / Sanksi'
	};

	// Fase 3 Kebijakan Kedisiplinan: dokumen sanksi ditandai mencolok agar tidak terlewat.
	const JENIS_PENTING = new Set(['surat_peringatan', 'surat_panggilan']);

	async function handleDownload(doc: HrDocument) {
		downloadingId = doc.id;
		try {
			const blob = await downloadMyHrDocument(doc.id);
			const rawName = doc.judul ? `${doc.nomor_dokumen} - ${doc.judul}` : doc.nomor_dokumen;
			const cleanName = rawName.replace(/[\\/:*?"<>|]/g, '_').trim();
			previewDoc = { blob, title: cleanName };
			showPreviewModal = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat dokumen.';
		} finally {
			downloadingId = null;
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Dokumen Saya</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Dokumen HR yang diterbitkan untuk Anda</p>
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat dokumen..." />
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
	{:else}
		<div class="glass-panel rounded-3xl p-6 mb-8">
			<div class="flex items-center justify-between mb-1">
				<h2 class="text-lg font-bold" style="color: var(--sys-label)">Kelengkapan Dokumen & Data</h2>
				<span class="text-sm font-extrabold" style="color: var(--p, var(--g))">{kelengkapanPct}%</span>
			</div>
			<p class="text-xs font-medium mb-4" style="color: var(--sys-label3)">Kisi-kisi semua dokumen & data yang harus Anda lengkapi.</p>

			<div class="w-full h-2 rounded-full mb-6 overflow-hidden" style="background: var(--sys-fill3, rgba(0,0,0,0.08))">
				<div class="h-full rounded-full gradient-bg" style="width: {kelengkapanPct}%"></div>
			</div>

			<h3 class="text-xs font-bold uppercase tracking-wide mb-2" style="color: var(--sys-label4)">Dokumen</h3>
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
				{#each dokumenChecklist as d (d.value)}
					<button
						class="flex items-center gap-2 rounded-xl px-3 py-2 text-left border disabled:cursor-default"
						style="border-color: var(--sys-separator)"
						disabled={!(d.canSelfUpload && (d.state === 'missing' || d.state === 'expired' || d.state === 'expiring_soon'))}
						onclick={() => goto('/ess/profil')}
						title={d.label}
					>
						{#if d.state === 'ok'}
							<IconCheck size={16} class="shrink-0 text-emerald-500" />
						{:else if d.state === 'expired'}
							<IconAlertCircle size={16} class="shrink-0 text-red-500" />
						{:else if d.state === 'expiring_soon'}
							<IconAlertCircle size={16} class="shrink-0 text-amber-500" />
						{:else if d.state === 'missing'}
							<IconX size={16} class="shrink-0 text-red-400" />
						{:else}
							<IconMinus size={16} class="shrink-0" style="color: var(--sys-label4)" />
						{/if}
						<div class="min-w-0">
							<p class="text-xs font-bold truncate" style="color: var(--sys-label)">{d.label}</p>
							<p class="text-[10px] font-medium" style="color: var(--sys-label4)">
								{#if d.state === 'ok'}Lengkap
								{:else if d.state === 'expired'}Kedaluwarsa
								{:else if d.state === 'expiring_soon'}Segera Perpanjang
								{:else if d.state === 'missing'}{d.canSelfUpload ? 'Unggah di sini' : 'Hubungi HRD'}
								{:else}Opsional{/if}
							</p>
						</div>
					</button>
				{/each}
			</div>

			<h3 class="text-xs font-bold uppercase tracking-wide mb-2" style="color: var(--sys-label4)">Data Diri</h3>
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
				{#each profilChecklist as f (f.key)}
					<button
						class="flex items-center gap-2 rounded-xl px-3 py-2 text-left border"
						style="border-color: var(--sys-separator)"
						onclick={() => goto('/ess/profil')}
						title={f.label}
					>
						{#if f.filled}
							<IconCheck size={16} class="shrink-0 text-emerald-500" />
						{:else}
							<IconX size={16} class="shrink-0 text-red-400" />
						{/if}
						<div class="min-w-0">
							<p class="text-xs font-bold truncate" style="color: var(--sys-label)">{f.label}</p>
							<p class="text-[10px] font-medium" style="color: var(--sys-label4)">{f.filled ? 'Lengkap' : 'Lengkapi di sini'}</p>
						</div>
					</button>
				{/each}
			</div>
		</div>

		<h2 class="text-lg font-bold mb-4" style="color: var(--sys-label)">Dokumen Terbitan HR</h2>
		{#if documents.length === 0}
			<div class="glass-panel rounded-2xl p-10 text-center">
				<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada dokumen HR yang diterbitkan untuk Anda.</p>
			</div>
		{:else}
		<div class="flex flex-col gap-4">
			{#each documents as doc (doc.id)}
				<div class="glass-panel rounded-2xl p-5 hover-lift">
					<div class="flex items-start justify-between gap-3">
						<div class="flex items-start gap-3 min-w-0">
							<div
								class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
								class:bg-red-50={JENIS_PENTING.has(doc.jenis)}
								class:text-red-600={JENIS_PENTING.has(doc.jenis)}
								class:bg-blue-50={!JENIS_PENTING.has(doc.jenis)}
								class:text-blue-600={!JENIS_PENTING.has(doc.jenis)}
							>
								<IconFileText size={20} />
							</div>
							<div class="min-w-0">
								<p class="text-sm font-bold truncate" style="color: var(--sys-label)">{JENIS_LABEL[doc.jenis] || doc.judul || doc.jenis}</p>
								<p class="text-xs mt-0.5" style="color: var(--sys-label4)">{doc.nomor_dokumen}</p>
								<p class="text-xs mt-0.5" style="color: var(--sys-label4)">Terbit {formatTanggal(doc.tanggal_terbit)}</p>
							</div>
						</div>
						{#if doc.needsSignature}
							<span class="shrink-0 text-[10px] font-bold px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
								Menunggu tanda tangan Anda
							</span>
						{/if}
					</div>

					<div class="flex gap-2 mt-4">
						<button
							class="flex-1 h-11 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border disabled:opacity-40"
							style="border-color: var(--sys-separator); color: var(--sys-label)"
							disabled={downloadingId === doc.id}
							onclick={() => handleDownload(doc)}
						>
							{#if downloadingId === doc.id}<IconLoader2 size={16} class="animate-spin" />{:else}<IconDownload size={16} />{/if}
							Unduh PDF
						</button>
						{#if doc.needsSignature}
							<button
								class="flex-1 h-11 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-2 gradient-bg shadow-md"
								onclick={() => goto(`/ess/dokumen-saya/${doc.id}/ttd`)}
							>
								<IconPencil size={16} />
								Tanda Tangan
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		{/if}
	{/if}

	<PdfBlobViewer
		src={previewDoc?.blob}
		title={previewDoc?.title}
		show={showPreviewModal}
		onClose={() => {
			showPreviewModal = false;
			previewDoc = null;
		}}
	/>
</div>
