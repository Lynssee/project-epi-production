<!-- src/lib/components/anggaran/AttachmentChecklist.svelte
     Lampiran Otomatis v2 — ceklist lampiran per kategori anggaran, muncul tepat di
     bawah blok unggah lampiran di form pengajuan lapangan. Kembar dengan komponen di
     erp-epi-1 (admin). Membaca budget_category_attachment (dikelola admin erp-epi-1).

     - INFORMASIONAL: daftar lampiran yang diminta kategori + status kasar dari jumlah
       berkas terunggah.
     - L2 (pra-submit): bila `draft` diberikan, baris ber-puller_key dapat tombol
       "Pratinjau" — merangkai isi lampiran dari data form yang belum tersimpan (via
       generator admin). Tidak membuat berkas. "Tarik Data" penuh tetap di halaman
       detail setelah pengajuan dikirim.
     Kategori tanpa aturan (matriks kosong) => tidak menampilkan apa pun. -->
<script lang="ts">
  import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { getCategoryAttachments, previewAttachment, type BudgetCategoryAttachment } from '$lib/services/budgetCategory';

	let {
		categoryId = null,
		uploadedCount = 0,
		hasException = false,
		draft = null
	}: {
		categoryId?: number | null;
		uploadedCount?: number;
		hasException?: boolean;
		draft?: Record<string, unknown> | null;
	} = $props();

	let rows = $state<BudgetCategoryAttachment[]>([]);
	let loading = $state(false);
	let lastId: number | null = null;

	let previewHtml = $state<string | null>(null);
	let previewLabel = $state('');
	let busyKey = $state<string | null>(null);

	$effect(() => {
		const id = categoryId;
		if (!id) {
			rows = [];
			lastId = null;
			return;
		}
		if (id === lastId) return;
		lastId = id;
		loading = true;
		getCategoryAttachments(id)
			.then((r) => (rows = r))
			.catch(() => (rows = []))
			.finally(() => (loading = false));
	});

	let requiredRows = $derived(rows.filter((r) => r.is_required));
	let coveredApprox = $derived(
		hasException ? requiredRows.length : Math.min(uploadedCount, requiredRows.length)
	);
	let allCovered = $derived(requiredRows.length > 0 && coveredApprox >= requiredRows.length);

	const mode = (r: BudgetCategoryAttachment) =>
		r.attachment_type_id?.puller_key ? 'Tarik data otomatis' : 'Unggah manual';

	async function doPreview(r: BudgetCategoryAttachment) {
		const pk = r.attachment_type_id?.puller_key;
		if (!pk || !draft) return;
		busyKey = pk;
		try {
			const res = await previewAttachment(pk, draft);
			if (!res.available) {
				alert(res.reason || 'Pratinjau tidak tersedia saat ini.');
			} else if (res.empty) {
				alert(res.warning || 'Belum ada data untuk dipratinjau.');
			} else {
				previewHtml = res.html || '';
				previewLabel = r.attachment_type_id?.label || 'Pratinjau';
			}
		} finally {
			busyKey = null;
		}
	}
</script>

{#if loading}
    <CircularProgressGauge size={32} strokeWidth={3} label="Memuat lampiran kategori..." />
{:else if rows.length > 0}
	<div class="mt-3 rounded-xl border border-gray-200 bg-gray-50/70 p-3">
		<div class="flex items-center justify-between mb-2">
			<span class="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
				Kelengkapan Lampiran Kategori
			</span>
			{#if requiredRows.length > 0}
				<span
					class="text-[10px] px-2 py-0.5 rounded-full {allCovered
						? 'bg-green-100 text-green-700'
						: 'bg-amber-100 text-amber-700'}"
				>
					{coveredApprox}/{requiredRows.length} wajib
				</span>
			{/if}
		</div>

		<ul class="space-y-1.5">
			{#each rows as r (r.id)}
				<li class="flex items-start gap-2 text-[12px]">
					<span class="mt-0.5">{r.is_required ? (allCovered ? '✅' : '⬜') : '▫️'}</span>
					<div class="min-w-0 flex-1">
						<span class="text-gray-700 font-medium">{r.attachment_type_id?.label || '(jenis lampiran)'}</span>
						<span class="text-gray-400"> · {r.is_required ? 'Wajib' : 'Dianjurkan'} · {mode(r)}</span>
						{#if r.pic}
							<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded font-medium bg-blue-50 text-blue-700 border border-blue-200 ml-1">
								👤 PIC: {r.pic}
							</span>
						{/if}
						{#if r.attachment_type_id?.deskripsi}
							<p class="text-[10px] text-gray-400 mt-0.5">{r.attachment_type_id.deskripsi}</p>
						{/if}
						{#if draft && r.attachment_type_id?.puller_key}
							<button
								type="button"
								class="mt-1 text-[11px] text-[var(--p)] font-medium underline disabled:opacity-40"
								disabled={busyKey === r.attachment_type_id.puller_key}
								onclick={() => doPreview(r)}
							>
								{busyKey === r.attachment_type_id.puller_key ? 'Memuat...' : 'Pratinjau'}
							</button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		<p class="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-200/70">
			{#if hasException}
				Anda memakai jalur pengecualian terstruktur — alasan tercatat permanen untuk audit.
			{:else}
				Unggah berkas di atas untuk memenuhi daftar ini. "Pratinjau" merangkai isi lampiran
				otomatis dari data form ini; berkas PDF resmi dibuat lewat "Tarik Data" di halaman
				detail setelah pengajuan dikirim. Belum lengkap tidak memblokir kiriman (mode peringatan).
			{/if}
		</p>
	</div>
{/if}

{#if previewHtml !== null}
	<div
		class="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-3"
		role="presentation"
		onclick={(e) => { if (e.target === e.currentTarget) previewHtml = null; }}
	>
		<div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto">
			<div class="flex items-center justify-between p-3 border-b border-gray-200">
				<span class="text-sm font-semibold text-gray-800">Pratinjau: {previewLabel}</span>
				<button type="button" class="text-gray-400 hover:text-gray-600 text-xl leading-none" onclick={() => (previewHtml = null)}>&times;</button>
			</div>
			<div class="p-3 text-[12px] leading-relaxed [&_table]:w-full [&_td]:align-top">{@html previewHtml}</div>
			<div class="p-3 border-t border-gray-200 text-[10px] text-gray-400">
				Ini pratinjau isi dari data form saat ini — PDF resmi dibuat setelah pengajuan dikirim.
			</div>
		</div>
	</div>
{/if}
