<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// ESS HRD v3 Fase 3 Modul 4 — kalender shift diri sendiri + ajukan tukar shift.
	// Rotasi terbatas: shift_roster murni kalender/tampilan, tidak memengaruhi payroll.

	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { auth } from '$lib/firebase';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';

	interface RosterRow {
		id: string;
		tanggal: string;
		status: string;
		swap_with: number | null;
		jadwal_kerja_id: { id: string; nama_jadwal: string } | null;
	}

	let bulan = $state(new Date().toISOString().slice(0, 7));
	let rosterRows = $state<RosterRow[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');
	let successMsg = $state('');

	let showAjukanModal = $state(false);
	let ajukanRosterId = $state<string | null>(null);
	let cariQuery = $state('');
	let cariResults = $state<{ id: number; nama_karyawan: string }[]>([]);
	let selectedRekan = $state<{ id: number; nama_karyawan: string } | null>(null);
	let submitting = $state(false);

	async function getIdToken(): Promise<string> {
		const user = auth.currentUser;
		if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
		return user.getIdToken();
	}

	async function loadKalender() {
		loading = true;
		errorMsg = '';
		try {
			const idToken = await getIdToken();
			const res = await fetch(`/api/ess/shift-roster/kalender?bulan=${bulan}`, {
				headers: { Authorization: `Bearer ${idToken}` }
			});
			if (!res.ok) throw new Error(`Gagal memuat kalender (${res.status})`);
			const data = await res.json();
			rosterRows = data.data || [];
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat kalender.';
		}
		loading = false;
	}

	onMount(loadKalender);
	$effect(() => {
		bulan;
		loadKalender();
	});

	function openAjukan(rosterId: string) {
		ajukanRosterId = rosterId;
		cariQuery = '';
		cariResults = [];
		selectedRekan = null;
		showAjukanModal = true;
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onCariInput() {
		selectedRekan = null;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(async () => {
			if (cariQuery.trim().length < 2) { cariResults = []; return; }
			const idToken = await getIdToken();
			const res = await fetch(`/api/ess/shift-roster/cari-karyawan?q=${encodeURIComponent(cariQuery)}`, {
				headers: { Authorization: `Bearer ${idToken}` }
			});
			const data = await res.json().catch(() => ({ data: [] }));
			cariResults = data.data || [];
		}, 300);
	}

	async function submitAjukan() {
		if (!ajukanRosterId || !selectedRekan) return;
		submitting = true;
		errorMsg = '';
		successMsg = '';
		try {
			const idToken = await getIdToken();
			const res = await fetch('/api/ess/shift-roster/tukar-ajukan', {
				method: 'POST',
				headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ rosterId: ajukanRosterId, karyawanTujuanId: selectedRekan.id })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
			successMsg = `Pengajuan tukar shift ke ${selectedRekan.nama_karyawan} terkirim, menunggu konfirmasi.`;
			showAjukanModal = false;
			await loadKalender();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengajukan tukar shift.';
		}
		submitting = false;
	}

	async function konfirmasiTukar(rosterId: string) {
		submitting = true;
		errorMsg = '';
		successMsg = '';
		try {
			const idToken = await getIdToken();
			const res = await fetch('/api/ess/shift-roster/tukar-konfirmasi', {
				method: 'POST',
				headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ rosterId })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
			successMsg = 'Konfirmasi terkirim, menunggu approval atasan.';
			await loadKalender();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal konfirmasi tukar shift.';
		}
		submitting = false;
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Kalender Shift Saya</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Lihat jadwal shift & ajukan tukar dengan rekan kerja</p>

	<input type="month" bind:value={bulan} class="h-10 px-3 rounded-lg text-[13px] border mb-4" style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)" />

	{#if errorMsg}<p class="text-[12px] mb-2" style="color: #DC2626">{errorMsg}</p>{/if}
	{#if successMsg}<p class="text-[12px] mb-2" style="color: #16A34A">{successMsg}</p>{/if}

	{#if loading}
		<CircularProgressGauge size={44} strokeWidth={3} label="Memuat roster shift kerja..." />
	{:else if rosterRows.length === 0}
		<p class="text-[12px]" style="color: var(--sys-label3)">Belum ada roster bulan ini.</p>
	{:else}
		<div class="flex flex-col gap-2">
			{#each rosterRows as r (r.id)}
				<div class="rounded-lg p-3 flex items-center justify-between" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep)">
					<div>
						<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{r.tanggal}</p>
						<p class="text-[11px]" style="color: var(--sys-label3)">{r.jadwal_kerja_id?.nama_jadwal || '-'} — {r.status}</p>
					</div>
					{#if r.status === 'aktif'}
						<button class="text-[11px] font-semibold px-2 py-1 rounded" style="background: var(--p, var(--g)); color: white" onclick={() => openAjukan(r.id)}>
							Ajukan Tukar
						</button>
					{:else if r.status === 'menunggu_tukar' && r.swap_with}
						<button class="text-[11px] font-semibold px-2 py-1 rounded" style="background: var(--p, var(--g)); color: white" disabled={submitting} onclick={() => konfirmasiTukar(r.id)}>
							Konfirmasi
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if showAjukanModal}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onclick={(e) => { if (e.target === e.currentTarget) showAjukanModal = false; }}>
		<div class="rounded-xl p-5 w-full max-w-sm" style="background: var(--sys-bg)">
			<h3 class="text-[14px] font-bold mb-3" style="color: var(--sys-label)">Ajukan Tukar Shift</h3>
			<input
				placeholder="Cari nama rekan kerja..."
				bind:value={cariQuery}
				oninput={onCariInput}
				class="w-full h-10 px-3 rounded-lg text-[13px] border mb-2"
				style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)"
			/>
			{#if cariResults.length > 0}
				<div class="rounded-lg mb-2 overflow-hidden border" style="border-color: var(--sys-sep)">
					{#each cariResults as r}
						<button
							class="w-full text-left px-3 py-2 text-[12px]"
							style="background: var(--sys-bg2); color: var(--sys-label)"
							onclick={() => { selectedRekan = r; cariResults = []; cariQuery = r.nama_karyawan; }}
						>
							{r.nama_karyawan}
						</button>
					{/each}
				</div>
			{/if}
			<div class="flex justify-end gap-2 mt-2">
				<button class="px-3 py-1.5 rounded-lg text-[12px] font-semibold border" onclick={() => (showAjukanModal = false)}>Batal</button>
				<button
					class="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
					style="background: var(--p, var(--g))"
					disabled={!selectedRekan || submitting}
					onclick={submitAjukan}
				>
					{submitting ? 'Mengirim...' : 'Ajukan'}
				</button>
			</div>
		</div>
	</div>
{/if}
