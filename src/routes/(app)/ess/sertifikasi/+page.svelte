<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getMySertifikasi, saveSertifikasi, type SertifikasiItem } from '$lib/services/ess/sertifikasi';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconPlus, IconCertificate } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let items = $state<SertifikasiItem[]>([]);

	let showForm = $state(false);
	let editingId = $state<number | null>(null);
	let namaSertifikasi = $state('');
	let penerbit = $state('');
	let tanggalTerbit = $state('');
	let tanggalExpired = $state('');
	let file = $state<File | null>(null);
	let saving = $state(false);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			items = await getMySertifikasi();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat sertifikasi.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const URGENSI_LABEL: Record<string, { text: string; color: string }> = {
		aman: { text: 'Berlaku', color: '#16A34A' },
		perhatian: { text: 'Perhatian', color: '#D97706' },
		segera: { text: 'Segera Perpanjang', color: '#EA580C' },
		kedaluwarsa: { text: 'Kedaluwarsa', color: '#DC2626' }
	};

	function openAddForm() {
		editingId = null;
		namaSertifikasi = '';
		penerbit = '';
		tanggalTerbit = '';
		tanggalExpired = '';
		file = null;
		showForm = true;
	}

	function openRenewForm(item: SertifikasiItem) {
		editingId = item.id;
		namaSertifikasi = item.nama_sertifikasi;
		penerbit = item.penerbit || '';
		tanggalTerbit = '';
		tanggalExpired = '';
		file = null;
		showForm = true;
	}

	function onFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		file = target.files?.[0] || null;
	}

	async function handleSave() {
		if (!namaSertifikasi) {
			errorMsg = 'Nama sertifikasi wajib diisi.';
			return;
		}
		saving = true;
		try {
			await saveSertifikasi({
				id: editingId || undefined,
				nama_sertifikasi: namaSertifikasi,
				penerbit,
				tanggal_terbit: tanggalTerbit,
				tanggal_expired: tanggalExpired,
				file
			});
			showForm = false;
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<div class="flex items-center justify-between mb-1">
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Sertifikasi Saya</h1>
		<button class="flex items-center gap-1 text-[11px] font-bold" style="color: var(--p, #2563EB)" onclick={openAddForm}>
			<IconPlus size={14} /> Tambah
		</button>
	</div>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Daftar sertifikasi & masa berlaku (SIM, K3, MCU, dll)</p>

	{#if showForm}
		<div class="glass-panel rounded-2xl p-4 mb-4 flex flex-col gap-2">
			<p class="text-[12px] font-bold mb-1" style="color: var(--sys-label)">{editingId ? 'Perpanjang Sertifikasi' : 'Tambah Sertifikasi'}</p>
			<input bind:value={namaSertifikasi} placeholder="Nama sertifikasi (mis. SIM A, K3 Umum, MCU)" class="text-[12px] p-2.5 rounded-lg border border-gray-200" />
			<input bind:value={penerbit} placeholder="Penerbit (opsional)" class="text-[12px] p-2.5 rounded-lg border border-gray-200" />
			<div class="grid grid-cols-2 gap-2">
				<div>
					<label for="tgl-terbit" class="text-[10px]" style="color: var(--sys-label4)">Tanggal Terbit</label>
					<input id="tgl-terbit" type="date" bind:value={tanggalTerbit} class="w-full text-[12px] p-2.5 rounded-lg border border-gray-200" />
				</div>
				<div>
					<label for="tgl-expired" class="text-[10px]" style="color: var(--sys-label4)">Tanggal Expired</label>
					<input id="tgl-expired" type="date" bind:value={tanggalExpired} class="w-full text-[12px] p-2.5 rounded-lg border border-gray-200" />
				</div>
			</div>
			<input type="file" onchange={onFileChange} class="text-[11px]" />
			<div class="flex gap-2 mt-2">
				<button class="flex-1 px-4 py-2 rounded-xl text-[12px] font-bold text-white gradient-bg disabled:opacity-50" disabled={saving} onclick={handleSave}>
					{saving ? 'Menyimpan...' : 'Simpan'}
				</button>
				<button class="px-4 py-2 rounded-xl text-[12px] font-semibold" style="color: var(--sys-label3)" onclick={() => (showForm = false)}>Batal</button>
			</div>
		</div>
	{/if}

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data sertifikasi..." />
		</div>
	{:else if errorMsg}
		<div class="rounded-lg p-4" style="background: var(--rel)">
			<p class="text-[12px] flex items-center gap-1.5" style="color: #DC2626"><IconAlertTriangle size={14} /> {errorMsg}</p>
			<button class="mt-2 text-[11px] font-semibold underline" style="color: #DC2626" onclick={load}>Coba lagi</button>
		</div>
	{:else if items.length === 0}
		<div class="glass-panel rounded-2xl p-6 text-center">
			<IconCertificate size={28} class="mx-auto mb-2" style="color: var(--sys-label4)" />
			<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada sertifikasi tercatat.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each items as item}
				<div class="glass-panel rounded-2xl p-4">
					<div class="flex items-start justify-between gap-2">
						<div>
							<p class="text-[12px] font-semibold" style="color: var(--sys-label)">{item.nama_sertifikasi}</p>
							{#if item.penerbit}<p class="text-[10px]" style="color: var(--sys-label4)">{item.penerbit}</p>{/if}
						</div>
						<span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0" style="color: {URGENSI_LABEL[item.urgensi].color}; background: {URGENSI_LABEL[item.urgensi].color}15">
							{URGENSI_LABEL[item.urgensi].text}
						</span>
					</div>
					{#if item.tanggal_expired}
						<p class="text-[10px] mt-1" style="color: var(--sys-label4)">
							Berlaku s/d {item.tanggal_expired}{item.hariLagi != null ? ` (${item.hariLagi >= 0 ? item.hariLagi + ' hari lagi' : Math.abs(item.hariLagi) + ' hari lewat'})` : ''}
						</p>
					{/if}
					{#if item.urgensi === 'segera' || item.urgensi === 'kedaluwarsa'}
						<button class="mt-2 text-[11px] font-semibold" style="color: var(--p, #2563EB)" onclick={() => openRenewForm(item)}>Perpanjang</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
