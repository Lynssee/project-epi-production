<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fetchVisitorsInside, submitVisitor, checkoutVisitor, submitVehicleLog } from '$lib/services/security';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';

	let subTab = $state<'tamu' | 'kendaraan'>('tamu');
	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	let visitorsInside = $state<any[]>([]);
	let visitorForm = $state({ nama: '', instansi: '', tujuan_pic: '', no_identitas: '', kartu_no: '' });

	let vehicleForm = $state({ plat: '', jenis: 'mobil', pengemudi: '', arah: 'in' as 'in' | 'out', tujuan: '', no_sj_manual: '' });

	async function loadAll() {
		loading = true;
		try {
			visitorsInside = await fetchVisitorsInside();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat data tamu.';
		}
		loading = false;
	}
	onMount(loadAll);

	async function submitVisitorForm() {
		errorMsg = ''; successMsg = '';
		if (!visitorForm.nama.trim()) { errorMsg = 'Nama tamu wajib diisi.'; return; }
		saving = true;
		try {
			await submitVisitor({ ...visitorForm });
			successMsg = 'Tamu tercatat masuk.';
			visitorForm = { nama: '', instansi: '', tujuan_pic: '', no_identitas: '', kartu_no: '' };
			await loadAll();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan tamu.';
		}
		saving = false;
	}

	async function doCheckout(id: number) {
		try {
			await checkoutVisitor(id);
			await loadAll();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal check-out.';
		}
	}

	async function submitVehicleForm() {
		errorMsg = ''; successMsg = '';
		if (!vehicleForm.plat.trim()) { errorMsg = 'Plat nomor wajib diisi.'; return; }
		saving = true;
		try {
			await submitVehicleLog({ ...vehicleForm });
			successMsg = 'Kendaraan tercatat.';
			vehicleForm = { plat: '', jenis: 'mobil', pengemudi: '', arah: 'in', tujuan: '', no_sj_manual: '' };
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan kendaraan.';
		}
		saving = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/satpam')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Tamu & Kendaraan</h1>
		</div>

		<div class="flex gap-2 mb-4">
			<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold" style="background: {subTab === 'tamu' ? 'var(--g)' : 'var(--sys-fill)'}; color: {subTab === 'tamu' ? 'white' : 'var(--sys-label)'}" onclick={() => (subTab = 'tamu')}>Tamu</button>
			<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold" style="background: {subTab === 'kendaraan' ? 'var(--g)' : 'var(--sys-fill)'}; color: {subTab === 'kendaraan' ? 'white' : 'var(--sys-label)'}" onclick={() => (subTab = 'kendaraan')}>Kendaraan</button>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat buku tamu pos satpam..." />
		</div>
		{:else if subTab === 'tamu'}
			{#if visitorsInside.length > 0}
				<div class="rounded-xl p-3 mb-4" style="background: #F5F3FF; border: 1px solid #DDD6FE">
					<p class="text-[11px] font-semibold mb-1" style="color: #6D28D9">Tamu di Dalam ({visitorsInside.length})</p>
					{#each visitorsInside as v}
						<div class="flex justify-between items-center text-[12px] py-0.5" style="color: #6D28D9">
							<span>{v.nama} ({v.tujuan_pic || '-'})</span>
							<button class="text-[11px] underline" onclick={() => doCheckout(v.id)}>Check-out</button>
						</div>
					{/each}
				</div>
			{/if}

			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Nama tamu" bind:value={visitorForm.nama} />
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Instansi" bind:value={visitorForm.instansi} />
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Tujuan / PIC yang dituju" bind:value={visitorForm.tujuan_pic} />
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="No. Identitas (opsional)" bind:value={visitorForm.no_identitas} />
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="No. Kartu Visitor (opsional)" bind:value={visitorForm.kartu_no} />

			<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitVisitorForm}>
				{saving ? 'Menyimpan…' : 'Tamu Masuk'}
			</button>
		{:else}
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Plat nomor" bind:value={vehicleForm.plat} />
			<div class="grid grid-cols-2 gap-2 mb-2">
				<select class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={vehicleForm.jenis}>
					<option value="mobil">Mobil</option>
					<option value="motor">Motor</option>
					<option value="truk">Truk</option>
				</select>
				<select class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={vehicleForm.arah}>
					<option value="in">Masuk</option>
					<option value="out">Keluar</option>
				</select>
			</div>
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Nama pengemudi" bind:value={vehicleForm.pengemudi} />
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Tujuan / muatan" bind:value={vehicleForm.tujuan} />
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="No. Surat Jalan (opsional)" bind:value={vehicleForm.no_sj_manual} />

			<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitVehicleForm}>
				{saving ? 'Menyimpan…' : 'Catat Kendaraan'}
			</button>
		{/if}
	</div>
</div>
