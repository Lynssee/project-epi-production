<!-- src/routes/(app)/ruangan/[areaId]/+page.svelte -->
<!--
	Halaman Ruangan (Barang per Ruangan via QR Patroli) — inti permintaan: scan QR
	patroli di pintu -> lihat barang apa saja yang tercatat di ruangan itu.
	Fase 2: read-only untuk semua karyawan login. Fase 3: tombol "+ Barang" aktif
	untuk pemegang permission kelola_aset_ruangan (sensus). Fase 4: Cek Kelengkapan
	(siapa pun login) & Lapor per barang (rusak/pindah/hilang) aktif.
-->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchRuangan, laporBarang, type RuanganDetail } from '$lib/services/gaRuangan';
	import {
		IconArrowLeft,
		IconLoader2,
		IconAlertTriangle,
		IconMapPin,
		IconClipboardCheck,
		IconShieldCheck,
		IconPlus,
		IconFlag
	} from '@tabler/icons-svelte';

	const areaId = Number(page.params.areaId);
	const canKelola = $derived(hasPermission($authStore.roleId, 'kelola_aset_ruangan', $rolesStore, $authStore.roleIds));

	// Lapor 1 barang (rusak/pindah/hilang) -- modal ringan di halaman ini.
	let laporAsset = $state<{ id: number; nama: string } | null>(null);
	let laporJenis = $state<'rusak' | 'pindah' | 'hilang'>('rusak');
	let laporCatatan = $state('');
	let laporSaving = $state(false);
	let laporErr = $state('');
	let laporDone = $state(false);

	function openLapor(asset: { id: number; nama: string }) {
		laporAsset = asset;
		laporJenis = 'rusak';
		laporCatatan = '';
		laporErr = '';
		laporDone = false;
	}
	async function submitLapor() {
		if (!laporAsset) return;
		laporSaving = true;
		laporErr = '';
		try {
			await laporBarang({ asset_id: laporAsset.id, jenis: laporJenis, catatan: laporCatatan || null });
			laporDone = true;
		} catch (err) {
			laporErr = err instanceof Error ? err.message : 'Gagal mengirim laporan.';
		}
		laporSaving = false;
	}

	let status = $state<'loading' | 'error' | 'ok'>('loading');
	let errorMsg = $state('');
	let data = $state<RuanganDetail | null>(null);

	const KATEGORI_LABEL: Record<string, string> = {
		perabotan: 'PERABOTAN',
		elektronik: 'ELEKTRONIK',
		peralatan: 'PERALATAN',
		lainnya: 'LAINNYA'
	};
	const KONDISI_LABEL: Record<string, string> = {
		baik: 'Baik',
		perlu_perbaikan: 'Perlu perbaikan',
		rusak: 'Rusak'
	};

	function kondisiStyle(k: string): string {
		if (k === 'rusak') return 'background: var(--rel); color: var(--red)';
		if (k === 'perlu_perbaikan') return 'background: rgba(234,179,8,.14); color: #a16207';
		return 'background: rgba(34,197,94,.14); color: #15803d';
	}

	function hariLalu(iso: string | null): string {
		if (!iso) return '—';
		const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
		if (d <= 0) return 'hari ini';
		if (d === 1) return 'kemarin';
		return `${d} hari lalu`;
	}

	function rupiah(n: number | null): string {
		if (n == null) return '—';
		return 'Rp ' + Math.round(n).toLocaleString('id-ID');
	}

	const grouped = $derived.by(() => {
		const g = new Map<string, RuanganDetail['assets']>();
		for (const a of data?.assets ?? []) {
			const key = a.kategori || 'lainnya';
			if (!g.has(key)) g.set(key, []);
			g.get(key)!.push(a);
		}
		return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	});

	const perluDicek = $derived.by(() => {
		const w = data?.last_check?.waktu ?? null;
		const interval = data?.interval_cek_hari ?? 30;
		if (!data || data.assets.length === 0) return false;
		if (!w) return true;
		return Date.now() - new Date(w).getTime() > interval * 86_400_000;
	});

	async function load() {
		status = 'loading';
		try {
			data = await fetchRuangan(areaId);
			status = 'ok';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat data ruangan.';
			status = 'error';
		}
	}

	onMount(() => {
		if (!Number.isFinite(areaId) || areaId <= 0) {
			errorMsg = 'ID ruangan tidak valid.';
			status = 'error';
			return;
		}
		load();
	});
</script>

<svelte:head><title>{data?.room.area_name ?? 'Ruangan'} — Barang per Ruangan</title></svelte:head>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button
				class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
				style="background: var(--sys-fill)"
				onclick={() => goto('/ruangan')}
				aria-label="Kembali ke daftar ruangan"
			>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold flex-1" style="color: var(--sys-label)">
				{data?.room.area_name ?? 'Ruangan'}
			</h1>
			{#if canKelola && status === 'ok'}
				<button
					class="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-white flex items-center gap-1"
					style="background: var(--g)"
					onclick={() => goto(`/ruangan/${areaId}/tambah`)}
					title="Tambah barang yang belum tercatat di ruangan ini (sensus)."
				>
					<IconPlus size={14} /> Barang
				</button>
			{/if}
		</div>

		{#if status === 'ok' && data && data.assets.length > 0}
			<button
				class="w-full rounded-xl py-2.5 mb-3 text-[13px] font-semibold flex items-center justify-center gap-2"
				style="background: var(--sys-fill); color: var(--sys-label); border: 1px solid var(--sys-sep)"
				onclick={() => goto(`/ruangan/${areaId}/cek`)}
				title="Cocokkan barang fisik dengan daftar ini. Hasil selisih dikirim ke Admin GA untuk dikonfirmasi."
			>
				<IconClipboardCheck size={16} /> Cek Kelengkapan
			</button>
		{/if}

		{#if status === 'loading'}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat detail area & checklist..." />
		</div>
		{:else if status === 'error'}
			<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconAlertTriangle size={28} style="color: var(--red); margin: 0 auto 8px" />
				<p class="text-[12px] mb-4" style="color: var(--sys-label3)">{errorMsg}</p>
				<button class="rounded-lg py-2 px-4 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={load}>
					Coba lagi
				</button>
			</div>
		{:else if data}
			<!-- Header ruangan -->
			<div class="rounded-xl p-4 mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<div class="flex items-center gap-1.5 text-[12px] mb-2" style="color: var(--sys-label3)">
					<IconMapPin size={13} />
					<span>{data.room.zone_name ?? 'Tanpa zona'} · {data.room.location_name ?? '—'}</span>
				</div>
				<div class="grid grid-cols-2 gap-2 text-[11px]" style="color: var(--sys-label3)">
					<div
						class="flex items-center gap-1.5"
						title="Tanggal terakhir ada petugas mencocokkan barang fisik dengan daftar ini."
					>
						<IconClipboardCheck size={13} />
						<span>Dicek: {hariLalu(data.last_check?.waktu ?? null)}</span>
					</div>
					<div class="flex items-center gap-1.5" title="Scan patroli/QR terakhir di pintu ruangan ini.">
						<IconShieldCheck size={13} />
						<span>Patroli: {hariLalu(data.last_patrol?.waktu ?? null)}</span>
					</div>
				</div>
				{#if perluDicek}
					<div class="mt-2 rounded-lg px-2.5 py-1.5 text-[11px]" style="background: rgba(234,179,8,.14); color: #a16207">
						Barang ruangan ini belum dicek lebih dari {data.interval_cek_hari} hari.
					</div>
				{/if}
			</div>

			<!-- Ringkasan -->
			<div class="grid grid-cols-3 gap-2 mb-3">
				<div class="rounded-xl p-3 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<div class="text-[18px] font-bold" style="color: var(--sys-label)">{data.summary.jenis}</div>
					<div class="text-[10px]" style="color: var(--sys-label3)">jenis</div>
				</div>
				<div class="rounded-xl p-3 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<div class="text-[18px] font-bold" style="color: var(--sys-label)">{data.summary.total_unit}</div>
					<div class="text-[10px]" style="color: var(--sys-label3)">unit</div>
				</div>
				<div class="rounded-xl p-3 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<div class="text-[18px] font-bold" style="color: {data.summary.total_rusak > 0 ? 'var(--red)' : 'var(--sys-label)'}">
						{data.summary.total_rusak}
					</div>
					<div class="text-[10px]" style="color: var(--sys-label3)">rusak</div>
				</div>
			</div>

			<p class="text-[11px] mb-3" style="color: var(--sys-label4)">
				Daftar ini sesuai catatan GA. Kalau barang di ruangan tidak sama, laporkan ke Admin GA —
				jangan dipindahkan diam-diam.
			</p>

			{#if data.assets.length === 0}
				<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
					<p class="text-[12px]" style="color: var(--sys-label3)">
						Belum ada barang tercatat di ruangan ini. Minta Admin GA melakukan sensus.
					</p>
				</div>
			{:else}
				{#each grouped as [kategori, items] (kategori)}
					<h2 class="text-[11px] font-semibold mt-4 mb-1.5 tracking-wide" style="color: var(--sys-label3)">
						{KATEGORI_LABEL[kategori] ?? kategori.toUpperCase()}
					</h2>
					<div class="rounded-xl overflow-hidden" style="border: 1px solid var(--sys-sep)">
						{#each items as a, i (a.id)}
							<div
								class="flex items-center gap-2 px-3 py-2.5 text-[12px]"
								style="background: var(--sys-fill); {i > 0 ? 'border-top: 1px solid var(--sys-sep)' : ''}"
							>
								<div class="flex-1 min-w-0">
									<div class="font-medium truncate" style="color: var(--sys-label)">
										{a.nama}{a.kode ? ` · ${a.kode}` : ''}
									</div>
									<div class="text-[10px]" style="color: var(--sys-label4)">
										{a.mode_lacak === 'kolektif' ? `× ${a.qty}` : '1 unit'}
										{#if a.qty_rusak > 0}· {a.qty_rusak} rusak{/if}
										{#if a.identitas_barang_id == null}· belum tertaut katalog{/if}
										{#if data.show_nilai && a.nilai != null}· {rupiah(a.nilai)}{/if}
									</div>
								</div>
								<span
									class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
									style={kondisiStyle(a.kondisi)}
									title="Baik / Perlu perbaikan / Rusak — diperbarui dari laporan & cek kelengkapan."
								>
									{KONDISI_LABEL[a.kondisi] ?? a.kondisi}
								</span>
								<button
									class="shrink-0 text-[10px] font-medium px-2 py-1 rounded-lg"
									style="color: var(--sys-label3); background: var(--sys-bg)"
									onclick={() => openLapor({ id: a.id, nama: a.nama })}
									title="Lapor kalau barang ini rusak, pindah, atau tidak ada di tempat."
								>
									<IconFlag size={11} class="inline -mt-0.5" /> Lapor
								</button>
							</div>
						{/each}
					</div>
				{/each}
			{/if}

		{/if}
	</div>
</div>

{#if laporAsset}
	<div class="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-50 p-4" onclick={() => !laporSaving && (laporAsset = null)}>
		<div class="bg-[var(--sys-bg)] rounded-xl p-5 w-full max-w-sm" style="border: 1px solid var(--sys-sep)" onclick={(e) => e.stopPropagation()}>
			{#if laporDone}
				<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Laporan terkirim</p>
				<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
					{laporJenis === 'rusak'
						? 'Tiket Service Desk GA sudah dibuat. Admin GA akan menindaklanjuti.'
						: 'Laporan dikirim ke Admin GA untuk dikonfirmasi. Daftar ruangan belum berubah sampai dikonfirmasi.'}
				</p>
				<button
					class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white"
					style="background: var(--g)"
					onclick={() => {
						laporAsset = null;
						load();
					}}
				>
					Tutup
				</button>
			{:else}
				<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Lapor: {laporAsset.nama}</p>
				<p class="text-[11px] mb-3" style="color: var(--sys-label4)">
					Pilih rusak kalau barang fisik rusak — tiket perbaikan dibuat otomatis. Pilih pindah/hilang
					kalau barang tidak ada di tempat seharusnya.
				</p>
				<div class="flex gap-2 mb-3">
					{#each [['rusak', 'Rusak'], ['pindah', 'Pindah'], ['hilang', 'Hilang']] as [val, label]}
						<button
							class="flex-1 rounded-lg py-2 text-[12px] font-semibold border"
							style={laporJenis === val
								? 'background: var(--g); color: #fff; border-color: var(--g)'
								: 'background: var(--sys-fill); color: var(--sys-label); border-color: var(--sys-sep)'}
							onclick={() => (laporJenis = val as typeof laporJenis)}
						>{label}</button>
					{/each}
				</div>
				<textarea
					bind:value={laporCatatan}
					rows="2"
					placeholder="Catatan (opsional)"
					class="w-full rounded-lg p-2.5 mb-3 text-[12px]"
					style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label)"
				></textarea>
				{#if laporErr}
					<p class="text-[11px] mb-2" style="color: var(--red)">{laporErr}</p>
				{/if}
				<div class="flex gap-2">
					<button class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => (laporAsset = null)}>
						Batal
					</button>
					<button
						class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
						style="background: var(--g)"
						disabled={laporSaving}
						onclick={submitLapor}
					>
						{laporSaving ? 'Mengirim…' : 'Kirim Laporan'}
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}
