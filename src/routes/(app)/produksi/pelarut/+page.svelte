<!-- src/routes/(app)/produksi/pelarut/+page.svelte -->
<!-- Pelacak Pelarut Daur Ulang — Tahap A (13 Okt 2026): catat pelarut (Xylene/thinner) yang DIKUMPULKAN dari
     pembilasan dan yang DIPAKAI ULANG di SPK. Hanya pencatatan: stok & jurnal TIDAK berubah.
     Permission: reuse `input_produksi_harian`. Daftar pelarut diatur admin di Setelan Produksi. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchPelarut, catatPelarut, type PelarutItem, type SpkOpsi, type PelarutLog } from '$lib/services/pelarutApi';
	import { IconLoader2, IconRecycle, IconRefresh } from '@tabler/icons-svelte';

	$effect(() => {
		if ($authStore.checked && !hasPermission($authStore.roleId, 'input_produksi_harian', $rolesStore)) goto('/');
	});

	let loading = $state(true);
	let error = $state('');
	let items = $state<PelarutItem[]>([]);
	let spkList = $state<SpkOpsi[]>([]);
	let riwayat = $state<PelarutLog[]>([]);

	let jenis = $state<'dikumpulkan' | 'dipakai_ulang'>('dikumpulkan');
	let itemId = $state<number | ''>('');
	let qty = $state<number | ''>('');
	let spkId = $state<number | ''>('');
	let sumber = $state('pembilas_alat');
	let catatan = $state('');
	let saving = $state(false);
	let feedback = $state<{ ok: boolean; msg: string } | null>(null);

	async function load() {
		loading = true;
		error = '';
		try {
			const d = await fetchPelarut();
			items = d.items;
			spkList = d.spk;
			riwayat = d.riwayat;
			if (itemId === '' && items.length === 1) itemId = items[0].id;
		} catch (e: any) {
			error = e?.message || 'Gagal memuat data.';
		} finally {
			loading = false;
		}
	}
	onMount(() => void load());

	async function simpan() {
		feedback = null;
		if (itemId === '' || !(Number(qty) > 0)) {
			feedback = { ok: false, msg: 'Pilih pelarut dan isi jumlah (kg) lebih dari 0.' };
			return;
		}
		if (jenis === 'dipakai_ulang' && spkId === '') {
			feedback = { ok: false, msg: 'Pilih SPK tempat pelarut dipakai ulang.' };
			return;
		}
		saving = true;
		try {
			const row = await catatPelarut({
				jenis,
				item_id: Number(itemId),
				qty_kg: Number(qty),
				spk_id: spkId === '' ? null : Number(spkId),
				sumber: jenis === 'dikumpulkan' ? sumber : null,
				catatan
			});
			riwayat = [row, ...riwayat].slice(0, 30);
			qty = '';
			catatan = '';
			feedback = { ok: true, msg: 'Tercatat. Terima kasih!' };
		} catch (e: any) {
			feedback = { ok: false, msg: e?.message || 'Gagal menyimpan.' };
		} finally {
			saving = false;
		}
	}

	const nama = (id: number) => items.find((i) => i.id === id)?.nama || `Barang #${id}`;
	const nomorSpk = (id: number | null) => (id ? spkList.find((s) => s.id === id)?.nomor || `SPK #${id}` : '-');
	const fmt = (d: string) => new Date(d).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
</script>

<svelte:head>
	<title>Pelarut Daur Ulang — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<div class="flex items-start justify-between gap-3 mb-4">
		<div class="flex items-center gap-3">
			<div class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><IconRecycle size={26} /></div>
			<div>
				<h1 class="text-2xl font-extrabold tracking-tight">Pelarut Daur Ulang</h1>
				<p class="text-xs md:text-sm mt-0.5" style="color: var(--sys-label3)">Catat pelarut yang dikumpulkan & dipakai ulang</p>
			</div>
		</div>
		<button class="p-2 rounded-xl border border-black/10 dark:border-white/10" onclick={load} aria-label="Muat ulang" title="Muat ulang"><IconRefresh size={18} /></button>
	</div>

	<div class="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs mb-4" style="color: var(--sys-label2)">
		<b>Cara pakai:</b> pilih <i>Dikumpulkan</i> saat Anda menampung sisa pelarut dari pembilasan mixer/alat (isi berat dalam kg). Pilih <i>Dipakai ulang</i>
		saat pelarut tampungan itu dipakai di SPK (pilih SPK-nya). Catatan ini dipakai manajemen untuk menghitung penghematan pelarut baru.
		Halaman ini <b>tidak mengubah stok</b>.
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat daur ulang pelarut..." />
	</div>
	{:else if error}
		<div class="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-600">{error} <button class="underline ml-2" onclick={load}>Coba lagi</button></div>
	{:else if items.length === 0}
		<div class="rounded-xl border border-dashed border-black/15 dark:border-white/15 p-8 text-center text-sm" style="color: var(--sys-label3)">
			Daftar pelarut belum diatur. Minta admin mengisi <b>Daftar Pelarut untuk Pelacak Daur Ulang</b> di Setelan Produksi (ERP).
		</div>
	{:else}
		<div class="rounded-2xl border border-black/10 dark:border-white/10 p-4 space-y-3">
			<div class="grid grid-cols-2 gap-2">
				<button class="py-2.5 rounded-xl text-sm font-semibold border {jenis === 'dikumpulkan' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-black/10 dark:border-white/10'}" onclick={() => (jenis = 'dikumpulkan')}>Dikumpulkan</button>
				<button class="py-2.5 rounded-xl text-sm font-semibold border {jenis === 'dipakai_ulang' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-black/10 dark:border-white/10'}" onclick={() => (jenis = 'dipakai_ulang')}>Dipakai Ulang</button>
			</div>

			<label class="block text-xs" style="color: var(--sys-label2)">Pelarut
				<select class="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 py-2.5 text-sm" bind:value={itemId}>
					<option value="">— pilih —</option>
					{#each items as i}<option value={i.id}>{i.nama}</option>{/each}
				</select>
			</label>

			<label class="block text-xs" style="color: var(--sys-label2)">Jumlah (kg)
				<input type="number" min="0" step="0.01" inputmode="decimal" class="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 py-2.5 text-sm" bind:value={qty} />
			</label>

			{#if jenis === 'dipakai_ulang'}
				<label class="block text-xs" style="color: var(--sys-label2)">SPK tempat dipakai <span class="opacity-60">(wajib)</span>
					<select class="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 py-2.5 text-sm" bind:value={spkId}>
						<option value="">— pilih SPK —</option>
						{#each spkList as s}<option value={s.id}>{s.nomor}</option>{/each}
					</select>
				</label>
			{:else}
				<label class="block text-xs" style="color: var(--sys-label2)">Asal pelarut
					<select class="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 py-2.5 text-sm" bind:value={sumber}>
						<option value="pembilas_alat">Pembilas alat/mixer</option>
						<option value="pembersihan_tangki">Pembersihan tangki</option>
						<option value="lainnya">Lainnya</option>
					</select>
				</label>
			{/if}

			<label class="block text-xs" style="color: var(--sys-label2)">Catatan <span class="opacity-60">(opsional)</span>
				<input class="mt-1 w-full rounded-lg border border-black/10 dark:border-white/10 bg-transparent px-2 py-2.5 text-sm" bind:value={catatan} maxlength="300" />
			</label>

			<button class="w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50" disabled={saving} onclick={simpan}>
				{saving ? 'Menyimpan…' : 'Simpan Catatan'}
			</button>
			{#if feedback}<p class="text-xs {feedback.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600'}">{feedback.msg}</p>{/if}
		</div>

		<h2 class="mt-5 mb-2 text-sm font-bold">Catatan Saya (30 terakhir)</h2>
		{#if riwayat.length === 0}
			<p class="text-xs" style="color: var(--sys-label3)">Belum ada catatan.</p>
		{:else}
			<ul class="divide-y divide-black/5 dark:divide-white/5 text-xs rounded-2xl border border-black/10 dark:border-white/10 px-3">
				{#each riwayat as r (r.id)}
					<li class="py-2 flex justify-between gap-2">
						<span>
							<b>{r.jenis === 'dikumpulkan' ? 'Dikumpulkan' : 'Dipakai ulang'}</b> · {nama(r.item_id)}
							{#if r.spk_id} · {nomorSpk(r.spk_id)}{/if}
							<span class="block opacity-70">{fmt(r.tanggal)}{r.catatan ? ` — ${r.catatan}` : ''}</span>
						</span>
						<span class="tabular-nums font-semibold">{r.qty_kg} kg</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
