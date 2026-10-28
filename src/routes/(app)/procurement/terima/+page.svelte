<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchPOTracking,
		fetchPODetailForConfirmation,
		submitFieldConfirmation,
		uploadEvidencePhoto,
		type POTrackingItem,
		type POItemForConfirmation,
		type KondisiBarangDilaporkan
	} from '$lib/services/procurementApi';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconCamera, IconTruckDelivery } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { procurementLapanganHints } from '$lib/data/hints/procurementLapangan';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint Procurement Lapangan; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(procurementLapanganHints, key, 'procurementLapangan');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'terima_barang_po', roles)) {
			goto('/');
		}
	});

	let step = $state<'pick' | 'form'>('pick');
	let loading = $state(true);
	let pos = $state<POTrackingItem[]>([]);
	let search = $state('');

	// Lifecycle Pembelian v2, Fase 4 — kondisi & qty reject per item, mengisi
	// goods_receipt_note_items.qty_reject/reject_reason via alur verifikasi admin
	// (Aturan #7: default aman — adaReject=false, qty_reject=0, kondisi='baik').
	interface TerimaItemState extends POItemForConfirmation {
		qty_dilaporkan: number;
		adaReject: boolean;
		qty_reject: number;
		kondisi: KondisiBarangDilaporkan;
	}
	const KONDISI_OPTIONS: { value: KondisiBarangDilaporkan; label: string }[] = [
		{ value: 'rusak', label: 'Rusak' },
		{ value: 'salah_spec', label: 'Tidak Sesuai Spek' },
		{ value: 'kurang', label: 'Kurang' },
		{ value: 'expired', label: 'Kedaluwarsa' },
		{ value: 'lainnya', label: 'Lainnya' }
	];

	let selectedPo = $state<any>(null);
	let items = $state<TerimaItemState[]>([]);
	let catatan = $state('');
	let photoFile = $state<File | null>(null);
	let submitting = $state(false);
	let errorMsg = $state('');
	let successInfo = $state(false);

	// Jaring pengaman draf: OS bisa membunuh tab selagi kamera native terbuka saat
	// memfoto surat jalan / barang datang. Yang disimpan hanya id PO + qty per item +
	// catatan; detail PO-nya di-fetch ulang dari server saat pulih supaya angka
	// received_qty tidak ikut basi.
	interface TerimaDraft {
		// number, bukan string — id PO & id item memang numerik di Directus, dan
		// fetchPODetailForConfirmation() menerima number.
		poId: number | null;
		// Kunci di-stringify karena JSON object key selalu string; pembacaannya
		// juga lewat String(it.id) supaya simetris.
		qty: Record<string, number>;
		catatan: string;
	}
	const TERIMA_PHOTO_KEY = 'bukti';
	const terimaPersist = createFormPersist<TerimaDraft>('procurement_terima');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function terimaSnapshot(): TerimaDraft {
		return {
			poId: selectedPo?.id ?? null,
			qty: Object.fromEntries(items.map((it) => [String(it.id), it.qty_dilaporkan])),
			catatan
		};
	}

	async function loadPOs() {
		loading = true;
		const rows = await fetchPOTracking(search || undefined);
		pos = rows.filter((p) => p.status === 'sent' || p.status === 'partial_received');
		loading = false;
	}

	async function selectPO(po: POTrackingItem) {
		loading = true;
		const { po: detail, items: rawItems } = await fetchPODetailForConfirmation(po.id);
		selectedPo = detail;
		items = rawItems.map((it) => ({
			...it,
			qty_dilaporkan: Math.max((it.quantity || 0) - (it.received_qty || 0), 0),
			adaReject: false,
			qty_reject: 0,
			kondisi: 'baik' as KondisiBarangDilaporkan
		}));
		step = 'form';
		loading = false;
	}

	// Ringkasan di atas tombol simpan (§ Fase 4 rencana): "5 dari 8 item OK, 3 perlu klaim".
	let reportedCount = $derived(items.filter((it) => it.qty_dilaporkan > 0).length);
	let rejectCount = $derived(items.filter((it) => it.qty_dilaporkan > 0 && it.adaReject && it.qty_reject > 0).length);

	function handlePhotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (file) {
			photoFile = file;
			terimaPersist.savePhoto(TERIMA_PHOTO_KEY, file);
		}
	}

	async function handleSubmit() {
		errorMsg = '';
		const reported = items.filter((it) => it.qty_dilaporkan > 0);
		if (reported.length === 0) { errorMsg = 'Isi minimal 1 qty yang diterima'; return; }
		const overReject = reported.find((it) => it.adaReject && it.qty_reject > it.qty_dilaporkan);
		if (overReject) { errorMsg = `Qty reject "${overReject.item_name}" tidak boleh lebih besar dari qty diterima`; return; }

		submitting = true;
		try {
			let fotoFileId: string | null = null;
			if (photoFile) {
				const compressed = await compressPhoto(photoFile);
				fotoFileId = await uploadEvidencePhoto(compressed, 'po_field_confirmation:evidence');
			}

			const res = await submitFieldConfirmation({
				poId: selectedPo.id,
				karyawanId: $authStore.karyawanId,
				namaKaryawan: getUserDisplay($authStore.user),
				items: reported.map((it) => ({
					po_item_id: it.id,
					item_name: it.item_name,
					qty_dilaporkan: it.qty_dilaporkan,
					qty_reject: it.adaReject ? it.qty_reject : 0,
					kondisi: it.adaReject ? it.kondisi : 'baik'
				})),
				fotoFileId,
				catatan
			});

			if (res.success) {
				// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
				terimaPersist.clear();
				await terimaPersist.clearPhotos();
				draftSavedAt = null;
				successInfo = true;
			} else {
				errorMsg = res.error || 'Gagal mengirim konfirmasi';
			}
		} finally {
			submitting = false;
		}
	}

	onMount(async () => {
		await loadPOs();

		// Pulihkan draf: PO-nya di-fetch ulang (bukan dipakai dari draf) supaya
		// received_qty & daftar item selalu versi server terbaru; draf hanya
		// mengembalikan qty yang sudah diketik user dan catatannya.
		const draft = terimaPersist.restore();
		if (draft?.poId) {
			try {
				const { po: detail, items: rawItems } = await fetchPODetailForConfirmation(draft.poId);
				selectedPo = detail;
				items = rawItems.map((it) => ({
					...it,
					qty_dilaporkan:
						draft.qty[String(it.id)] ?? Math.max((it.quantity || 0) - (it.received_qty || 0), 0),
					adaReject: false,
					qty_reject: 0,
					kondisi: 'baik' as KondisiBarangDilaporkan
				}));
				catatan = draft.catatan || '';
				const blob = await terimaPersist.restorePhoto(TERIMA_PHOTO_KEY);
				if (blob) photoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
				step = 'form';
				draftSavedAt = new Date();
			} catch {
				// PO sudah tidak bisa diambil (ditutup/dihapus) — buang draf, mulai dari daftar PO.
				terimaPersist.clear();
			}
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void terimaSnapshot();
		if (!draftArmed) return;
		terimaPersist.save(terimaSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(terimaPersist, terimaSnapshot));
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm px-4 py-3 flex items-center gap-3">
		<button
			onclick={() => (step === 'form' && !successInfo ? (step = 'pick') : goto('/procurement'))}
			class="p-2 -ml-2 rounded-full hover:bg-slate-100"
		><IconArrowLeft size={20} /></button>
		<h1 class="text-base font-bold" style="color: var(--sys-label)">Terima Barang (PO)</h1>
		<div class="ml-auto"><DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} /></div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 py-6 pb-24">
		<div class="max-w-xl mx-auto w-full">
			<SectionGuide
				id="procurementLapangan.terima.page"
				title={h('terima.page').sectionGuide?.title}
				steps={h('terima.page').sectionGuide?.steps ?? []}
			/>

			{#if step === 'pick'}
				<div class="flex items-center gap-2 mb-4">
					<input
						type="text"
						bind:value={search}
						onkeydown={(e) => e.key === 'Enter' && loadPOs()}
						placeholder="Cari no. PO / supplier..."
						class="flex-1 px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
					/>
					<button onclick={loadPOs} class="px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold">Cari</button>
				</div>

				{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat penerimaan barang PO..." />
		</div>
				{:else if pos.length === 0}
					<div class="glass-panel rounded-2xl p-8 text-center border border-white/50 shadow-sm">
						<p class="text-sm" style="color: var(--sys-label3)">Tidak ada PO yang menunggu diterima.</p>
					</div>
				{:else}
					<div class="space-y-3">
						{#each pos as po (po.id)}
							<button
								onclick={() => selectPO(po)}
								class="w-full glass-panel rounded-2xl p-4 border border-white/50 shadow-sm text-left flex items-center gap-3"
							>
								<div class="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0">
									<IconTruckDelivery size={20} />
								</div>
								<div class="flex-1 min-w-0">
									<p class="text-sm font-bold" style="color: var(--sys-label)">{po.po_number}</p>
									<p class="text-xs truncate" style="color: var(--sys-label3)">{po.supplier_name || '-'}</p>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			{:else if step === 'form'}
				{#if successInfo}
					<div class="glass-panel rounded-2xl p-6 text-center border border-white/50 shadow-sm">
						<IconCircleCheck size={40} class="mx-auto mb-3 text-emerald-500" />
						<p class="text-base font-bold mb-1" style="color: var(--sys-label)">Konfirmasi terkirim</p>
						<p class="text-xs mb-4" style="color: var(--sys-label3)">
							Admin akan memverifikasi &amp; memfinalisasi penerimaan barang ini.
						</p>
						<button
							class="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold"
							onclick={() => goto('/procurement')}
						>Kembali ke Menu</button>
					</div>
				{:else if loading}
					<div class="text-center py-12"><IconLoader2 size={24} class="animate-spin mx-auto text-blue-500" /></div>
				{:else if selectedPo}
					<div class="glass-panel rounded-2xl p-5 border border-white/50 shadow-sm space-y-4">
						<div>
							<p class="text-sm font-bold" style="color: var(--sys-label)">{selectedPo.po_number}</p>
							<p class="text-xs" style="color: var(--sys-label3)">{selectedPo.supplier_name || '-'}</p>
						</div>

						<!-- Hint berlaku untuk semua baris item, jadi ditaruh sekali di sini —
						     dipasang per baris akan terulang sebanyak jumlah item PO. -->
						<div>
							<p class="text-xs font-semibold mb-1 inline-flex items-center gap-1.5" style="color: var(--sys-label3)">
								Qty Diterima<HelpIcon text={h('terima.form.qtyDiterima').helpIcon} position="bottom" />
							</p>
							<FieldHint text={h('terima.form.qtyDiterima').fieldHint} />
						</div>

						<div class="space-y-2">
							{#each items as item}
								<div class="rounded-xl border border-slate-200 p-3">
									<p class="text-sm font-semibold mb-1" style="color: var(--sys-label)">{item.item_name}</p>
									<p class="text-[11px] mb-2" style="color: var(--sys-label4)">
										Pesan: {item.quantity} &middot; Sudah diterima resmi: {item.received_qty || 0}
									</p>
									<input
										type="number"
										bind:value={item.qty_dilaporkan}
										min="0"
										step="any"
										placeholder="Qty diterima sekarang"
										class="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm"
									/>

									<!-- Lifecycle Pembelian v2, Fase 4 — inspeksi kondisi per item -->
									<label class="flex items-center gap-2 mt-2 text-xs" style="color: var(--sys-label3)">
										<input type="checkbox" bind:checked={item.adaReject} class="rounded" />
										Ada yang reject/rusak/kurang?
									</label>
									{#if item.adaReject}
										<div class="mt-2 grid grid-cols-2 gap-2">
											<div>
												<label for={`reject-qty-${item.id}`} class="block text-[10px] font-medium mb-0.5" style="color: var(--sys-label4)">Qty Reject</label>
												<input
													id={`reject-qty-${item.id}`}
													type="number"
													bind:value={item.qty_reject}
													min="0"
													max={item.qty_dilaporkan}
													step="any"
													class="w-full px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50/50 text-sm"
												/>
											</div>
											<div>
												<label for={`reject-kondisi-${item.id}`} class="block text-[10px] font-medium mb-0.5" style="color: var(--sys-label4)">Kondisi</label>
												<select id={`reject-kondisi-${item.id}`} bind:value={item.kondisi} class="w-full px-2.5 py-1.5 rounded-lg border border-red-200 bg-red-50/50 text-sm">
													{#each KONDISI_OPTIONS as opt}
														<option value={opt.value}>{opt.label}</option>
													{/each}
												</select>
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>

						{#if reportedCount > 0}
							<!-- Ringkasan sebelum kirim (§ Fase 4 rencana): "5 dari 8 item OK, 3 perlu klaim" -->
							<div class="rounded-xl px-3 py-2 text-xs font-semibold {rejectCount > 0 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}">
								{reportedCount - rejectCount} dari {reportedCount} item OK
								{#if rejectCount > 0}&middot; {rejectCount} perlu klaim{/if}
							</div>
						{/if}

						<div>
							<span class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Foto Bukti / Surat Jalan</span>
							<label class="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl py-4 cursor-pointer text-slate-500">
								<IconCamera size={18} />
								<span class="text-xs font-medium">{photoFile ? photoFile.name : 'Ambil / pilih foto'}</span>
								<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handlePhotoChange} />
							</label>
						</div>

						<div>
							<label for="f-catatan" class="block text-xs font-semibold mb-1" style="color: var(--sys-label3)">Catatan</label>
							<textarea id="f-catatan" bind:value={catatan} rows="2" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"></textarea>
							<FieldHint text={h('terima.form.catatan').fieldHint} />
						</div>

						{#if errorMsg}
							<p class="text-xs text-red-600 font-medium">{errorMsg}</p>
						{/if}

						<button
							onclick={handleSubmit}
							disabled={submitting}
							class="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
						>
							{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
							{submitting ? 'Mengirim...' : 'Kirim Konfirmasi'}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
