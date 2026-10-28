<!-- src/lib/components/inventory/SaldoBarangSayaPanel.svelte -->
<!-- Fase 3, Rencana v2 "Lifecycle Pengembalian Barang" (§5.2) — "Saldo Barang Saya": daftar
     saldo (project_stock_balance, L1) di proyek milik leader yang login, dengan aksi cepat
     per baris. TIDAK ADA form baru untuk 3 aksi pertama -- memanggil endpoint/form yang SUDAH ADA:
       - Kembalikan  -> deep-link ke /packing-list/return (form retur existing, preselect item)
       - Pakai       -> deep-link ke /laporan/[project_id] (form laporan harian existing, di
                        situlah OUT-USAGE benar-benar ditulis lewat delta qty_used)
       - Hilang/Rusak -> panggil langsung /api/inventory-proyek/kerugian (OUT-LOSS) + foto bukti
       - Pindah Proyek -> panggil /api/inventory-proyek/transfer (TRANSFER-OUT/IN, endpoint BARU
                        Fase 3 -- pindah admin murni, TANPA approval proyek tujuan, sama prinsip
                        dengan OUT-LOSS: leader asal bertanggung jawab atas keakuratan laporannya). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { IconPackage, IconCornerUpLeft, IconClipboardList, IconAlertTriangle, IconArrowsExchange, IconCamera, IconLoader2, IconInfoCircle, IconChecklist } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getProjects } from '$lib/services/projects';
	import { getAllStockBalancesForProjects, type LowStockBalanceRow } from '$lib/services/projectStockBalanceApi';
	import { reportLossClaim } from '$lib/services/projectLossClaimApi';
	import { transferProjectStock } from '$lib/services/projectTransferApi';
	import { getMutasiStatus } from '$lib/services/mutasiApi';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let rows = $state<LowStockBalanceRow[]>([]);
	let expanded = $state(false);

	// === Modal Hilang/Rusak ===
	let showLossModal = $state(false);
	let lossTarget = $state<LowStockBalanceRow | null>(null);
	let lossQty = $state(0);
	let lossPhotoFile = $state<File | null>(null);
	let lossPhotoPreview = $state<string | null>(null);
	let showCamera = $state(false);
	let submittingLoss = $state(false);

	// === Modal Pindah Proyek ===
	let showTransferModal = $state(false);
	let transferTarget = $state<LowStockBalanceRow | null>(null);
	let transferQty = $state(0);
	let transferDestProjectId = $state<number | ''>('');
	let allActiveProjects = $state<any[]>([]);
	let loadingDestProjects = $state(false);
	let submittingTransfer = $state(false);

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			rows = await getAllStockBalancesForProjects(projectIds);
		} finally {
			loading = false;
		}
	}

	function projectName(projectId: number) {
		return projects.find((p) => p.id === projectId)?.nama_project || projects.find((p) => p.id === projectId)?.name || `Proyek #${projectId}`;
	}

	function kembalikanHref(row: LowStockBalanceRow) {
		return `/packing-list/return?projectId=${row.project_id}&preselect=${row.item_id}`;
	}

	function pakaiHref(row: LowStockBalanceRow) {
		return `/laporan/${row.project_id}`;
	}

	function openLossModal(row: LowStockBalanceRow) {
		lossTarget = row;
		lossQty = row.qty_on_hand;
		lossPhotoFile = null;
		lossPhotoPreview = null;
		showLossModal = true;
	}

	function closeLossModal() {
		showLossModal = false;
		lossTarget = null;
		if (lossPhotoPreview) URL.revokeObjectURL(lossPhotoPreview);
		lossPhotoPreview = null;
		lossPhotoFile = null;
	}

	async function handlePhotoCapture(file: File) {
		showCamera = false;
		try {
			const compressed = await compressPhoto(file);
			lossPhotoFile = compressed;
			if (lossPhotoPreview) URL.revokeObjectURL(lossPhotoPreview);
			lossPhotoPreview = URL.createObjectURL(compressed);
		} catch {
			alert('Gagal memproses foto. Coba lagi.');
		}
	}

	async function submitLossClaim() {
		if (!lossTarget) return;
		if (!(lossQty > 0) || lossQty > lossTarget.qty_on_hand) {
			alert(`Qty wajib > 0 dan tidak melebihi saldo (${lossTarget.qty_on_hand}).`);
			return;
		}
		if (!lossPhotoFile) {
			alert('Foto bukti wajib diisi untuk klaim barang hilang/rusak.');
			return;
		}
		submittingLoss = true;
		try {
			const evidencePhoto = await uploadEvidencePhoto(lossPhotoFile, `kerugian_proyek:project-${lossTarget.project_id}:item-${lossTarget.item_id}`);
			if (!evidencePhoto) throw new Error('Gagal mengunggah foto bukti.');
			await reportLossClaim({
				projectId: lossTarget.project_id,
				identitasBarangId: lossTarget.item_id,
				quantity: lossQty,
				evidencePhoto,
				batchId: `loss-${lossTarget.project_id}-${lossTarget.item_id}-${Date.now()}`
			});
			closeLossModal();
			await load();
		} catch (e: any) {
			alert(e?.message || 'Gagal melaporkan barang hilang/rusak.');
		} finally {
			submittingLoss = false;
		}
	}

	// RSM-13 §4.5: bila e-SJ Mutasi sudah aktif, "Pindah" membuka form Mutasi Barang (persetujuan tujuan + kirim + terima).
	// Bila skema belum diterapkan / server admin tak terjangkau, jalur lama tetap tersedia (masa transisi).
	let mutasiAktif = $state<boolean | null>(null);
	async function openTransferModal(row: LowStockBalanceRow) {
		if (mutasiAktif === null) {
			try {
				mutasiAktif = (await getMutasiStatus()).tersedia;
			} catch (e) {
				console.error('[SaldoBarangSaya] status mutasi tak terbaca, pakai jalur lama:', e);
				mutasiAktif = false;
			}
		}
		if (mutasiAktif) {
			await goto(`/mutasi-barang?asal=${row.project_id}&item=${row.item_id}`);
			return;
		}
		transferTarget = row;
		transferQty = row.qty_on_hand;
		transferDestProjectId = '';
		showTransferModal = true;
		if (allActiveProjects.length === 0) {
			loadingDestProjects = true;
			try {
				allActiveProjects = (await getProjects(null, true, null, { limit: 500, sort: 'name' })) || [];
			} finally {
				loadingDestProjects = false;
			}
		}
	}

	function closeTransferModal() {
		showTransferModal = false;
		transferTarget = null;
		transferDestProjectId = '';
	}

	async function submitTransfer() {
		if (!transferTarget) return;
		if (!(transferQty > 0) || transferQty > transferTarget.qty_on_hand) {
			alert(`Qty wajib > 0 dan tidak melebihi saldo (${transferTarget.qty_on_hand}).`);
			return;
		}
		if (!transferDestProjectId) {
			alert('Pilih proyek tujuan.');
			return;
		}
		submittingTransfer = true;
		try {
			await transferProjectStock({
				sourceProjectId: transferTarget.project_id,
				destProjectId: Number(transferDestProjectId),
				identitasBarangId: transferTarget.item_id,
				quantity: transferQty,
				batchId: `transfer-${transferTarget.project_id}-${transferTarget.item_id}-${Date.now()}`
			});
			closeTransferModal();
			await load();
		} catch (e: any) {
			alert(e?.message || 'Gagal memindahkan saldo barang ke proyek tujuan.');
		} finally {
			submittingTransfer = false;
		}
	}
</script>

<div class="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs mb-4">
	<button
		type="button"
		class="w-full p-3 flex items-center justify-between text-left cursor-pointer hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
		onclick={() => { expanded = !expanded; }}
	>
		<div class="flex items-center gap-2.5">
			<div class="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-600">
				<IconPackage size={18} />
			</div>
			<div>
				<p class="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">Saldo Barang Saya</p>
				<p class="text-[10px] text-slate-400">
					{loading ? 'Memuat…' : `${rows.length} baris barang masih di proyek Anda`}
				</p>
			</div>
		</div>
		<span class="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-50 text-amber-700 border border-amber-200">
			{expanded ? 'Tutup' : 'Lihat'}
		</span>
	</button>

	{#if expanded}
		<div class="border-t border-slate-200 dark:border-slate-800 p-3 space-y-2">
			<div class="rounded-lg p-2.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 text-[11px] text-blue-800 dark:text-blue-300 flex items-start gap-1.5">
				<IconInfoCircle size={14} class="shrink-0 mt-0.5" />
				<p>
					Setiap barang yang masih tercatat di sini harus berakhir: <strong>Kembalikan</strong> ke gudang, <strong>Pakai</strong> (dicatat di laporan harian), atau lapor <strong>Hilang/Rusak</strong> — jangan dibiarkan menggantung.
				</p>
			</div>

			{#if loading}
				<div class="py-6 text-center">
					<CircularProgressGauge
						compact={true}
						stepLabel="Memuat saldo barang proyek Anda..."
						subLabel="Mengambil data sisa material Directus"
					/>
				</div>
			{:else if rows.length === 0}
				<p class="text-center py-8 text-[12px] text-slate-400">Tidak ada saldo barang tersisa di proyek Anda.</p>
			{:else}
				<div class="space-y-2">
					{#each rows as row (row.id)}
						<div class="rounded-xl border border-slate-200 dark:border-slate-700 p-2.5">
							<div class="flex items-start justify-between gap-2 mb-2">
								<div class="min-w-0">
									<p class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{row.item_name}</p>
									<p class="text-[10px] text-slate-400">{projectName(row.project_id)} · {row.qty_on_hand} {row.item_satuan}</p>
								</div>
								{#if row.status === 'critical' || row.status === 'low'}
									<span class="shrink-0 text-[9.5px] px-1.5 py-0.5 rounded-full font-bold bg-rose-100 text-rose-700">{row.status}</span>
								{/if}
							</div>
							<div class="grid grid-cols-5 gap-1.5">
								<a
									href={kembalikanHref(row)}
									class="flex flex-col items-center gap-0.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 text-[9.5px] font-semibold hover:bg-emerald-100"
									title="Buka form Retur Barang dengan item ini sudah tercentang otomatis"
								>
									<IconCornerUpLeft size={14} /> Kembalikan
								</a>
								<button
									type="button"
									onclick={() => goto(pakaiHref(row))}
									class="flex flex-col items-center gap-0.5 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 text-[9.5px] font-semibold hover:bg-blue-100 cursor-pointer border-none"
									title="Catat pemakaian lewat Laporan Harian proyek"
								>
									<IconClipboardList size={14} /> Pakai
								</button>
								<a
									href="/inventory-proyek/opname"
									class="flex flex-col items-center gap-0.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 text-[9.5px] font-semibold hover:bg-amber-100"
									title="Buka Opname Fisik proyek: hitung stok sebenarnya agar saldo buku sama dengan fisik (selisih masuk approval)"
								>
									<IconChecklist size={14} /> Opname
								</a>
								<button
									type="button"
									onclick={() => openLossModal(row)}
									class="flex flex-col items-center gap-0.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 text-[9.5px] font-semibold hover:bg-rose-100 cursor-pointer border-none"
									title="Laporkan barang hilang/rusak (wajib foto bukti)"
								>
									<IconAlertTriangle size={14} /> Hilang/Rusak
								</button>
								<button
									type="button"
									onclick={() => openTransferModal(row)}
									class="flex flex-col items-center gap-0.5 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 text-[9.5px] font-semibold hover:bg-purple-100 cursor-pointer border-none"
									title="Pindahkan barang ini ke proyek lain (diajukan dulu, disetujui proyek tujuan, lalu dikirim)"
								>
									<IconArrowsExchange size={14} /> Pindah
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if showLossModal && lossTarget}
	<div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
		<div class="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-4 space-y-3">
			<h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">Lapor Hilang/Rusak</h3>
			<p class="text-[11px] text-slate-500">{lossTarget.item_name} · saldo {lossTarget.qty_on_hand} {lossTarget.item_satuan}</p>

			<div>
				<label for="loss-qty" class="block text-[10px] font-semibold text-slate-500 mb-1">Qty Hilang/Rusak</label>
				<input
					id="loss-qty"
					type="number"
					min="0"
					max={lossTarget.qty_on_hand}
					bind:value={lossQty}
					class="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-slate-800"
				/>
			</div>

			<div>
				<span class="block text-[10px] font-semibold text-slate-500 mb-1">Foto Bukti (wajib)</span>
				{#if lossPhotoPreview}
					<div class="relative">
						<img src={lossPhotoPreview} alt="Bukti kerugian" class="w-full h-32 object-cover rounded-lg" />
						<button
							type="button"
							onclick={() => { showCamera = true; }}
							class="absolute bottom-1.5 right-1.5 text-[10px] px-2 py-1 rounded-lg bg-black/60 text-white font-semibold"
						>
							Ambil Ulang
						</button>
					</div>
				{:else}
					<button
						type="button"
						onclick={() => { showCamera = true; }}
						class="w-full flex items-center justify-center gap-1.5 py-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 text-xs font-semibold cursor-pointer bg-transparent"
					>
						<IconCamera size={16} /> Ambil Foto
					</button>
				{/if}
			</div>

			<div class="flex gap-2 pt-1">
				<button
					type="button"
					onclick={closeLossModal}
					disabled={submittingLoss}
					class="flex-1 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer bg-transparent disabled:opacity-50"
				>
					Batal
				</button>
				<button
					type="button"
					onclick={submitLossClaim}
					disabled={submittingLoss}
					class="flex-1 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer border-none disabled:opacity-50 flex items-center justify-center gap-1.5"
				>
					{#if submittingLoss}<IconLoader2 size={14} class="animate-spin" />{/if}
					Kirim Laporan
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showCamera}
	<CameraCaptureModal onCapture={handlePhotoCapture} onClose={() => { showCamera = false; }} />
{/if}

{#if showTransferModal && transferTarget}
	<div class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
		<div class="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm p-4 space-y-3">
			<h3 class="text-sm font-bold text-slate-800 dark:text-slate-100">Pindah Proyek</h3>
			<p class="text-[11px] text-slate-500">{transferTarget.item_name} · saldo {transferTarget.qty_on_hand} {transferTarget.item_satuan}</p>

			<div>
				<label for="transfer-qty" class="block text-[10px] font-semibold text-slate-500 mb-1">Qty Dipindahkan</label>
				<input
					id="transfer-qty"
					type="number"
					min="0"
					max={transferTarget.qty_on_hand}
					bind:value={transferQty}
					class="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-slate-800"
				/>
			</div>

			<div>
				<label for="transfer-dest" class="block text-[10px] font-semibold text-slate-500 mb-1">Proyek Tujuan</label>
				{#if loadingDestProjects}
					<div class="flex items-center gap-1.5 text-[11px] text-slate-400 py-1.5"><IconLoader2 size={14} class="animate-spin" /> Memuat daftar proyek…</div>
				{:else}
					<select
						id="transfer-dest"
						bind:value={transferDestProjectId}
						class="w-full border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-sm bg-white dark:bg-slate-800"
					>
						<option value="">— pilih proyek tujuan —</option>
						{#each allActiveProjects.filter((p) => p.id !== transferTarget?.project_id) as p (p.id)}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				{/if}
			</div>

			<p class="text-[10px] text-slate-400 flex items-start gap-1">
				<IconInfoCircle size={12} class="shrink-0 mt-0.5" />
				Pastikan barang benar-benar sudah/akan dipindahkan secara fisik sebelum konfirmasi — ini murni pencatatan administratif, tanpa approval dari proyek tujuan.
			</p>

			<div class="flex gap-2 pt-1">
				<button
					type="button"
					onclick={closeTransferModal}
					disabled={submittingTransfer}
					class="flex-1 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer bg-transparent disabled:opacity-50"
				>
					Batal
				</button>
				<button
					type="button"
					onclick={submitTransfer}
					disabled={submittingTransfer}
					class="flex-1 py-2 rounded-lg bg-purple-600 text-white text-xs font-bold cursor-pointer border-none disabled:opacity-50 flex items-center justify-center gap-1.5"
				>
					{#if submittingTransfer}<IconLoader2 size={14} class="animate-spin" />{/if}
					Pindahkan
				</button>
			</div>
		</div>
	</div>
{/if}
