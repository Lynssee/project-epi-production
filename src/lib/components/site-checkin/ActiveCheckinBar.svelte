<!-- src/lib/components/site-checkin/ActiveCheckinBar.svelte -->
<!-- Fase 3: bar persisten global (dipasang sekali di (app)/+layout.svelte) yang menampilkan
     check-in aktif karyawan, di mana pun dia berada di app — supaya check-out tidak
     mengharuskan kembali ke halaman /site-checkin dulu. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { onAuthStateChanged } from 'firebase/auth';
	import { auth } from '$lib/firebase';
	import { page } from '$app/state';
	import { getActiveCheckin, getSiteCheckinSettings, type SiteCheckinRecord } from '$lib/services/siteCheckin';
	import CheckoutDialog from '$lib/components/site-checkin/CheckoutDialog.svelte';
	import { IconMapPin, IconLogout, IconAlarm } from '@tabler/icons-svelte';

	let activeCheckin = $state<SiteCheckinRecord | null>(null);
	let showCheckout = $state(false);
	let elapsedLabel = $state('');
	let pesanSelesai = $state(''); // Paket 10 §2.1 — pengganti error "sudah ditutup" (netral, bukan error)
	let jamPengingat = $state<string[]>(['17:30', '21:00']); // site_checkin_settings.pengingat_checkout_jam
	let intervalId: ReturnType<typeof setInterval> | undefined;

	// Paket 10 §2.1 (SVR-22) — halaman /site-checkin sendiri sudah menampilkan status kunjungan
	// aktif secara penuh; bar ini di sana cuma duplikat informasi tanpa nilai tambah.
	const sembunyikanDiHalamanIni = $derived(page.url.pathname.startsWith('/site-checkin'));

	function formatElapsed(checkInAt: string): string {
		const ms = Date.now() - new Date(checkInAt).getTime();
		const totalMin = Math.max(0, Math.floor(ms / 60000));
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return h > 0 ? `${h} jam ${m} menit` : `${m} menit`;
	}

	// Paket 10 §2.2 (U5, bagian dalam-aplikasi) — bar berubah oranye setelah jam pertama di
	// pengingat_checkout_jam (default 17:30 WIB) terlewati, tanda kunjungan mungkin terlupa.
	const lewatJamPengingat = $derived.by(() => {
		if (!activeCheckin) return false;
		const now = new Date();
		const jamStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' });
		return jamPengingat.some((j) => jamStr >= j);
	});

	async function load() {
		if (!auth.currentUser) return;
		try {
			const res = await getActiveCheckin();
			activeCheckin = res.record;
			if (activeCheckin) elapsedLabel = formatElapsed(activeCheckin.check_in_at);
		} catch {
			// diam-diam gagal — bar ini pelengkap, jangan ganggu halaman lain
		}
	}

	async function loadSettings() {
		try {
			const { settings } = await getSiteCheckinSettings();
			const csv = (settings as any)?.pengingat_checkout_jam;
			if (typeof csv === 'string' && csv.trim()) {
				jamPengingat = csv.split(',').map((s) => s.trim()).filter(Boolean);
			}
		} catch {
			// pakai default di atas
		}
	}

	// Paket 10 §2.1 — dipanggil ulang setiap ada perubahan check-in dari halaman MANA PUN (bukan
	// cuma /site-checkin), supaya bar tidak pernah basi (SEBELUMNYA: hanya dimuat sekali saat
	// mount, jadi check-in/checkout di halaman lain tidak pernah terlihat di sini sampai reload).
	function handleChanged() {
		load();
	}

	onMount(() => {
		loadSettings();
		const unsubAuth = onAuthStateChanged(auth, (user) => {
			if (user) load();
			else activeCheckin = null;
		});
		window.addEventListener('site-checkin:changed', handleChanged);
		document.addEventListener('visibilitychange', () => {
			if (document.visibilityState === 'visible') load();
		});
		intervalId = setInterval(() => {
			if (activeCheckin) elapsedLabel = formatElapsed(activeCheckin.check_in_at);
		}, 30000);
		return () => {
			clearInterval(intervalId);
			unsubAuth();
			window.removeEventListener('site-checkin:changed', handleChanged);
		};
	});

	function handleCheckoutDone() {
		showCheckout = false;
		activeCheckin = null;
		window.dispatchEvent(new CustomEvent('site-checkin:changed'));
	}

	// Paket 10 §2.1 — checkout dari bar ini bisa gagal dengan "Check-in ini sudah ditutup" bila
	// kunjungan SUDAH selesai di tempat lain (mis. auto-close tengah malam, atau checkout dari
	// tab lain) tepat sebelum tombol ditekan. Ini BUKAN kegagalan bagi pengguna — kunjungan memang
	// sudah tercatat selesai — jadi bar hilang dengan pesan netral, bukan pesan error teknis.
	function handleCheckoutError(message: string) {
		if (/sudah ditutup/i.test(message)) {
			showCheckout = false;
			activeCheckin = null;
			pesanSelesai = 'Kunjungan ini sudah selesai tercatat.';
			setTimeout(() => (pesanSelesai = ''), 4000);
		}
	}
</script>

{#if pesanSelesai}
	<div class="fixed bottom-16 left-0 right-0 z-40 px-3" style="pointer-events: none">
		<div class="mx-auto max-w-md rounded-xl px-3.5 py-2.5 bg-slate-800 text-white text-[12px] font-semibold text-center shadow-lg" style="pointer-events: auto">
			{pesanSelesai}
		</div>
	</div>
{/if}

{#if activeCheckin && !sembunyikanDiHalamanIni}
	<div class="fixed bottom-16 left-0 right-0 z-40 px-3" style="pointer-events: none">
		<div
			class="mx-auto max-w-md rounded-xl px-3.5 py-2.5 flex items-center gap-2.5 shadow-lg"
			style="background: {lewatJamPengingat ? '#D97706' : 'var(--p, #1F6592)'}; pointer-events: auto"
		>
			{#if lewatJamPengingat}
				<IconAlarm size={18} style="color: white; flex-shrink: 0" />
			{:else}
				<IconMapPin size={18} style="color: white; flex-shrink: 0" />
			{/if}
			<div class="flex-1 min-w-0">
				<p class="text-[12px] font-bold text-white truncate">
					{#if lewatJamPengingat}
						Masih tercatat di {activeCheckin.nama_lokasi} sejak {elapsedLabel} lalu
					{:else}
						{activeCheckin.nama_lokasi}
					{/if}
				</p>
				<p class="text-[10px] text-white/80">
					{lewatJamPengingat ? 'Sudah selesai? Tekan Selesai di bawah.' : `Masuk ${elapsedLabel} lalu`}
				</p>
			</div>
			<button
				class="flex items-center gap-1 text-[11px] font-bold text-white bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1.5 flex-shrink-0"
				onclick={() => (showCheckout = true)}
			>
				<IconLogout size={14} /> Selesai
			</button>
		</div>
	</div>

	{#if showCheckout}
		<CheckoutDialog checkin={activeCheckin} onDone={handleCheckoutDone} onClose={() => (showCheckout = false)} onError={handleCheckoutError} />
	{/if}
{/if}
