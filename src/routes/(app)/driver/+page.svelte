<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { resolveDriverId, getActiveTrip, getRecentTrips, startDailyTask } from '$lib/services/driver';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { IconTruck, IconLoader2, IconMapPin, IconClock, IconPlus, IconClipboardCheck, IconClipboardList, IconSun, IconFileText } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let activeTrip = $state<any>(null);
	let recentTrips = $state<any[]>([]);
	let startingDailyTask = $state(false);
	let dailyTaskError = $state('');

	// BK Gate v2 Fase 7, diperbaiki Gate Ketat SJ v3 Fase 5 — lembar rangkap peran driver
	// (peruntukan_role='driver', BUKAN hardcode warna hijau lagi) yang masih dipegang driver.
	let lembarHijau = $state<any[]>([]);
	let setoringId = $state<number | null>(null);

	async function loadLembarHijau() {
		try {
			const token = await getIdToken();
			const res = await fetch('/api/driver/rangkap', { headers: { Authorization: `Bearer ${token}` } });
			if (res.ok) lembarHijau = (await res.json()).lembar || [];
		} catch {
			/* diam-diam — bukan bagian utama layar driver */
		}
	}

	async function setorLembar(rangkapId: number) {
		setoringId = rangkapId;
		try {
			const token = await getIdToken();
			const res = await fetch('/api/driver/rangkap', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ rangkapId })
			});
			if (res.ok) lembarHijau = lembarHijau.filter((l) => l.rangkap_id !== rangkapId);
		} finally {
			setoringId = null;
		}
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'access_driver', roles)) {
			goto('/');
		}
	});

	onMount(async () => {
		const karyawanId = $authStore.karyawanId;
		if (!karyawanId) {
			errorMsg = 'Profil karyawan tidak ditemukan di sesi login. Hubungi admin.';
			loading = false;
			return;
		}

		try {
			const driverId = await resolveDriverId(karyawanId);
			[activeTrip, recentTrips] = await Promise.all([
				getActiveTrip(driverId),
				getRecentTrips(driverId, 5)
			]);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat data driver.';
		}
		loading = false;
		loadLembarHijau();
	});

	async function handleStartDailyTask() {
		startingDailyTask = true;
		dailyTaskError = '';
		try {
			const result = await startDailyTask();
			if (result.needsVehicleSelection) {
				// Belum ada kendaraan langganan (fleet_driver_assignment) — pilih manual di P2H.
				goto('/driver/check');
				return;
			}
			goto(`/driver/check?vehicle=${result.booking.vehicle_id}&booking=${result.booking.id}`);
		} catch (err) {
			dailyTaskError = err instanceof Error ? err.message : 'Gagal memulai tugas hari ini.';
		} finally {
			startingDailyTask = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Driver</h1>
				<p class="text-[11px]" style="color: var(--sys-label3)">Tugas & trip hari ini</p>
			</div>
			<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--gl)">
				<IconTruck size={18} style="color: var(--g)" />
			</div>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat penugasan driver..." />
		{:else if errorMsg}
			<div class="rounded-lg p-4 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
		{:else}
			{#if dailyTaskError}
				<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{dailyTaskError}</div>
			{/if}

			<button
				class="w-full rounded-xl p-4 mb-4 flex items-center gap-3 text-left disabled:opacity-60"
				style="background: var(--gl)"
				disabled={startingDailyTask}
				onclick={handleStartDailyTask}
			>
				{#if startingDailyTask}
					<IconLoader2 size={20} class="animate-spin" style="color: var(--g)" />
				{:else}
					<IconSun size={20} style="color: var(--g)" />
				{/if}
				<div>
					<p class="text-[13px] font-bold" style="color: var(--sys-label)">Mulai Tugas Hari Ini</p>
					<p class="text-[11px]" style="color: var(--sys-label3)">Buat pengajuan operasional harian otomatis, langsung ke P2H</p>
				</div>
			</button>

			{#if activeTrip}
				<button
					class="w-full text-left rounded-xl p-4 mb-4 border"
					style="background: var(--b6); border-color: var(--blue)"
					onclick={() => goto(`/driver/trip/${activeTrip.id}`)}
				>
					<p class="text-[11px] font-semibold mb-1" style="color: var(--blue)">Trip Berjalan</p>
					<p class="text-[14px] font-bold" style="color: var(--sys-label)">{activeTrip.tujuan || 'Tanpa tujuan tercatat'}</p>
					<p class="text-[11px] mt-1" style="color: var(--sys-label3)">KM awal: {activeTrip.km_awal ?? '-'}</p>
				</button>
			{:else}
				<button
					class="w-full rounded-xl p-6 mb-4 text-center flex flex-col items-center gap-1"
					style="background: var(--sys-fill); border: 1px dashed var(--sys-sep)"
					onclick={() => goto('/driver/trip/baru')}
				>
					<IconPlus size={20} style="color: var(--sys-label3)" />
					<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Mulai Trip Baru</p>
				</button>
			{/if}

			<button
				class="w-full rounded-lg p-3 mb-4 flex items-center gap-2"
				style="background: var(--sys-fill)"
				onclick={() => goto('/driver/check')}
			>
				<IconClipboardCheck size={16} style="color: #1F6592" />
				<span class="text-[12px] font-semibold" style="color: var(--sys-label)">Cek Kendaraan (P2H) & BBM</span>
			</button>

			<button
				class="w-full rounded-lg p-3 mb-4 flex items-center gap-2"
				style="background: var(--sys-fill)"
				onclick={() => goto('/driver/delegasi')}
			>
				<IconClipboardList size={16} style="color: #1F6592" />
				<span class="text-[12px] font-semibold" style="color: var(--sys-label)">Delegasi Surat Jalan</span>
			</button>

			{#if lembarHijau.length > 0}
				<div class="rounded-xl p-3 mb-4" style="background: var(--gl2, var(--gl)); border: 1px solid var(--green, #22C55E)">
					<div class="flex items-center gap-2 mb-2">
						<IconFileText size={16} style="color: #16A34A" />
						<span class="text-[12px] font-bold" style="color: var(--sys-label)">Lembar Anda Belum Disetor ({lembarHijau.length})</span>
					</div>
					<p class="text-[10px] mb-2" style="color: var(--sys-label3)">Lembar rangkap SJ yang Anda pegang sebagai driver — setor ke admin gudang setelah trip selesai.</p>
					<div class="flex flex-col gap-2">
						{#each lembarHijau as l (l.rangkap_id)}
							<div class="w-full rounded-lg p-2.5 flex items-center justify-between gap-2" style="background: var(--sys-bg)">
								<div class="min-w-0 flex items-center gap-2">
									<span class="w-2.5 h-2.5 rounded-full shrink-0 border" style="background: {l.warna_hex || '#22C55E'}"></span>
									<div class="min-w-0">
										<p class="text-[12px] font-semibold truncate" style="color: var(--sys-label)">{l.nomor_sj} — {l.lembar_nama}</p>
										{#if l.tujuan}<p class="text-[10px] truncate" style="color: var(--sys-label3)">{l.tujuan}</p>{/if}
									</div>
								</div>
								<button
									class="text-[11px] font-semibold px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-50"
									style="background: #16A34A; color: white"
									disabled={setoringId === l.rangkap_id}
									onclick={() => setorLembar(l.rangkap_id)}
								>
									{setoringId === l.rangkap_id ? 'Menyetor…' : 'Setor'}
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<h2 class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Riwayat Trip Terakhir</h2>
			{#if recentTrips.length === 0}
				<p class="text-[11px]" style="color: var(--sys-label3)">Belum ada riwayat trip.</p>
			{:else}
				<div class="flex flex-col gap-2">
					{#each recentTrips as trip}
						<button class="w-full text-left rounded-lg p-3 flex items-center justify-between" style="background: var(--sys-fill)" onclick={() => goto(`/driver/trip/${trip.id}`)}>
							<div class="min-w-0">
								<p class="text-[12px] font-medium truncate" style="color: var(--sys-label)">{trip.tujuan || 'Tanpa tujuan'}</p>
								<p class="text-[10px] flex items-center gap-1 mt-0.5" style="color: var(--sys-label3)">
									<IconClock size={11} />
									{trip.tanggal_berangkat ? new Date(trip.tanggal_berangkat).toLocaleDateString('id-ID') : '-'}
								</p>
							</div>
							<span class="text-[10px] font-semibold px-2 py-1 rounded-full" style="background: {trip.status === 'active' ? 'var(--aml)' : 'var(--gg)'}; color: {trip.status === 'active' ? 'var(--amd)' : 'var(--ggd)'}">
								{trip.status === 'active' ? 'Berjalan' : 'Selesai'}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
