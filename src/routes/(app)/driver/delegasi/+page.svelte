<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { sjReadiness } from '$lib/shared/sjReadiness';
	import { resolveDriverId, getDelegatedSuratJalan, respondToDelegation, fetchSjReadiness } from '$lib/services/driver';
	import { IconLoader2, IconClipboardList, IconCheck, IconX } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let driverId = $state('');
	let items = $state<any[]>([]);
	let responding = $state<number | null>(null);
	let rejectingId = $state<number | null>(null);
	let rejectReason = $state('');
	// SJH-18: kesiapan dari server per SJ + hint yang bisa ditutup + muat ulang hemat (hanya saat layar terlihat)
	let readiness = $state<Record<number, any>>({});
	let hintClosed = $state(false);
	const HINT_KEY = 'delegasi-hint-closed';
	function closeHint() {
		hintClosed = true;
		try { localStorage.setItem(HINT_KEY, '1'); } catch { /* abaikan */ }
	}
	async function loadReadiness() {
		const ids = items.filter((s) => ['pending', 'diterima'].includes(s.delegation_status)).map((s) => s.id);
		if (!ids.length) { readiness = {}; return; }
		try {
			const rows = await fetchSjReadiness(ids);
			readiness = Object.fromEntries(rows.map((r: any) => [r.id, r]));
		} catch (e) {
			console.error('[delegasi] gagal memuat kesiapan SJ (pakai data lokal):', e);
		}
	}

	const STATUS_LABEL: Record<string, string> = {
		pending: 'Menunggu Respon Anda',
		diterima: 'Diterima',
		jalan: 'Sedang Jalan'
	};

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'access_driver', roles)) {
			goto('/');
		}
	});

	async function load() {
		const karyawanId = $authStore.karyawanId;
		if (!karyawanId) {
			errorMsg = 'Profil karyawan tidak ditemukan di sesi login. Hubungi admin.';
			loading = false;
			return;
		}
		try {
			driverId = await resolveDriverId(karyawanId);
			items = await getDelegatedSuratJalan(driverId);
			await loadReadiness();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat delegasi.';
		}
		loading = false;
	}
	onMount(() => {
		try { hintClosed = localStorage.getItem(HINT_KEY) === '1'; } catch { /* abaikan */ }
		load();
		// Muat ulang tiap 60 dtk HANYA saat halaman terlihat (hemat API)
		const t = setInterval(() => { if (document.visibilityState === 'visible' && !loading) loadReadiness(); }, 60000);
		const onVis = () => { if (document.visibilityState === 'visible' && !loading) loadReadiness(); };
		document.addEventListener('visibilitychange', onVis);
		return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
	});

	async function terima(id: number) {
		responding = id;
		try {
			await respondToDelegation(id, { action: 'terima' });
			await load();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menerima delegasi.';
		}
		responding = null;
	}

	// SJH-15: Berangkat dipisah dari Terima — server memeriksa cetak/approval/satpam/kendaraan.
	async function berangkat(id: number) {
		responding = id;
		errorMsg = '';
		try {
			await respondToDelegation(id, { action: 'berangkat' });
			await load();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal berangkat.';
		}
		responding = null;
	}

	// Alasan Berangkat belum bisa (sisi klien, informatif; server tetap menegakkan).
	function berangkatHint(sj: any): string | null {
		// SJH-18: bila kesiapan dari server tersedia, itu sumber kebenaran (needsGate dihitung di server).
		const srv = readiness[sj.id];
		if (srv) return srv.can_berangkat ? null : (srv.next_hint || (srv.berangkat_blockers || [])[0] || 'Belum bisa berangkat.');
		// SJH-18: kalimat "menunggu siapa" dari langkah kesiapan (satpam hanya info — server yang menegakkan).
		const local = sjReadiness(sj, null);
		const first = local.steps.find((st) => !st.done && ['disetujui', 'dicetak'].includes(st.key));
		if (first) return local.next_hint;
		if (!(Number(sj.print_count) >= 1)) return 'SJ belum dicetak resmi — hubungi admin logistik.';
		if (sj.approval_status && !['disetujui', 'tidak_perlu'].includes(sj.approval_status)) return 'SJ belum disetujui admin.';
		return null;
	}

	async function tolak(id: number) {
		if (!rejectReason.trim()) return;
		responding = id;
		try {
			await respondToDelegation(id, { action: 'tolak', reason: rejectReason.trim() });
			rejectingId = null;
			rejectReason = '';
			await load();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menolak delegasi.';
		}
		responding = null;
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Delegasi Surat Jalan</h1>
				<p class="text-[11px]" style="color: var(--sys-label3)">Tugas pengiriman yang ditugaskan ke Anda</p>
			</div>
			<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--gl)">
				<IconClipboardList size={18} style="color: var(--g)" />
			</div>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat delegasi trip..." />
		{:else if errorMsg}
			<div class="rounded-lg p-4 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
		{:else if items.length === 0}
			<p class="text-[11px] text-center py-12" style="color: var(--sys-label3)">Tidak ada delegasi untuk Anda saat ini.</p>
		{:else}
			{#if !hintClosed}
				<div class="rounded-lg p-3 mb-3 text-[11px] flex items-start justify-between gap-2" style="background: var(--gl); color: var(--sys-label)">
					<span>Terima tugas kapan saja. Tombol <b>Berangkat</b> aktif setelah SJ dicetak, barang dimuat, dan satpam meloloskan.</span>
					<button class="font-bold" onclick={closeHint} aria-label="Tutup petunjuk">✕</button>
				</div>
			{/if}
			<div class="flex flex-col gap-3">
				{#each items as sj}
					<div class="rounded-xl p-4" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<div class="flex items-center justify-between mb-1">
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">{sj.nomor_sj || `SJ #${sj.id}`}</p>
							<span class="text-[10px] font-semibold px-2 py-1 rounded-full" style="background: {sj.delegation_status === 'pending' ? 'var(--aml)' : 'var(--gg)'}; color: {sj.delegation_status === 'pending' ? 'var(--amd)' : 'var(--ggd)'}">
								{STATUS_LABEL[sj.delegation_status] || sj.delegation_status}
							</span>
						</div>
						{#if readiness[sj.id]?.kendaraan?.plat}<p class="text-[11px] mb-1" style="color: var(--sys-label3)">🚛 {readiness[sj.id].kendaraan.plat}{readiness[sj.id].kendaraan.nama ? ' · ' + readiness[sj.id].kendaraan.nama : ''}</p>{/if}
						{#if readiness[sj.id]?.steps}
							<div class="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] mb-1" style="color: var(--sys-label3)">
								{#each readiness[sj.id].steps as st}<span style="color: {st.done ? 'var(--ggd)' : 'inherit'}">{st.done ? '✓' : '○'} {st.label}</span>{/each}
							</div>
							{#if readiness[sj.id].next_hint}<p class="text-[11px] font-bold mb-1" style="color: var(--sys-label)">{readiness[sj.id].next_hint}</p>{/if}
						{/if}
						{#if sj.delivery_address}<p class="text-[11px] mb-2" style="color: var(--sys-label3)">{sj.delivery_address}</p>{/if}
						{#if sj.notes}<p class="text-[11px] mb-2" style="color: var(--sys-label3)">{sj.notes}</p>{/if}

						{#if sj.delegation_status === 'pending'}
							{#if rejectingId === sj.id}
								<textarea
									class="w-full rounded-lg p-2 text-[12px] mb-2"
									style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)"
									rows="2"
									placeholder="Alasan menolak (wajib)…"
									bind:value={rejectReason}
								></textarea>
								<div class="flex gap-2">
									<button
										class="flex-1 rounded-lg py-2 text-[12px] font-semibold"
										style="background: var(--sys-fill2); color: var(--sys-label3)"
										onclick={() => { rejectingId = null; rejectReason = ''; }}
									>Batal</button>
									<button
										class="flex-1 rounded-lg py-2 text-[12px] font-semibold disabled:opacity-50"
										style="background: var(--red); color: white"
										disabled={responding === sj.id || !rejectReason.trim()}
										onclick={() => tolak(sj.id)}
									>Kirim Penolakan</button>
								</div>
							{:else}
								<div class="flex gap-2">
									<button
										class="flex-1 rounded-lg py-2 text-[12px] font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
										style="background: var(--g); color: white"
										disabled={responding === sj.id}
										onclick={() => terima(sj.id)}
									><IconCheck size={14} /> Terima</button>
									<button
										class="flex-1 rounded-lg py-2 text-[12px] font-semibold flex items-center justify-center gap-1"
										style="background: var(--sys-fill2); color: var(--sys-label)"
										onclick={() => { rejectingId = sj.id; rejectReason = ''; }}
									><IconX size={14} /> Tolak</button>
								</div>
							{/if}
						{:else if sj.delegation_status === 'diterima'}
							<!-- SJH-15: langkah kesiapan + tombol Berangkat (nonaktif disertai alasan, Aturan #6) -->
							{#if !readiness[sj.id]?.steps}
							<div class="flex gap-3 text-[11px] mb-2" style="color: var(--sys-label3)">
								<span>{Number(sj.print_count) >= 1 ? '✓' : '○'} Dicetak</span>
								<span>{sj.security_verified_at ? '✓' : '○'} Lolos gerbang</span>
							</div>
							{/if}
							<button
								class="w-full rounded-lg py-2 text-[12px] font-semibold disabled:opacity-50"
								style="background: var(--g); color: white"
								disabled={responding === sj.id || !!berangkatHint(sj)}
								title="Berangkat hanya bisa setelah SJ dicetak dan (bila perlu) diloloskan satpam"
								onclick={() => berangkat(sj.id)}
							>Berangkat</button>
							{#if berangkatHint(sj)}
								<p class="text-[11px] mt-1" style="color: var(--amd)">{berangkatHint(sj)}</p>
							{:else if !sj.security_verified_at}
								<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Bila SJ ini butuh pemeriksaan satpam, tekan Berangkat setelah diloloskan di gerbang.</p>
							{/if}
						{:else if sj.delegation_status === 'jalan'}
							<button class="w-full rounded-lg py-2 text-[12px] font-semibold border" style="background: var(--b6); color: var(--blue); border-color: var(--blue)" onclick={() => goto('/driver')}>
								Lihat di Trip Berjalan
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
