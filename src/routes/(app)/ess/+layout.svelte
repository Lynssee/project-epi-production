<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth';
	import { getDataLengkapStatus, type DataLengkapStatus } from '$lib/services/ess/dataKelengkapan';
	import DataCompletionCountdown from '$lib/components/ess/DataCompletionCountdown.svelte';
	import { IconLock } from '@tabler/icons-svelte';

	import { onMount } from 'svelte';

	let { children } = $props();

	let isSuperAdmin = $derived(
		$authStore.roleId === 'super_admin' || ($authStore.roleIds?.includes('super_admin') ?? false)
	);
	// ESS dibuka untuk SEMUA karyawan, bukan berdasar role — sama seperti dashboard admin
	// (lihat erp-epi src/routes/ess/+layout.svelte: "Tidak ada AuthGuard permission di sini:
	// semua isinya milik sendiri"). Sebelumnya dibatasi permission access_ess yang menurut
	// DEFAULT_ROLE_PERMISSIONS hanya dipunyai leader/manpower_leader/staff — sales, driver,
	// satpam, finance, hrd, direktur, manager, dan role admin sama sekali tidak bisa membuka
	// Portal Karyawan, termasuk Pengajuan Kas Kecil yang seharusnya milik semua orang.
	// Setiap tulisan ESS tetap bergantung pada karyawanId — ini lantai keamanan minimum
	// yang dipertahankan, supaya tidak ada request yang lolos tanpa identitas karyawan jelas.
	let punyaIdentitasKaryawan = $derived(!!$authStore.karyawanId || isSuperAdmin);
	let boleh = $derived(punyaIdentitasKaryawan);

	// Gerbang dokumen wajib, digabung dengan lifecycle onboarding (23 Sep 2026, keputusan user)
	// — lihat src/lib/server/ess/dataKelengkapan.ts untuk aturan lengkap. Banner tampil di
	// SEMUA halaman ESS (bukan cuma dashboard) karena sekarang bisa berujung mengunci akses.
	// Absen/Kehadiran SELALU dikecualikan dari kuncian (Aturan #6 CLAUDE.md: jangan matikan
	// fitur utama tanpa alternatif) — field worker wajib tetap bisa absen tiap hari.
	// /ess/kehadiran & /ess/izin-sakit ikut dikecualikan (1 Okt 2026): izin sakit adalah
	// alternatif absen saat tidak bisa hadir — mengunci-nya membuat karyawan tercatat alpha.
	const ESS_GATE_ESCAPE_PATHS = ['/ess/dokumen-saya', '/ess/profil', '/ess/absen', '/ess/kehadiran', '/ess/izin-sakit'];
	// Dashboard /ess (tempat widget Absen Masuk/Pulang) tetap dikunci, TAPI kartu kunci di sana
	// menampilkan pintasan absen — sebelumnya kartu cuma bilang "absen tetap bisa dipakai"
	// tanpa jalan ke sana, sehingga di lapangan absen terasa ikut terblokir.
	const ESS_GATE_PINTASAN_ABSEN = [
		{ label: 'Absen Masuk / Pulang', href: '/ess/absen', utama: true },
		{ label: 'Izin / Sakit', href: '/ess/izin-sakit', utama: false },
		{ label: 'Riwayat Kehadiran', href: '/ess/kehadiran', utama: false }
	];

	let status = $state<DataLengkapStatus | null>(null);

	onMount(() => {
		let active = true;
		const unsub = authStore.subscribe(async (auth) => {
			if (!auth.checked) return;
			const isSuper = auth.roleId === 'super_admin' || (auth.roleIds?.includes('super_admin') ?? false);
			const can = !!auth.karyawanId || isSuper;
			if (!can) return;
			try {
				const res = await getDataLengkapStatus();
				if (active) status = res;
			} catch {
				// Non-fatal (fail-open, konsisten dgn gate lain di proyek ini): status gagal
				// dimuat -> gate dianggap tidak berlaku, TIDAK memblokir akses.
			}
		});
		return () => {
			active = false;
			unsub();
		};
	});

	let pathname = $derived(page.url.pathname);
	let gateBlocking = $derived(
		status?.mode === 'block' &&
			!ESS_GATE_ESCAPE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))
	);
</script>

{#if !$authStore.checked}
	<div class="flex items-center justify-center py-20">
		<p class="text-[13px]" style="color: var(--sys-label3)">Memuat...</p>
	</div>
{:else if boleh}
	{#if status?.berlaku && !status.lengkap}
		<div class="p-4 pb-0">
			<DataCompletionCountdown {status} />
		</div>
	{/if}
	{#if gateBlocking}
		<div class="p-4">
			<div class="rounded-xl p-4 text-center" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
				<IconLock size={28} class="mx-auto mb-2 text-rose-500" />
				<p class="text-[14px] font-semibold mb-1" style="color: var(--sys-label)">Fitur ini terkunci</p>
				<p class="text-[12px] leading-relaxed mb-1" style="color: var(--sys-label-2)">
					Lengkapi data/dokumen wajib Anda dulu (lihat peringatan di atas) untuk membuka kembali akses ke halaman ini.
				</p>
				<p class="text-[11px] font-semibold" style="color: var(--sys-label3)">Absen Masuk/Pulang tetap bisa dipakai seperti biasa.</p>
				<div class="mt-3 flex flex-wrap items-center justify-center gap-2">
					{#each ESS_GATE_PINTASAN_ABSEN as p (p.href)}
						<a
							href={p.href}
							class="px-4 py-2 rounded-xl text-[12px] font-bold border transition-colors"
							style={p.utama
								? 'background: var(--sys-tint); border-color: transparent; color: #ffffff'
								: 'background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)'}
						>
							{p.label}
						</a>
					{/each}
				</div>
			</div>
		</div>
	{:else}
		{@render children()}
	{/if}
{:else}
	<div class="p-4">
		<div class="rounded-xl p-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
			<p class="text-[14px] font-semibold mb-1" style="color: var(--sys-label)">
				Akun belum tertaut ke data karyawan
			</p>
			<p class="text-[12px] leading-relaxed" style="color: var(--sys-label-2)">
				Portal Karyawan membutuhkan data karyawan yang tertaut ke akun ini. Hubungi HRD
				untuk menautkan email <span class="font-medium">{$authStore.user?.email ?? '-'}</span>
				ke data karyawan Anda, lalu masuk ulang.
			</p>
			<button
				class="mt-3 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white"
				style="background: var(--p, var(--g))"
				onclick={() => goto('/')}
			>
				Kembali ke Beranda
			</button>
		</div>
	</div>
{/if}
