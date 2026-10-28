<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Fase 6, Rencana Pertajam Rental Order v2 §9.2 L2/L4 — "Alat Sewa di Site Saya": daftar
	// alat sewa AKTIF (sudah datang, belum retur) di proyek milik leader yang login, dengan
	// countdown wajib kembali, nama & kontak vendor, dan aksi Retur Dini (L4).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconLoader2, IconTruckReturn, IconClock, IconBuildingWarehouse } from '@tabler/icons-svelte';
	import { fetchSewaAlatSiteSaya, requestReturDini, type SewaAlatSiteRow } from '$lib/services/sewaAlatLapanganApi';
	import { getKaryawanByEmail } from '$lib/services/karyawan';
	import { authStore } from '$lib/stores/auth';
	import { FieldHint } from '$lib/components/hints';

	let loading = $state(true);
	let rows = $state<SewaAlatSiteRow[]>([]);
	let currentKaryawanName = $state('');

	let returDiniOpenId = $state<number | null>(null);
	let returDiniAlasan = $state('');
	let returDiniSubmitting = $state(false);

	const STATUS_LABEL: Record<string, string> = {
		di_gudang: 'Di Gudang',
		di_site: 'Di Site Proyek',
		akan_kembali: 'Akan Kembali'
	};

	async function load() {
		loading = true;
		try {
			rows = await fetchSewaAlatSiteSaya();
		} catch (e) {
			console.error('Gagal memuat alat sewa:', e);
			rows = [];
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		const unsub = authStore.subscribe(async (s) => {
			if (!s.checked || !s.user?.email) return;
			try {
				const kary = await getKaryawanByEmail(s.user.email);
				currentKaryawanName = kary?.nama_karyawan || s.user.displayName || 'Leader';
			} catch {
				currentKaryawanName = s.user.displayName || 'Leader';
			}
			await load();
		});
		return unsub;
	});

	function bukaFormReturDini(id: number) {
		returDiniOpenId = id;
		returDiniAlasan = '';
	}

	async function kirimReturDini(id: number) {
		if (!returDiniAlasan.trim()) {
			alert('Alasan retur dini wajib diisi (mis. "pekerjaan sudah selesai, alat tidak dipakai lagi").');
			return;
		}
		returDiniSubmitting = true;
		try {
			await requestReturDini(id, returDiniAlasan, currentKaryawanName);
			returDiniOpenId = null;
			await load();
		} catch (e: any) {
			alert(e?.message || 'Gagal mengirim permintaan retur dini.');
		} finally {
			returDiniSubmitting = false;
		}
	}

	function warnaCountdown(hari: number | null): string {
		if (hari == null) return 'var(--sys-label3)';
		if (hari < 0) return '#dc2626';
		if (hari <= 3) return '#ea580c';
		return 'var(--sys-label3)';
	}

	function labelCountdown(hari: number | null): string {
		if (hari == null) return 'Tanggal kembali belum diisi';
		if (hari < 0) return `TERLAMBAT ${Math.abs(hari)} hari`;
		if (hari === 0) return 'Wajib kembali HARI INI';
		return `Kembali dalam ${hari} hari`;
	}
</script>

<svelte:head>
	<title>Alat Sewa di Site Saya</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full">
	<div class="px-4 py-3 border-b flex items-center justify-between" style="border-color: var(--sys-sep)">
		<button type="button" class="flex items-center gap-1 text-sm text-gray-500" onclick={() => goto('/')}>
			<IconArrowLeft size={16} /> Kembali
		</button>
		<div class="flex items-center gap-2">
			<button
				type="button"
				class="px-3 py-1.5 rounded-lg text-xs font-semibold"
				style="background: #cffafe; color: #155e75"
				title="Alat milik Eltama yang DISEWAKAN ke customer di proyek Anda — catat timesheet & BBM"
				onclick={() => goto('/sewa-keluar')}
			>
				🚚 Log Sewa Keluar
			</button>
			<button
				type="button"
				class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white"
				style="background: #ea580c"
				onclick={() => goto('/sewa-alat/ajukan')}
			>
				+ Ajukan Sewa Baru
			</button>
		</div>
	</div>

	<div class="scroll-body px-4 py-4 max-w-2xl mx-auto w-full space-y-3">
		<div>
			<p class="text-base font-bold" style="color: var(--sys-label)">🔶 Alat Sewa di Site Saya</p>
			<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
				Alat yang kita SEWA dari vendor, sedang aktif di proyek Anda. Bukan aset perusahaan — nilai Rp 0 di pembukuan, wajib
				dikembalikan sesuai jadwal.
			</p>
		</div>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat daftar sewa alat..." />
		</div>
		{:else if rows.length === 0}
			<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
				<IconBuildingWarehouse size={32} class="mx-auto mb-2" style="color: var(--sys-label3)" />
				<p class="text-sm font-semibold" style="color: var(--sys-label)">Belum ada alat sewa aktif</p>
				<p class="text-xs mt-1" style="color: var(--sys-label3)">
					Kalau proyek Anda butuh alat dari vendor (genset, compressor, scaffolding, dll), ajukan lewat tombol di atas.
				</p>
			</div>
		{:else}
			{#each rows as row (row.id)}
				<div class="rounded-xl p-3 border-l-4" style="background: #fff7ed; border-color: #ea580c;">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0 flex-1">
							<p class="text-sm font-bold truncate" style="color: #9a3412">
								{row.items.map((it) => `${it.nama_barang} (${it.qty} ${it.satuan})`).join(', ') || 'Alat sewa'}
							</p>
							<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
								Proyek: {row.project_name} · Vendor: {row.vendor_name}
							</p>
						</div>
						<span class="text-[10px] px-2 py-0.5 rounded-full shrink-0 font-semibold" style="background: #fed7aa; color: #9a3412">
							{STATUS_LABEL[row.status] || row.status}
						</span>
					</div>

					<div class="flex items-center gap-1.5 mt-2 text-xs font-semibold" style="color: {warnaCountdown(row.hariTersisa)}">
						<IconClock size={14} />
						{labelCountdown(row.hariTersisa)}
						{#if row.end_date}
							<span class="font-normal" style="color: var(--sys-label3)">
								({new Date(row.end_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })})
							</span>
						{/if}
					</div>

					{#if returDiniOpenId === row.id}
						<div class="mt-2 space-y-1.5">
							<textarea
								class="f-input w-full text-xs"
								rows="2"
								placeholder="Contoh: Pekerjaan sudah selesai, alat tidak dipakai lagi"
								bind:value={returDiniAlasan}
							></textarea>
							<FieldHint text="Ini hanya PERMINTAAN ke admin/satpam — alat baru benar-benar tercatat kembali saat vendor menjemput & discan di gerbang." />
							<div class="flex gap-2">
								<button
									type="button"
									class="px-3 py-1.5 rounded-lg text-xs font-semibold text-white flex items-center gap-1"
									style="background: #ea580c"
									disabled={returDiniSubmitting}
									onclick={() => kirimReturDini(row.id)}
								>
									{#if returDiniSubmitting}<IconLoader2 size={14} class="animate-spin" />{/if}
									Kirim Permintaan
								</button>
								<button
									type="button"
									class="px-3 py-1.5 rounded-lg text-xs font-semibold"
									style="background: var(--sys-fill); color: var(--sys-label)"
									onclick={() => (returDiniOpenId = null)}
								>
									Batal
								</button>
							</div>
						</div>
					{:else if row.status !== 'akan_kembali'}
						<button
							type="button"
							class="mt-2 flex items-center gap-1 text-xs font-semibold"
							style="color: #ea580c"
							onclick={() => bukaFormReturDini(row.id)}
						>
							<IconTruckReturn size={14} /> Retur Dini
						</button>
					{:else}
						<p class="mt-2 text-xs italic" style="color: var(--sys-label3)">Sudah diminta retur dini, menunggu vendor menjemput.</p>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>
