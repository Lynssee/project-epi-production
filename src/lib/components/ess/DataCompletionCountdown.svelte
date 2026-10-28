<!-- src/lib/components/ess/DataCompletionCountdown.svelte -->
<!--
	Countdown Kelengkapan Data Karyawan Baru (26 Agu 2026). Karyawan baru diberi 7 hari sejak
	onboarding_case.tanggal_mulai untuk melengkapi data wajib lewat ESS (dokumen wajib: KTP +
	alamat KTP, KK, pas foto; NPWP sepenuhnya opsional — lihat server/ess/dataKelengkapan.ts). Kalau tenggat lewat & data masih belum lengkap, cron /api/automation/onboarding-data-
	lengkap (erp-epi-1) membuat draf Teguran Tertulis yang berdampak KPI — HRD tetap meninjau
	lewat Universal Approval Engine sebelum benar-benar terbit.

	Digabung 23 Sep 2026 dengan gerbang dokumen wajib SEMUA karyawan (dashboard admin) — lihat
	src/lib/server/ess/dataKelengkapan.ts. `status.sumber === 'universal'` berarti bukan
	karyawan baru, deadline dari app_settings global, dan `status.mode === 'block'` berarti
	akses ESS-nya sedang dikunci layout ((app)/ess/+layout.svelte, kecuali absen/kehadiran).

	Tampil dalam 2 bentuk sekaligus selama data belum lengkap:
	  1. Banner persisten (tidak bisa ditutup permanen, hanya hilang saat data lengkap) — sejak
	     23 Sep 2026 dirender dari (app)/ess/+layout.svelte supaya tampil di SEMUA halaman ESS,
	     bukan cuma dashboard, karena sekarang bisa berujung mengunci akses.
	  2. Modal popup sekali per sesi login (dismissible "Ingatkan lagi nanti", muncul lagi sesi berikutnya)

	`status` opsional: kalau layout pemanggil sudah punya hasil fetch (perlu juga untuk
	keputusan block), lempar lewat prop supaya endpoint /api/ess/data-lengkap tidak dipanggil
	dua kali per halaman. Kalau tidak diisi, komponen fetch sendiri (dipakai di dashboard lama).
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { getDataLengkapStatus, type DataLengkapStatus } from '$lib/services/ess/dataKelengkapan';
	import { IconAlertTriangle, IconClock, IconX, IconArrowRight, IconFileText, IconUserCircle } from '@tabler/icons-svelte';

	let { status: statusProp = undefined }: { status?: DataLengkapStatus | null } = $props();

	let statusFetched = $state<DataLengkapStatus | null>(null);
	let status = $derived(statusProp !== undefined ? statusProp : statusFetched);
	let now = $state(new Date());
	let showModal = $state(false);
	let tickInterval: ReturnType<typeof setInterval> | undefined;

	const SESSION_KEY = 'ess_data_lengkap_modal_shown';
 
	function checkAndShowModal(s: DataLengkapStatus | null | undefined) {
		if (typeof sessionStorage === 'undefined') return;
		if (s?.berlaku && !s.lengkap && !sessionStorage.getItem(SESSION_KEY)) {
			showModal = true;
			try {
				sessionStorage.setItem(SESSION_KEY, '1');
			} catch {}
		}
	}

	onMount(async () => {
		if (statusProp === undefined) {
			try {
				statusFetched = await getDataLengkapStatus();
				checkAndShowModal(statusFetched);
			} catch {
				// Non-fatal: kalau gagal dimuat, banner/modal cukup tidak tampil (bukan blocking dashboard).
			}
		} else {
			checkAndShowModal(statusProp);
		}
		tickInterval = setInterval(() => (now = new Date()), 30_000);
	});

	onDestroy(() => {
		if (tickInterval) clearInterval(tickInterval);
	});

	let sisaWaktu = $derived.by(() => {
		if (!status?.deadline) return null;
		const target = new Date(`${status.deadline}T23:59:59+07:00`).getTime();
		const diffMs = target - now.getTime();
		if (diffMs <= 0) return { lewat: true, hari: 0, jam: 0, menit: 0 };
		const hari = Math.floor(diffMs / (1000 * 60 * 60 * 24));
		const jam = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
		const menit = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
		return { lewat: false, hari, jam, menit };
	});

	function tutupModal() {
		showModal = false;
	}
	function bukaProfil() {
		showModal = false;
		goto('/ess/profil');
	}
	/** Upload dokumen pribadi ada di halaman Profil Saya (bukan Dokumen Saya, yang isinya
	    dokumen TERBITAN HR/read-only). tipeDokumen opsional -> form unggah langsung terbuka
	    dengan tipe itu sudah terpilih (lihat ?buka= di ess/profil/+page.svelte). */
	function bukaDokumen(tipeDokumen?: string) {
		showModal = false;
		goto(tipeDokumen ? `/ess/profil?buka=${encodeURIComponent(tipeDokumen)}` : '/ess/profil');
	}
</script>

{#if status?.berlaku && !status.lengkap}
	<!-- Banner persisten -->
	<div
		class="w-full rounded-2xl p-4 sm:p-5 border relative overflow-hidden"
		style="background: linear-gradient(135deg, {sisaWaktu?.lewat
			? 'rgba(225, 29, 72, 0.10)'
			: 'rgba(217, 119, 6, 0.08)'} 0%, transparent 100%); border-color: {sisaWaktu?.lewat
			? 'rgba(225, 29, 72, 0.3)'
			: 'rgba(217, 119, 6, 0.25)'};"
	>
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
			<div class="flex items-start sm:items-center gap-3.5">
				<div
					class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border {sisaWaktu?.lewat
						? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/50 border-rose-500/30'
						: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border-amber-500/30'}"
				>
					<IconAlertTriangle size={22} stroke={1.8} />
				</div>
				<div>
					<div class="flex items-center gap-2 flex-wrap">
						<span
							class="text-xs font-black uppercase tracking-wider {sisaWaktu?.lewat
								? 'text-rose-600 dark:text-rose-400'
								: 'text-amber-600 dark:text-amber-400'}"
						>
							Lengkapi Data Diri
						</span>
						<span
							class="text-[10px] font-bold px-2 py-0.5 rounded-full border {sisaWaktu?.lewat
								? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
								: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'}"
						>
							{status.persen}% Lengkap
						</span>
					</div>
					<p class="text-sm font-bold mt-0.5" style="color: var(--sys-label)">
						{#if status.mode === 'block'}
							🔒 Akses ESS dikunci — lengkapi untuk membuka kembali (Absen tetap bisa dipakai)
						{:else if sisaWaktu?.lewat}
							Batas waktu sudah lewat — draf teguran sedang ditinjau HRD
						{:else}
							Lengkapi {status.missing.length} data/dokumen sebelum tenggat habis
						{/if}
					</p>
					<div class="flex flex-wrap gap-1.5 mt-1.5">
						{#each status.missing as m (m.key)}
							<button
								type="button"
								class="text-[10px] font-semibold px-2 py-1 rounded-lg border transition-colors"
								style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label2)"
								title={m.tipe === 'dokumen'
									? `Klik untuk langsung buka form unggah ${m.label}`
									: `Klik untuk isi ${m.label} di Profil Saya`}
								onclick={() => (m.tipe === 'dokumen' ? bukaDokumen(m.key) : bukaProfil())}
							>
								{m.label}
							</button>
						{/each}
					</div>
				</div>
			</div>

			<div class="flex items-center gap-3 self-end sm:self-center">
				{#if sisaWaktu && !sisaWaktu.lewat}
					<div
						class="flex items-center gap-1.5 font-mono font-black text-sm px-3 py-1.5 rounded-xl border"
						style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
						title={status.sumber === 'onboarding'
							? 'Sisa waktu sebelum draf teguran otomatis dibuat'
							: 'Sisa waktu sebelum akses ESS dikunci (absen tetap tersedia)'}
					>
						<IconClock size={14} class="text-amber-500" />
						<span>{sisaWaktu.hari}h {sisaWaktu.jam}j {sisaWaktu.menit}m</span>
					</div>
				{/if}
				<button
					class="px-4 py-2 rounded-xl text-xs font-bold text-white shadow-sm flex items-center gap-1.5 transition-all shrink-0"
					style="background: linear-gradient(135deg, {sisaWaktu?.lewat
						? '#e11d48 0%, #be123c 100%'
						: '#d97706 0%, #b45309 100%'})"
					onclick={() => bukaProfil()}
					title="Buka Profil Saya untuk melengkapi data dasar"
				>
					<span>Lengkapi Sekarang</span>
					<IconArrowRight size={14} />
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showModal && status?.berlaku && !status.lengkap}
	<div
		class="fixed inset-0 z-[9998] flex items-center justify-center p-4"
		style="background: rgba(15, 23, 42, 0.6)"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && tutupModal()}
	>
		<div class="w-full max-w-md rounded-3xl border shadow-2xl overflow-hidden" style="background: var(--sys-bg2, #ffffff); border-color: var(--sys-sep)">
			<div class="p-5 border-b flex items-start justify-between gap-3" style="border-color: var(--sys-sep)">
				<div class="flex items-center gap-3">
					<div
						class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border {sisaWaktu?.lewat
							? 'text-rose-600 bg-rose-50 dark:bg-rose-950/50 border-rose-500/30'
							: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 border-amber-500/30'}"
					>
						<IconAlertTriangle size={20} />
					</div>
					<h3 class="text-base font-extrabold" style="color: var(--sys-label)">Lengkapi Data Diri Anda</h3>
				</div>
				<button class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-500/10 transition-colors" onclick={tutupModal} aria-label="Tutup">
					<IconX size={18} />
				</button>
			</div>

			<div class="p-5 space-y-4">
				<p class="text-sm leading-relaxed" style="color: var(--sys-label2)">
					{#if status.sumber === 'onboarding'}
						Sebagai karyawan baru, Anda diberi waktu <strong>7 hari</strong> untuk melengkapi data diri wajib. Jika tenggat lewat dan data masih belum lengkap, sistem akan membuat draf teguran tertulis yang berdampak pada KPI Anda.
					{:else}
						Setiap karyawan wajib melengkapi data diri berikut. Jika tenggat lewat, akses fitur ESS lain akan dikunci sampai dilengkapi — <strong>Absen Masuk/Pulang tetap bisa dipakai</strong> selama itu.
					{/if}
				</p>

				{#if sisaWaktu && !sisaWaktu.lewat}
					<div class="rounded-2xl p-4 text-center border" style="background: var(--sys-fill); border-color: var(--sys-sep)">
						<p class="text-[11px] font-bold uppercase tracking-wider mb-1" style="color: var(--sys-label3)">Sisa Waktu</p>
						<p class="text-2xl font-black font-mono" style="color: var(--sys-label)">{sisaWaktu.hari} hari {sisaWaktu.jam} jam {sisaWaktu.menit} menit</p>
					</div>
				{:else if sisaWaktu?.lewat}
					<div class="rounded-2xl p-4 text-center border bg-rose-500/10 border-rose-500/20">
						<p class="text-sm font-bold text-rose-600 dark:text-rose-400">
							{status.sumber === 'onboarding'
								? 'Tenggat sudah lewat — draf teguran sedang ditinjau HRD.'
								: 'Tenggat sudah lewat — akses ESS dikunci (absen tetap tersedia).'}
						</p>
					</div>
				{/if}

				<div>
					<p class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label3)">Yang belum lengkap — klik untuk langsung mengisi:</p>
					<ul class="space-y-1.5">
						{#each status.missing as m (m.key)}
							<li>
								<button
									type="button"
									class="w-full flex items-center justify-between gap-2 text-sm text-left rounded-lg border px-3 py-2 transition-colors hover:bg-amber-500/5"
									style="border-color: var(--sys-sep); color: var(--sys-label2)"
									onclick={() => (m.tipe === 'dokumen' ? bukaDokumen(m.key) : bukaProfil())}
								>
									<span class="flex items-center gap-2">
										<span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
										{m.label}
									</span>
									<IconArrowRight size={13} class="opacity-50 shrink-0" />
								</button>
							</li>
						{/each}
					</ul>
				</div>

				{#if status.opsional?.length}
					<div>
						<p class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label3)">Opsional (tidak mengunci akses):</p>
						<div class="flex flex-wrap gap-1.5">
							{#each status.opsional as o (o.key)}
								<button
									type="button"
									class="text-[11px] font-semibold px-2 py-1 rounded-lg border border-dashed transition-colors"
									style="background: transparent; border-color: var(--sys-sep); color: var(--sys-label3)"
									onclick={() => (o.tipe === 'dokumen' ? bukaDokumen(o.key) : bukaProfil())}
								>
									{o.label}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<div class="p-4 border-t flex flex-col sm:flex-row gap-2" style="border-color: var(--sys-sep)">
				<button
					class="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5"
					style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => bukaDokumen()}
				>
					<IconFileText size={14} />
					Unggah Dokumen
				</button>
				<button
					class="flex-1 px-4 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm flex items-center justify-center gap-1.5"
					style="background: var(--sys-tint)"
					onclick={bukaProfil}
				>
					<IconUserCircle size={14} />
					Lengkapi Profil
				</button>
			</div>
			<div class="px-4 pb-4 text-center">
				<button class="text-[11px] font-semibold hover:underline" style="color: var(--sys-label4)" onclick={tutupModal}>
					Ingatkan lagi nanti
				</button>
			</div>
		</div>
	</div>
{/if}
