<!-- src/routes/(app)/produksi/terima-bahan/+page.svelte -->
<!-- Fase 3 (12 Okt 2026): Kepala Regu menerima bahan baku SPK dari gudang (akun sendiri) dan
     mengusulkan retur sisa bahan. HANYA tracking — stok dipotong saat Start Production, bukan di sini.
     Permission: reuse `input_produksi_harian` (tidak membuat kunci baru yang butuh assignment role). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchSpkBahan,
		terimaBahan,
		ajukanReturBahan,
		type SpkBahan,
		type ReturnRow
	} from '$lib/services/terimaBahanApi';
	import { IconLoader2, IconCheck, IconRefresh, IconPackageImport } from '@tabler/icons-svelte';

	$effect(() => {
		if ($authStore.checked && !hasPermission($authStore.roleId, 'input_produksi_harian', $rolesStore)) {
			goto('/');
		}
	});

	let loading = $state(true);
	let error = $state('');
	let list = $state<SpkBahan[]>([]);
	let busyId = $state<number | null>(null);
	let notes = $state<Record<number, string>>({});
	let retur = $state<Record<number, ReturnRow[]>>({});
	let returOpen = $state<Record<number, boolean>>({});
	let feedback = $state<{ id: number; ok: boolean; msg: string } | null>(null);

	const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
		picking: { text: 'Gudang sedang menyiapkan', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
		ready: { text: 'Siap diambil di gudang', cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
		handed_over: { text: 'Sudah diterima', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' }
	};

	async function load() {
		loading = true;
		error = '';
		try {
			list = await fetchSpkBahan();
		} catch (e: any) {
			error = e?.message || 'Gagal memuat daftar SPK.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	function replace(updated: SpkBahan) {
		list = list.map((s) => (s.id === updated.id ? { ...s, ...updated, material_lot_data: updated.material_lot_data?.length ? updated.material_lot_data : s.material_lot_data } : s));
	}

	async function konfirmasi(s: SpkBahan) {
		busyId = s.id;
		feedback = null;
		try {
			replace(await terimaBahan(s.id, notes[s.id]));
			feedback = { id: s.id, ok: true, msg: 'Penerimaan bahan tercatat atas nama Anda.' };
		} catch (e: any) {
			feedback = { id: s.id, ok: false, msg: e?.message || 'Gagal menyimpan.' };
		} finally {
			busyId = null;
		}
	}

	function bukaRetur(s: SpkBahan) {
		returOpen[s.id] = !returOpen[s.id];
		if (!retur[s.id]) {
			// Baris = bahan yang benar-benar terpotong untuk SPK ini (dari ledger), bukan teks bebas.
			// Jumlah awal: usulan sebelumnya (bila mengubah laporan) atau 0.
			const prev = new Map((s.material_return_data || []).map((r) => [Number(r.item_id), Number(r.qty_kg) || 0]));
			retur[s.id] = (s.retur_bahan || []).map((b) => ({ item_id: b.item_id, nama: b.nama, qty_kg: prev.get(b.item_id) ?? 0, note: '' }));
		}
	}

	async function kirimRetur(s: SpkBahan) {
		busyId = s.id;
		feedback = null;
		try {
			replace(await ajukanReturBahan(s.id, (retur[s.id] || []).filter((r) => Number(r.qty_kg) > 0)));
			feedback = { id: s.id, ok: true, msg: 'Usulan retur terkirim ke gudang.' };
			returOpen[s.id] = false;
		} catch (e: any) {
			feedback = { id: s.id, ok: false, msg: e?.message || 'Gagal mengirim retur.' };
		} finally {
			busyId = null;
		}
	}

	const fmt = (d: string | null) => (d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-');
</script>

<svelte:head>
	<title>Terima Bahan Baku SPK — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-start justify-between gap-3 mb-4">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400">
				<IconPackageImport size={26} />
			</div>
			<div>
				<h1 class="text-2xl font-extrabold tracking-tight">Terima Bahan Baku SPK</h1>
				<p class="text-xs md:text-sm mt-0.5" style="color: var(--sys-label3)">Konfirmasi bahan dari gudang & laporkan sisa bahan</p>
			</div>
		</div>
		<button class="p-2 rounded-xl border border-black/10 dark:border-white/10" onclick={load} aria-label="Muat ulang" title="Muat ulang">
			<IconRefresh size={18} />
		</button>
	</div>

	<div class="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 text-xs mb-4" style="color: var(--sys-label2)">
		<b>Cara pakai:</b> (1) saat bahan sudah Anda terima di lantai kerja, tekan <i>Konfirmasi Bahan Diterima</i> — tercatat atas nama akun Anda.
		(2) Bila ada selisih timbangan atau kemasan rusak, tulis di kolom catatan sebelum konfirmasi.
		(3) Setelah produksi, bila ada sisa pelarut/bahan, buka <i>Lapor Sisa Bahan</i>. Halaman ini <b>tidak memotong stok</b>.
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat penerimaan bahan baku..." />
	</div>
	{:else if error}
		<div class="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">{error} <button class="underline ml-2" onclick={load}>Coba lagi</button></div>
	{:else if list.length === 0}
		<div class="rounded-xl border border-dashed border-black/15 dark:border-white/15 p-8 text-center text-sm" style="color: var(--sys-label3)">
			Belum ada SPK yang bahannya sedang disiapkan gudang. Daftar muncul setelah gudang mulai picking.
		</div>
	{:else}
		<div class="grid gap-3">
			{#each list as s (s.id)}
				{@const st = STATUS_LABEL[s.material_pick_status || ''] }
				{@const mine = s.material_received_karyawan_id != null && s.material_received_karyawan_id === $authStore.karyawanId}
				<div class="rounded-2xl border border-black/10 dark:border-white/10 p-4" style="background: var(--sys-card, transparent)">
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div>
							<div class="font-bold">{s.nomor}</div>
							<div class="text-xs" style="color: var(--sys-label3)">
								{s.jumlah_produksi ?? '-'} {s.unit || ''}{s.total_kg ? ` · ${s.total_kg} kg bahan` : ''} · Deadline {s.production_deadline || '-'}
							</div>
						</div>
						{#if st}<span class="text-[11px] font-semibold px-2 py-1 rounded-full {st.cls}">{st.text}</span>{/if}
					</div>

					{#if s.material_lot_data?.length}
						<ul class="mt-3 text-xs divide-y divide-black/5 dark:divide-white/5">
							{#each s.material_lot_data as l}
								<li class="py-1.5 flex justify-between gap-2">
									<span>{l.nama}{l.lot ? ` · Lot ${l.lot}` : ''}{l.drum ? ` · Drum ${l.drum}` : ''}</span>
									<span class="tabular-nums">{l.qty_actual_kg != null ? `${l.qty_actual_kg} kg` : ''}</span>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="mt-2 text-xs" style="color: var(--sys-label3)">Gudang belum mencatat lot/drum.</p>
					{/if}

					{#if s.material_handover_note}
						<p class="mt-2 text-xs" style="color: var(--sys-label3)">Catatan gudang: {s.material_handover_note}</p>
					{/if}

					{#if s.material_pick_status === 'handed_over'}
						<p class="mt-3 text-xs text-emerald-700 dark:text-emerald-300">
							✔ Diterima oleh <b>{s.material_received_by || '-'}</b>{mine ? ' (Anda)' : s.material_received_karyawan_id == null ? ' (dicatat gudang)' : ''} · {fmt(s.material_handover_at)}
						</p>
					{:else}
						<label class="block mt-3 text-xs" style="color: var(--sys-label2)">Catatan penerimaan <span class="opacity-60">(opsional: selisih timbangan, kemasan rusak)</span>
							<input class="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 py-2" bind:value={notes[s.id]} maxlength="500" />
						</label>
						<button
							class="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50"
							disabled={busyId === s.id}
							onclick={() => konfirmasi(s)}
						>
							{#if busyId === s.id}<IconLoader2 class="animate-spin" size={16} />{:else}<IconCheck size={16} />{/if}
							Konfirmasi Bahan Diterima di Lantai Kerja
						</button>
					{/if}

					{#if s.material_pick_status === 'handed_over'}
						<div class="mt-3 border-t border-black/5 dark:border-white/5 pt-3">
							{#if s.material_return_status === 'ditolak'}
								<p class="text-xs text-red-600">Usulan retur ditolak gudang. Anda bisa mengajukan ulang lewat tombol di bawah.</p>
							{/if}
							{#if s.material_return_status === 'diterima_gudang'}
								<p class="text-xs text-emerald-700 dark:text-emerald-300">✔ Retur sisa bahan sudah diterima gudang.</p>
							{:else}
								<button class="text-xs font-semibold underline" onclick={() => bukaRetur(s)}>
									{returOpen[s.id] ? 'Tutup' : s.material_return_status === 'diajukan' ? 'Ubah Laporan Sisa Bahan' : 'Lapor Sisa Bahan'}
								</button>
								{#if s.material_return_status === 'diajukan' && !returOpen[s.id]}
									<span class="text-[11px] ml-2 text-amber-700 dark:text-amber-300">Usulan retur menunggu gudang ({fmt(s.material_return_at)})</span>
								{/if}
								{#if returOpen[s.id]}
									<div class="mt-2 space-y-2">
										{#if s.retur_bahan === null}
											<p class="text-[11px] text-red-600">Daftar bahan terpotong gagal dimuat. Muat ulang halaman lalu coba lagi.</p>
										{:else if s.retur_bahan.length === 0}
											<p class="text-[11px]" style="color: var(--sys-label3)">Belum ada bahan yang tercatat terpotong untuk SPK ini (stok dipotong saat Start Production). Retur bisa dilaporkan setelah produksi dimulai.</p>
										{:else}
											<p class="text-[11px]" style="color: var(--sys-label3)">Isi jumlah sisa (kg) per bahan yang akan dikembalikan ke gudang. Kosongkan/0 bila tidak ada sisa. Jumlah maksimal = yang terpotong untuk SPK ini. Gudang menimbang ulang sebelum menerima.</p>
											{#each retur[s.id] || [] as r}
												{@const maks = s.retur_bahan.find((b) => b.item_id === r.item_id)?.maks_kg}
												<div class="grid grid-cols-[1fr_5.5rem] items-center gap-2">
													<div class="text-xs">{r.nama}<div class="text-[10px]" style="color: var(--sys-label3)">maks {maks ?? '-'} kg</div></div>
													<input type="number" min="0" max={maks} step="0.01" inputmode="decimal" class="rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 py-2 text-xs text-right" bind:value={r.qty_kg} />
												</div>
											{/each}
											<div class="flex gap-2">
												<button class="ml-auto px-3 py-2 rounded-xl bg-fuchsia-600 text-white text-xs font-semibold disabled:opacity-50" disabled={busyId === s.id} onclick={() => kirimRetur(s)}>Kirim ke Gudang</button>
											</div>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					{/if}

					{#if feedback?.id === s.id}
						<p class="mt-2 text-xs {feedback.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}">{feedback.msg}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
