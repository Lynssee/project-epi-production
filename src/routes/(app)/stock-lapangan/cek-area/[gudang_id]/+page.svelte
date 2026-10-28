<!-- src/routes/(app)/stock-lapangan/cek-area/[gudang_id]/+page.svelte -->
<!-- Fase 3 (Rencana Sistem Penempatan Area Inventory & Verifikasi Barcode v2, 20 Agu 2026):
     verifikasi/cek-area satu rak. GERBANG STOK: hasil di sini HANYA laporan (gudang_verifikasi/
     gudang_verifikasi_item) -- TIDAK PERNAH mengubah stock_transactions/stok. Penyesuaian stok
     kalau perlu tetap lewat jalur manual /inventory/verifikasi-lapangan yang sudah ada. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchAreaDetail, fetchAreaDenahContext, submitCekArea as submitCekAreaApi,
		type PlacementRow, type PicRow, type DenahContext, type CekAreaItemInput
	} from '$lib/services/cekAreaApi';
	import { enqueueCekArea, registerCekAreaAutoFlush, flushCekAreaQueue } from '$lib/utils/offlineCekAreaQueue';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { secureAssetSrc } from '$lib/actions/secureAsset';
	import {
		IconChevronLeft, IconLoader2, IconAlertTriangle, IconCheck, IconPhone,
		IconCamera, IconCircleCheck
	} from '@tabler/icons-svelte';

	const gudangId = Number(page.params.gudang_id);

	let loading = $state(true);
	let loadError = $state('');
	let gudang = $state<any>(null);
	let parentNama = $state<string | null>(null);
	let placements = $state<PlacementRow[]>([]);
	let pics = $state<PicRow[]>([]);
	let denahCtx = $state<DenahContext | null>(null);

	let canSubmit = $derived(
		hasPermission($authStore.roleId, 'verify_area_inventory', $rolesStore) ||
		pics.some((p) => p.id === $authStore.karyawanId)
	);

	// Hitungan aktual per placement -- SENGAJA null (kosong) di awal, bukan pre-isi expected_qty,
	// supaya user benar-benar menghitung fisik dulu (instruksi: "isi 0 kalau tidak ketemu, jangan dikosongkan").
	let actuals = $state<Record<number, number | null>>({});
	let masalahOpen = $state<Record<number, boolean>>({});
	let masalahJenis = $state<Record<number, string>>({});
	let masalahDeskripsi = $state<Record<number, string>>({});

	function setActual(id: number, val: number) {
		actuals[id] = Math.max(0, val);
	}

	function diffFor(p: PlacementRow): number | null {
		const a = actuals[p.id];
		if (a == null) return null;
		return a - (p.expected_qty ?? 0);
	}

	function toneFor(p: PlacementRow): 'neutral' | 'green' | 'amber' | 'red' {
		const a = actuals[p.id];
		if (a == null) return 'neutral';
		const diff = diffFor(p);
		if (diff === 0 && !masalahOpen[p.id]) return 'green';
		if (masalahJenis[p.id] === 'tidak_ada' || masalahJenis[p.id] === 'salah_item' || masalahJenis[p.id] === 'rusak') return 'red';
		return 'amber';
	}

	const TONE_COLOR: Record<string, string> = { neutral: '#94a3b8', green: '#16a34a', amber: '#d97706', red: '#dc2626' };

	let allFilled = $derived(placements.every((p) => actuals[p.id] != null));
	let totalSelisih = $derived(placements.reduce((sum, p) => sum + Math.abs(diffFor(p) || 0), 0));

	async function load() {
		loading = true;
		loadError = '';
		try {
			const detail = await fetchAreaDetail(gudangId);
			gudang = detail.gudang;
			parentNama = detail.parentNama;
			placements = detail.placements;
			pics = detail.pics;
			denahCtx = await fetchAreaDenahContext(gudangId).catch(() => null);
			await loadInventorySettings();
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Gagal memuat data rak';
		} finally {
			loading = false;
		}
	}

	function semuaSesuai() {
		for (const p of placements) {
			actuals[p.id] = p.expected_qty ?? 0;
			masalahOpen[p.id] = false;
		}
		actuals = { ...actuals };
	}

	let CameraCaptureModal = $state<any>(null);
	async function loadCamera() {
		CameraCaptureModal ??= (await import('$lib/components/scanner/CameraCaptureModal.svelte')).default;
	}
	let showCamera = $state(false);
	let fotoFile = $state<File | null>(null);
	let fotoPreview = $state<string | null>(null);

	async function handleCapture(file: File) {
		showCamera = false;
		const gps = await getCurrentPosition().catch(() => null);
		const gpsPlain = gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null;
		const compressed = await compressPhoto(file);
		const stamped = await watermarkPhoto(compressed, gpsPlain);
		fotoFile = stamped;
		fotoPreview = URL.createObjectURL(stamped);
	}

	let submitting = $state(false);
	let submitError = $state('');
	let submitDone = $state(false);
	let queuedOffline = $state(false);
	let resultStatus = $state('');
	let catatan = $state('');

	async function handleSubmit() {
		submitError = '';
		const wajibFoto = getInventorySetting('inventory.area_tracking.verifikasi_wajib_foto');
		if (wajibFoto && !fotoFile) {
			submitError = 'Foto kondisi wajib diisi (diatur di Setelan Inventory).';
			return;
		}
		if (!allFilled) {
			submitError = 'Isi hitungan aktual untuk semua item dulu (isi 0 kalau tidak ketemu).';
			return;
		}
		submitting = true;
		const clientTxnId = `cekarea-${gudangId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const items: CekAreaItemInput[] = placements.map((p) => ({
			identitas_barang_id: p.identitas_barang_id,
			expected_qty: p.expected_qty,
			actual_qty: actuals[p.id] ?? 0,
			jenis_masalah: masalahOpen[p.id] ? masalahJenis[p.id] || null : null,
			deskripsi: masalahOpen[p.id] ? masalahDeskripsi[p.id] || null : null
		}));
		try {
			const gps = await getCurrentPosition().catch(() => null);
			// Foto diunggah lebih dulu (butuh koneksi) -- kalau ini gagal karena offline,
			// lempar ke catatan bawah: entri masuk antrean TANPA foto (keterbatasan Fase 3,
			// lihat interface CekAreaSubmitPayload.foto_kondisi). Data hitungan tetap aman.
			let fotoKondisiId: string | null = null;
			if (fotoFile) {
				fotoKondisiId = await uploadEvidencePhoto(fotoFile, 'gudang_verifikasi:foto_kondisi');
			}
			const res = await submitCekAreaApi({
				gudang_id: gudangId,
				client_txn_id: clientTxnId,
				items,
				jenis: 'genba',
				catatan: catatan || null,
				gps_lat: gps?.lat ?? null,
				gps_lng: gps?.lng ?? null,
				source: 'field:scan',
				foto_kondisi: fotoKondisiId
			});
			resultStatus = res.status || '';
			submitDone = true;
		} catch (err) {
			if (err instanceof TypeError) {
				try {
					await enqueueCekArea({
						gudang_id: gudangId,
						client_txn_id: clientTxnId,
						items,
						catatan: catatan || null
					});
					submitDone = true;
					queuedOffline = true;
				} catch (queueErr) {
					submitError = queueErr instanceof Error ? queueErr.message : 'Gagal menyimpan hasil cek-area secara offline.';
				}
			} else {
				submitError = err instanceof Error ? err.message : 'Gagal mengirim hasil cek-area.';
			}
		}
		submitting = false;
	}

	function panggilPic(pic: PicRow) {
		if (!pic.no_hp) return;
		const num = pic.no_hp.replace(/[^0-9]/g, '').replace(/^0/, '62');
		window.open(`https://wa.me/${num}`, '_blank');
	}

	onMount(() => {
		load();
		registerCekAreaAutoFlush(async (entry) => {
			await submitCekAreaApi(entry as any);
		});
		flushCekAreaQueue(async (entry) => {
			await submitCekAreaApi(entry as any);
		}).catch(() => {});
	});
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-4 py-4 flex items-center gap-3">
			<button class="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center" onclick={() => goto('/stock-lapangan/cek-area')} aria-label="Kembali">
				<IconChevronLeft size={18} />
			</button>
			<div class="min-w-0">
				<h1 class="text-base font-black truncate" style="color: var(--sys-label)">{gudang?.nama_gudang || 'Memuat...'}</h1>
				<p class="text-[11px] font-medium" style="color: var(--sys-label3)">{parentNama ? `di dalam ${parentNama}` : 'Level teratas'}</p>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 py-5 pb-28">
		<div class="max-w-md mx-auto w-full space-y-4">
			{#if loading}
				<CircularProgressGauge size={48} strokeWidth={4} label="Memuat form cek area gudang..." />
			{:else if loadError}
				<div class="rounded-xl p-4 text-sm text-center" style="background:#fef2f2;color:#dc2626">{loadError}</div>
			{:else if submitDone}
				<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<IconCircleCheck size={32} style="color: var(--g); margin: 0 auto 8px" />
					<p class="text-sm font-bold mb-1" style="color: var(--sys-label)">
						{queuedOffline ? 'Tersimpan — menunggu sinyal' : 'Hasil cek-area terkirim'}
					</p>
					<p class="text-xs mb-4" style="color: var(--sys-label3)">
						{queuedOffline
							? 'Sinyal buruk — hasil tersimpan di HP ini dan akan terkirim otomatis begitu koneksi kembali.'
							: resultStatus === 'match'
								? 'Semua item sesuai.'
								: resultStatus === 'mismatch'
									? 'Ada mismatch — akan masuk daftar diskrepansi untuk ditindaklanjuti PIC.'
									: 'Ada selisih dalam toleransi — tercatat.'}
					</p>
					<button class="w-full rounded-lg py-2.5 text-sm font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan/cek-area')}>
						Kembali ke Cek Area
					</button>
				</div>
			{:else}
				{#if denahCtx}
					<div class="rounded-xl overflow-hidden border border-slate-200 relative">
						<img use:secureAssetSrc={denahCtx.gambarId} alt={denahCtx.namaDenah} class="w-full h-40 object-cover" />
						<div
							class="absolute w-5 h-5 rounded-full border-2 border-white shadow-lg -translate-x-1/2 -translate-y-1/2 animate-pulse"
							style="left:{denahCtx.x_pct}%; top:{denahCtx.y_pct}%; background:#0d9488;"
						></div>
					</div>
				{/if}

				{#if pics.length}
					<div class="flex flex-wrap gap-2">
						{#each pics as pic}
							<button class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" onclick={() => panggilPic(pic)} disabled={!pic.no_hp}>
								<IconPhone size={13} /> {pic.nama_karyawan}
							</button>
						{/each}
					</div>
				{:else}
					<div class="rounded-xl p-3 text-xs" style="background:#fffbeb; border:1px solid #fde68a; color:#92400e">
						⚠️ Rak ini belum punya PIC.
					</div>
				{/if}

				{#if placements.length === 0}
					<div class="rounded-xl p-6 text-center text-sm text-slate-400 border border-dashed border-slate-200">
						Belum ada item ditempatkan di rak ini. Atur dulu lewat Master Gudang di dashboard admin.
					</div>
				{:else}
					<div class="flex items-center justify-between">
						<p class="text-xs font-bold text-slate-500 uppercase">{placements.length} Item</p>
						<button class="text-xs font-bold text-teal-600 flex items-center gap-1" onclick={semuaSesuai}>
							<IconCheck size={14} /> Semua Sesuai
						</button>
					</div>

					<div class="space-y-2">
						{#each placements as p (p.id)}
							{@const tone = toneFor(p)}
							<div class="rounded-xl p-3 border" style="background:white; border-color:{TONE_COLOR[tone]}33">
								<div class="flex items-center justify-between gap-2 mb-2">
									<p class="text-xs font-bold flex-1 min-w-0 truncate" style="color: var(--sys-label)">{p.item?.nama_barang_lengkap || `#${p.identitas_barang_id}`}</p>
									<span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style="background:{TONE_COLOR[tone]}22; color:{TONE_COLOR[tone]}">
										Rencana: {p.expected_qty ?? '-'}{p.ledgerQty != null ? ` · Sistem: ${p.ledgerQty}` : ''}
									</span>
								</div>
								<div class="flex items-center gap-2">
									<button class="w-9 h-9 rounded-lg bg-slate-100 text-lg font-bold" onclick={() => setActual(p.id, (actuals[p.id] ?? 0) - 1)}>−</button>
									<input
										type="number"
										inputmode="decimal"
										placeholder="0"
										value={actuals[p.id] ?? ''}
										oninput={(e) => setActual(p.id, Number((e.target as HTMLInputElement).value) || 0)}
										class="flex-1 text-center rounded-lg border border-slate-200 py-2 text-lg font-bold"
									/>
									<button class="w-9 h-9 rounded-lg bg-slate-100 text-lg font-bold" onclick={() => setActual(p.id, (actuals[p.id] ?? 0) + 1)}>+</button>
								</div>
								{#if actuals[p.id] != null && diffFor(p) !== 0}
									<button class="text-[11px] font-bold mt-2 flex items-center gap-1" style="color:{TONE_COLOR.amber}" onclick={() => (masalahOpen[p.id] = !masalahOpen[p.id])}>
										<IconAlertTriangle size={12} /> Selisih {diffFor(p)! > 0 ? '+' : ''}{diffFor(p)} — {masalahOpen[p.id] ? 'Tutup detail' : 'Ada Masalah?'}
									</button>
									{#if masalahOpen[p.id]}
										<div class="mt-2 space-y-2 pt-2 border-t border-slate-100">
											<select bind:value={masalahJenis[p.id]} class="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs">
												<option value="">- Jenis masalah -</option>
												<option value="kurang">Kurang</option>
												<option value="lebih">Lebih</option>
												<option value="tidak_ada">Tidak Ada</option>
												<option value="salah_item">Salah Item</option>
												<option value="rusak">Rusak</option>
											</select>
											<textarea bind:value={masalahDeskripsi[p.id]} placeholder="Deskripsi singkat (opsional)" rows="2" class="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"></textarea>
										</div>
									{/if}
								{/if}
							</div>
						{/each}
					</div>

					{#if totalSelisih > 0}
						<div class="rounded-xl p-3 text-center text-xs font-bold" style="background:#fffbeb; color:#92400e; border:1px solid #fde68a">
							Total selisih absolut: {totalSelisih}
						</div>
					{/if}

					<div class="rounded-xl p-3 border border-slate-200 bg-white">
						<p class="text-[10px] font-bold uppercase mb-1.5 text-slate-500">Foto Kondisi Rak</p>
						{#if fotoPreview}
							<img src={fotoPreview} alt="Foto kondisi" class="w-full h-32 object-cover rounded-lg mb-2" />
						{/if}
						<button class="w-full rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-1.5 bg-slate-100 text-slate-600" onclick={async () => { await loadCamera(); showCamera = true; }}>
							<IconCamera size={14} /> {fotoFile ? 'Ambil Ulang Foto' : 'Ambil Foto'}
						</button>
					</div>

					<textarea bind:value={catatan} placeholder="Catatan umum (opsional)" rows="2" class="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"></textarea>

					{#if submitError}
						<p class="text-xs text-center" style="color:#dc2626">{submitError}</p>
					{/if}

					{#if !canSubmit}
						<p class="text-xs text-center rounded-lg py-2" style="background:#fffbeb; color:#92400e">
							Hanya PIC rak ini atau SPV ke atas yang bisa mengirim hasil. Anda tetap bisa menghitung, tapi tidak bisa mengirim.
						</p>
					{:else}
						<button
							class="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50"
							style="background: linear-gradient(135deg,#0d9488,#0f766e)"
							disabled={submitting || !allFilled}
							onclick={handleSubmit}
						>
							{submitting ? 'Mengirim...' : 'Kirim Hasil Cek-Area'}
						</button>
					{/if}
				{/if}
			{/if}
		</div>
	</div>
</div>

{#if showCamera && CameraCaptureModal}
	<CameraCaptureModal onCapture={handleCapture} onClose={() => (showCamera = false)} />
{/if}
