<!-- src/lib/components/attendance/BelumAbsenPulangBar.svelte -->
<!-- Sistem Denda Prosedural Karyawan — Fase 4 (pencegahan). Bar persisten: mengingatkan karyawan
     yang sudah absen masuk tapi belum absen pulang setelah jam pulang normal lewat. Dipasang sekali
     di (app)/+layout.svelte, di atas ActiveCheckinBar. Ini PENGINGAT, bukan denda. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { onAuthStateChanged } from 'firebase/auth';
	import { auth } from '$lib/firebase';
	import { IconClockExclamation, IconChevronRight, IconX } from '@tabler/icons-svelte';

	let perluIngat = $state(false);
	let jamPulangNormal = $state('');
	let dismissedFor = $state<string>(''); // tanggal yang sudah di-dismiss user (sesi ini saja)
	let tanggal = $state('');
	let intervalId: ReturnType<typeof setInterval> | undefined;

	async function load() {
		if (!auth.currentUser) return;
		try {
			const token = await auth.currentUser.getIdToken();
			const res = await fetch('/api/ess/attendance/pulang-reminder', {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!res.ok) return;
			const data = await res.json();
			tanggal = data.tanggal || '';
			jamPulangNormal = data.jamPulangNormal || '';
			perluIngat = !!data.perluIngat;
		} catch {
			// diam-diam gagal — bar pelengkap
		}
	}

	onMount(() => {
		// Paket 10 Site Visit Release §2.1 — pola sama ActiveCheckinBar.svelte: jangan hanya
		// sekali cek `auth.currentUser` saat mount (bisa belum siap saat layout mount), pakai
		// listener supaya bar langsung benar begitu Firebase Auth selesai resolve.
		const unsubAuth = onAuthStateChanged(auth, (user) => {
			if (user) load();
		});
		intervalId = setInterval(load, 5 * 60 * 1000); // tiap 5 menit
		return () => {
			clearInterval(intervalId);
			unsubAuth();
		};
	});

	const show = $derived(perluIngat && dismissedFor !== tanggal);
</script>

{#if show}
	<div class="fixed bottom-32 left-0 right-0 z-40 px-3" style="pointer-events: none">
		<div
			class="mx-auto max-w-md rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 shadow-lg"
			style="background: #D97706; pointer-events: auto"
		>
			<IconClockExclamation size={18} style="color: white; flex-shrink: 0" />
			<button
				class="flex-1 min-w-0 text-left"
				onclick={() => goto('/ess/absen')}
			>
				<p class="text-[12px] font-bold text-white">Anda belum absen pulang hari ini</p>
				<p class="text-[10px] text-white/85">
					Jam pulang normal {jamPulangNormal || '—'} sudah lewat. Ketuk untuk absen pulang sekarang.
				</p>
			</button>
			<button
				class="flex items-center gap-1 text-[11px] font-bold text-white bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1.5 flex-shrink-0"
				onclick={() => goto('/ess/absen')}
			>
				Absen <IconChevronRight size={14} />
			</button>
			<button
				class="text-white/70 hover:text-white flex-shrink-0"
				aria-label="Tutup pengingat"
				onclick={() => (dismissedFor = tanggal)}
			>
				<IconX size={15} />
			</button>
		</div>
	</div>
{/if}
