<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		fetchSjManualMeta,
		searchSjManualItems,
		createSjManual,
		resubmitSjManual,
		fetchSjManualDetail,
		type SjManualMeta,
		type SjManualSearchItem
	} from '$lib/services/sjManualApi';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconAlertTriangle, IconSearch, IconTrash, IconPlus, IconCamera, IconFileUpload, IconX } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import TunggakanFisikWidget from '$lib/components/TunggakanFisikWidget.svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { sjManualPayloadSchema } from '$lib/schemas/sjManual';

	// Fase 3 lanjutan: ?editId=<id> membuka form ini dalam mode revisi untuk SJ Manual
	// yang ditolak (reject -> lapangan edit -> resubmit), lihat [id]/+page.svelte.
	let editId = $derived($page.url.searchParams.get('editId'));

	let meta = $state<SjManualMeta | null>(null);
	let metaError = $state('');
	let loadingEdit = $state(false);

	let customerName = $state('');
	let customerAddress = $state('');
	let customerPhone = $state('');
	let projectId = $state('');
	let driverName = $state('');
	let notes = $state('');

	interface CartLine {
		itemId: number | null;
		nama: string;
		satuan: string;
		stokTersedia: number;
		quantity: number;
	}
	let cart = $state<CartLine[]>([]);

	let searchQuery = $state('');
	let searchResults = $state<SjManualSearchItem[]>([]);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout> | undefined;

	// Bukti: scan dokumen (file/PDF) + foto bukti (kamera, reuse CameraCaptureModal SJI).
	let scanFile = $state<File | null>(null);
	let fotoFile = $state<File | null>(null);
	let fotoPreviewUrl = $state('');
	let showCamera = $state(false);
	let scanInputEl = $state<HTMLInputElement | undefined>(undefined);

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	let successNomor = $state('');

	// Jaring pengaman draf. Form terpanjang kedua setelah survey sales: identitas
	// customer + driver + keranjang item, lalu scan dokumen DAN foto lewat kamera
	// native. Dikunci per mode — draf pengajuan baru tidak boleh bocor ke form revisi
	// SJ yang ditolak (?editId), dan sebaliknya.
	interface SjManualDraft {
		customerName: string;
		customerAddress: string;
		customerPhone: string;
		projectId: string;
		driverName: string;
		notes: string;
		cart: CartLine[];
	}
	const SJ_FOTO_KEY = 'foto';
	const SJ_SCAN_KEY = 'scan';
	let sjPersist = $derived(
		createFormPersist<SjManualDraft>(`sj_manual_${editId ? `edit_${editId}` : 'baru'}`)
	);
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function sjSnapshot(): SjManualDraft {
		return { customerName, customerAddress, customerPhone, projectId, driverName, notes, cart };
	}

	onMount(async () => {
		try {
			meta = await fetchSjManualMeta();
			if (editId) await loadForEdit(Number(editId));

			// Pulihkan draf SETELAH loadForEdit, supaya revisi yang belum terkirim
			// menang atas isi SJ lama dari server.
			const draft = sjPersist.restore();
			if (draft) {
				customerName = draft.customerName;
				customerAddress = draft.customerAddress;
				customerPhone = draft.customerPhone;
				projectId = draft.projectId;
				driverName = draft.driverName;
				notes = draft.notes;
				if (draft.cart?.length) cart = draft.cart;

				const [fotoBlob, scanBlob] = await Promise.all([
					sjPersist.restorePhoto(SJ_FOTO_KEY),
					sjPersist.restorePhoto(SJ_SCAN_KEY)
				]);
				if (fotoBlob) {
					fotoFile = new File([fotoBlob], 'foto.jpg', { type: fotoBlob.type || 'image/jpeg' });
					fotoPreviewUrl = URL.createObjectURL(fotoFile);
				}
				// Scan bisa PDF — pertahankan tipe aslinya, jangan paksa jadi jpg.
				if (scanBlob) {
					const ext = scanBlob.type === 'application/pdf' ? 'pdf' : 'jpg';
					scanFile = new File([scanBlob], `scan.${ext}`, { type: scanBlob.type || 'image/jpeg' });
				}
				draftSavedAt = new Date();
			}
			draftArmed = true;
		} catch (e: any) {
			metaError = e?.message || 'Gagal memuat data awal.';
		}
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void sjSnapshot();
		if (!draftArmed) return;
		sjPersist.save(sjSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(sjPersist, sjSnapshot));

	async function loadForEdit(id: number) {
		loadingEdit = true;
		try {
			const { header, items } = await fetchSjManualDetail(id);
			if (header.approval_status !== 'ditolak') {
				errorMsg = 'SJ ini tidak bisa direvisi (bukan status ditolak).';
				return;
			}
			customerName = header.manual_customer_name || '';
			customerAddress = header.manual_customer_address || '';
			customerPhone = header.manual_customer_phone || '';
			projectId = header.project_id ? String(header.project_id) : '';
			driverName = header.driver || '';
			notes = header.manual_notes || '';
			cart = (items || []).map((it: any) => ({
				itemId: it.item_id || null,
				nama: it.nama_barang || '',
				satuan: it.satuan || 'PCS',
				stokTersedia: 0,
				quantity: Number(it.qty) || 1
			}));
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat data SJ untuk direvisi.';
		} finally {
			loadingEdit = false;
		}
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		if (searchQuery.trim().length < 2) {
			searchResults = [];
			return;
		}
		searchTimer = setTimeout(async () => {
			searching = true;
			try {
				searchResults = await searchSjManualItems(searchQuery);
			} catch {
				searchResults = [];
			} finally {
				searching = false;
			}
		}, 300);
	}

	function addToCart(item: SjManualSearchItem) {
		if (cart.some((c) => c.itemId === item.id)) return;
		cart = [
			...cart,
			{
				itemId: item.id,
				nama: item.nama_barang_lengkap,
				satuan: item.satuan || 'PCS',
				stokTersedia: parseFloat(item.stok_tersedia) || 0,
				quantity: 1
			}
		];
		searchQuery = '';
		searchResults = [];
	}

	function addManualLine() {
		cart = [...cart, { itemId: null, nama: '', satuan: 'PCS', stokTersedia: 0, quantity: 1 }];
	}

	function removeFromCart(idx: number) {
		cart = cart.filter((_, i) => i !== idx);
	}

	function onScanFileChange(e: Event) {
		scanFile = (e.target as HTMLInputElement).files?.[0] || null;
		if (scanFile) sjPersist.savePhoto(SJ_SCAN_KEY, scanFile);
		else sjPersist.clearPhoto(SJ_SCAN_KEY);
	}

	function onFotoCaptured(file: File) {
		fotoFile = file;
		fotoPreviewUrl = URL.createObjectURL(file);
		showCamera = false;
		sjPersist.savePhoto(SJ_FOTO_KEY, file);
	}

	function removeFoto() {
		fotoFile = null;
		if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
		fotoPreviewUrl = '';
		sjPersist.clearPhoto(SJ_FOTO_KEY);
	}

	let canSubmit = $derived(
		!!customerName.trim() &&
			!!customerAddress.trim() &&
			cart.length > 0 &&
			cart.every((c) => c.nama.trim() && c.quantity > 0) &&
			!(meta?.requireScanUpload && !scanFile) &&
			!submitting
	);

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = '';
		try {
			const rawItems = cart.map((c) => ({
				itemId: c.itemId,
				namaBarang: c.nama,
				qty: c.quantity,
				satuan: c.satuan
			}));
			const parsed = sjManualPayloadSchema.safeParse({
				customerName,
				customerAddress,
				customerPhone: customerPhone || undefined,
				projectId: projectId || null,
				driverName: driverName || undefined,
				notes: notes || undefined,
				items: rawItems
			});
			if (!parsed.success) {
				errorMsg = parsed.error.issues[0]?.message || 'Data SJ Manual tidak valid.';
				submitting = false;
				return;
			}
			const compressedFotoFile = fotoFile ? await compressPhoto(fotoFile) : null;
			const payload = { ...parsed.data, scanFile, fotoFile: compressedFotoFile };
			const res = editId
				? await resubmitSjManual(Number(editId), payload)
				: await createSjManual(payload);
			successNomor = res.nomor_sj;
			// Terkirim — draf lokal (termasuk scan & foto di IndexedDB) sudah tidak relevan.
			sjPersist.clear();
			await sjPersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengajukan SJ Manual.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/sj-manual')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">SJ Manual {successNomor} terkirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Menunggu persetujuan.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/sj-manual')}>
				Kembali ke Daftar
			</button>
		</div>
	{:else if metaError}
		<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
			<div>{metaError}</div>
		</div>
	{:else if !meta || loadingEdit}
		<div class="flex flex-col items-center justify-center py-16">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat formulir surat jalan manual..." />
	</div>
	{:else if !meta.enabled}
		<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-800 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-amber-600" />
			<div>Fitur Surat Jalan Manual belum diaktifkan admin.</div>
		</div>
	{:else if !meta.canSubmit}
		<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-amber-800 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-amber-600" />
			<div>Role Anda belum diizinkan mengajukan SJ Manual. Hubungi admin.</div>
		</div>
	{:else}
		<TunggakanFisikWidget compact />
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">
			{editId ? 'Revisi Surat Jalan Manual' : 'Ajukan Surat Jalan Manual'}
		</h1>
		<div class="flex items-center justify-between gap-2 mb-4">
			<p class="text-[11px]" style="color: var(--sys-label3)">
				{editId ? 'Perbaiki data lalu ajukan ulang untuk persetujuan' : 'Pengiriman barang tanpa referensi Sales Order'}
			</p>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!fotoFile || !!scanFile} />
		</div>

		<div class="flex flex-col gap-4">
			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="cust-name">Tujuan Pengiriman *</label>
				<input id="cust-name" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" placeholder="Nama customer / lokasi tujuan" bind:value={customerName} />
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="cust-addr">Alamat Tujuan *</label>
				<textarea id="cust-addr" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" rows="2" bind:value={customerAddress}></textarea>
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="cust-phone">Telepon (opsional)</label>
				<input id="cust-phone" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" bind:value={customerPhone} />
			</div>

			{#if meta.projects.length > 0}
				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="project">Proyek Terkait (opsional)</label>
					<select id="project" class="w-full rounded-lg border text-[13px] p-3 bg-white" style="border-color: var(--sys-sep)" bind:value={projectId}>
						<option value="">— Tidak terkait proyek —</option>
						{#each meta.projects as p (p.id)}
							<option value={String(p.id)}>{p.name}</option>
						{/each}
					</select>
				</div>
			{/if}

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="driver">Nama Driver (opsional)</label>
				<input id="driver" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" bind:value={driverName} />
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="notes">Catatan / Alasan (opsional)</label>
				<textarea id="notes" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" rows="2" bind:value={notes}></textarea>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">
					Scan Dokumen {meta.requireScanUpload ? '*' : '(opsional)'}
				</p>
				{#if scanFile}
					<div class="p-2.5 rounded-lg border flex items-center justify-between" style="border-color: var(--sys-sep)">
						<span class="text-[12px] truncate" style="color: var(--sys-label)">{scanFile.name}</span>
						<button onclick={() => { scanFile = null; sjPersist.clearPhoto(SJ_SCAN_KEY); if (scanInputEl) scanInputEl.value = ''; }} aria-label="Hapus"><IconX size={16} class="text-red-500" /></button>
					</div>
				{:else}
					<button
						type="button"
						class="w-full h-11 rounded-lg border border-dashed flex items-center justify-center gap-2 text-[12px] font-medium"
						style="border-color: var(--sys-sep); color: var(--sys-label3)"
						onclick={() => scanInputEl?.click()}
					>
						<IconFileUpload size={16} /> Upload Scan (foto/PDF)
					</button>
					<input bind:this={scanInputEl} type="file" accept="image/*,.pdf" class="hidden" onchange={onScanFileChange} />
				{/if}
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Bukti (opsional)</p>
				{#if fotoFile}
					<div class="relative w-24 h-24">
						<img src={fotoPreviewUrl} alt="Foto bukti" class="w-24 h-24 object-cover rounded-lg border" style="border-color: var(--sys-sep)" />
						<button
							class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center"
							onclick={removeFoto}
							aria-label="Hapus foto"
						>
							<IconX size={12} />
						</button>
					</div>
				{:else}
					<button
						type="button"
						class="w-full h-11 rounded-lg border border-dashed flex items-center justify-center gap-2 text-[12px] font-medium"
						style="border-color: var(--sys-sep); color: var(--sys-label3)"
						onclick={() => (showCamera = true)}
					>
						<IconCamera size={16} /> Ambil Foto
					</button>
				{/if}
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Cari & Tambah Item</p>
				<div class="relative">
					<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
					<input
						class="w-full rounded-lg border text-[13px] p-3 pl-9"
						style="border-color: var(--sys-sep)"
						placeholder="Ketik nama barang..."
						bind:value={searchQuery}
						oninput={onSearchInput}
					/>
				</div>
				{#if searching}
					<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">Mencari...</p>
				{:else if searchResults.length > 0}
					<div class="mt-1.5 rounded-lg border overflow-hidden" style="border-color: var(--sys-sep)">
						{#each searchResults as r (r.id)}
							<button
								class="w-full flex items-center justify-between p-2.5 text-left text-[12px] border-b last:border-b-0 hover:bg-slate-50"
								style="border-color: var(--sys-sep)"
								onclick={() => addToCart(r)}
							>
								<div>
									<div class="font-medium" style="color: var(--sys-label)">{r.nama_barang_lengkap}</div>
									<div style="color: var(--sys-label3)">Stok: {parseFloat(r.stok_tersedia) || 0} {r.satuan || ''}</div>
								</div>
								<IconPlus size={16} style="color: var(--sys-label3)" />
							</button>
						{/each}
					</div>
				{/if}
				<button class="mt-2 text-[11px] font-semibold" style="color: var(--p, var(--g))" onclick={addManualLine}>
					+ Tambah item di luar master (ketik manual)
				</button>
			</div>

			{#if cart.length > 0}
				<div class="flex flex-col gap-2">
					<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Item Diajukan ({cart.length})</p>
					{#each cart as line, idx (idx)}
						<div class="p-3 rounded-lg border flex flex-col gap-2" style="border-color: var(--sys-sep)">
							<div class="flex items-start justify-between gap-2">
								{#if line.itemId}
									<div class="text-[13px] font-medium" style="color: var(--sys-label)">{line.nama}</div>
								{:else}
									<input
										class="flex-1 rounded-lg border text-[13px] p-2 mr-2"
										style="border-color: var(--sys-sep)"
										placeholder="Nama barang"
										bind:value={line.nama}
									/>
								{/if}
								<button onclick={() => removeFromCart(idx)} aria-label="Hapus"><IconTrash size={16} class="text-red-500" /></button>
							</div>
							<div class="grid grid-cols-2 gap-2">
								<div>
									<label class="text-[10px] block mb-1" style="color: var(--sys-label3)" for="qty-{idx}">Qty</label>
									<input
										id="qty-{idx}"
										type="number"
										min="0.01"
										step="0.01"
										class="w-full rounded-lg border text-[13px] p-2"
										style="border-color: var(--sys-sep)"
										bind:value={line.quantity}
									/>
								</div>
								<div>
									<label class="text-[10px] block mb-1" style="color: var(--sys-label3)" for="satuan-{idx}">Satuan</label>
									<input
										id="satuan-{idx}"
										class="w-full rounded-lg border text-[13px] p-2"
										style="border-color: var(--sys-sep)"
										bind:value={line.satuan}
									/>
								</div>
							</div>
							{#if line.itemId && line.quantity > line.stokTersedia}
								<p class="text-[10px] text-amber-600">Peringatan: stok tersedia hanya {line.stokTersedia}. Pengajuan tetap bisa dikirim, approver akan melihat catatan ini.</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			{#if errorMsg}
				<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
					<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
					<div>{errorMsg}</div>
				</div>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				{editId ? 'Ajukan Ulang' : 'Kirim Pengajuan'}
			</button>
		</div>
	{/if}
</div>

{#if showCamera}
	<CameraCaptureModal onCapture={onFotoCaptured} onClose={() => (showCamera = false)} />
{/if}
