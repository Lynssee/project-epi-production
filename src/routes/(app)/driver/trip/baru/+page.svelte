<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getAvailableVehicles, startTrip, getCurrentPosition, sendCheckpoint } from '$lib/services/driver';
	import { IconLoader2, IconTruck, IconArrowLeft } from '@tabler/icons-svelte';

	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let vehicles = $state<any[]>([]);

	let vehicleId = $state('');
	let kmAwal = $state<number | null>(null);
	let tujuan = $state('');
	let keperluan = $state('');
	let catatanDriver = $state('');
	let jenis = $state<'umum' | 'logistik_harian'>('umum');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'execute_trip', roles)) {
			goto('/driver');
		}
	});

	onMount(async () => {
		vehicles = await getAvailableVehicles();
		loading = false;
	});

	async function submit() {
		errorMsg = '';
		if (!vehicleId) { errorMsg = 'Pilih kendaraan terlebih dahulu.'; return; }
		if (kmAwal == null || kmAwal < 0) { errorMsg = 'KM awal wajib diisi.'; return; }

		saving = true;
		try {
			const res = await startTrip({
				vehicle_id: vehicleId,
				km_awal: kmAwal,
				tujuan: tujuan.trim(),
				keperluan: keperluan.trim(),
				catatan_driver: catatanDriver.trim(),
				jenis
			});

			if ('queued' in res) {
				errorMsg = '';
				goto('/driver');
				return;
			}

			const tripId = res.record?.id;

			// Checkpoint otomatis saat mulai trip — gagal diam-diam, tidak menghalangi alur utama.
			try {
				const pos = await getCurrentPosition();
				await sendCheckpoint({
					trip_log_id: tripId,
					label: 'Berangkat',
					latitude: pos.coords.latitude,
					longitude: pos.coords.longitude,
					odometer: kmAwal
				});
			} catch {
				/* lokasi opsional, jangan blokir trip */
			}

			goto(tripId ? `/driver/trip/${tripId}` : '/driver');
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memulai trip.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/driver')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Mulai Trip</h1>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat armada & tujuan..." />
		{:else}
			{#if errorMsg}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
			{/if}

			<div class="flex flex-col gap-3">
				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Kendaraan</label>
					<select class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={vehicleId}>
						<option value="">Pilih kendaraan tersedia…</option>
						{#each vehicles as v}
							<option value={v.id}>{v.name} {v.code ? `(${v.code})` : ''}</option>
						{/each}
					</select>
					{#if vehicles.length === 0}
						<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Tidak ada kendaraan tersedia saat ini.</p>
					{/if}
				</div>

				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">KM Awal</label>
					<input type="number" min="0" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={kmAwal} />
				</div>

				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Jenis Trip</label>
					<select class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={jenis}>
						<option value="umum">Umum</option>
						<option value="logistik_harian">Logistik Harian (antar barang, perlu POD)</option>
					</select>
				</div>

				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Tujuan</label>
					<input class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={tujuan} />
				</div>

				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Keperluan</label>
					<input class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={keperluan} />
				</div>

				<div>
					<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Catatan (opsional)</label>
					<textarea rows="2" class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={catatanDriver}></textarea>
				</div>

				<button
					class="w-full rounded-lg py-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
					style="background: #1F6592"
					disabled={saving}
					onclick={submit}
				>
					{#if saving}
						<IconLoader2 size={16} class="animate-spin" />
					{:else}
						<IconTruck size={16} />
					{/if}
					{saving ? 'Memulai…' : 'Mulai Trip'}
				</button>
			</div>
		{/if}
	</div>
</div>
