<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { auth, db } from '$lib/firebase';
	import { onAuthStateChanged } from 'firebase/auth';
	import { doc, onSnapshot } from 'firebase/firestore';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { getAppUserById } from '$lib/services/users';
	import { getKaryawanByEmail } from '$lib/services/karyawan';
	import { resolveManpowerForAccount, getProyekDipimpin } from '$lib/services/manpowerLeader';
	import { loadRoles, getRoleById } from '$lib/stores/roles';
	import Toast from '$lib/components/Toast.svelte';
	// Import per-ikon (bukan barrel) — layout ini termuat di SETIAP halaman termasuk /login (rencana v2, T-3/1.3).
	import { themeMode, loadThemeMode } from '$lib/stores/themeStore';
	import { density, loadDensity } from '$lib/stores/densityStore';
	import { hematMode, loadHematMode } from '$lib/stores/hematStore';
	import { previewMode, loadPreviewState } from '$lib/stores/previewStore';
	import GlobalSearchModal from '$lib/components/GlobalSearchModal.svelte';
	import UpdateBanner from '$lib/components/shared/UpdateBanner.svelte';
	import NavigationProgressBar from './NavigationProgressBar.svelte';
	import { page } from '$app/state';
	import { registerAutoFlush, type QueuedRequest } from '$lib/utils/offlineQueue';

	let { children } = $props();
	let authChecked = $state(false);
	// Redirect landing-page per role hanya boleh terjadi SEKALI per sesi (saat pertama
	// mendarat / sesudah login). Tanpa penjaga ini, sebuah layout anak yang menolak akses
	// dan memantulkan user ke '/' (mis. /ess ketika akun belum tertaut ke data karyawan)
	// akan dilempar balik ke landing page-nya lagi -> ping-pong navigasi tanpa henti yang
	// me-mount ulang halaman terus-menerus sampai tab kehabisan resource
	// (net::ERR_INSUFFICIENT_RESOURCES di semua request). Bug ditemukan pada akun role
	// 'security' baru, 2 Sep 2026.
	let landingRedirectDone = $state(false);
	let isFrame = $state(false);

	onMount(() => {
		// Layar putih pre-boot statis di app.html (lihat komentarnya) — buang begitu
		// Svelte selesai mount, layar sekarang sudah menampilkan UI sungguhan.
		document.getElementById('app-boot-loader')?.remove();

		loadThemeMode();
		loadDensity();
		loadHematMode();
		loadPreviewState();
		// Membersihkan pendaftaran Service Worker lama (/service-worker.js) jika pernah terdaftar,
		// agar hanya Service Worker PWA tunggal (/sw.js) yang aktif dan tidak bentrok/nyangkut cache.
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.getRegistrations().then((registrations) => {
				for (const registration of registrations) {
					if (registration.active && registration.active.scriptURL.includes('service-worker.js')) {
						registration.unregister();
					}
				}
			}).catch(() => {});
		}
		isFrame = window.self !== window.top;

		// Rencana RBAC v2, A5 + Bagian 6 rule 5: "tambahkan pemantauan langsung
		// dokumen pengguna agar pencabutan akses terasa dalam hitungan detik".
		// Sebelumnya role/izin di lapangan hanya dimuat ulang saat login/refresh
		// -- kalau admin mengubah role seseorang di dashboard admin, orang itu
		// baru melihatnya setelah reload manual. Dipantau real-time di sini;
		// perubahan roleId TIDAK mengeluarkan sesi (sesuai rekomendasi A5 --
		// keluar paksa hanya kalau akun dinonaktifkan, itu sudah ditegakkan
		// Firebase Auth sendiri lewat disabled:true, di luar cache klien ini).
		let unsubscribeUserDoc: (() => void) | null = null;
		let lastWatchedRoleKey: string | null = null;

		function watchUserDoc(uid: string) {
			if (unsubscribeUserDoc) unsubscribeUserDoc();
			lastWatchedRoleKey = null;
			unsubscribeUserDoc = onSnapshot(doc(db, 'users', uid), async (snap) => {
				if (!snap.exists()) {
					return;
				}
				const data = snap.data();
				const key = JSON.stringify({ roleId: data.roleId, role: data.role, jabatanId: data.jabatanId });
				if (lastWatchedRoleKey === null) {
					// Snapshot pertama = state yang sama dengan yang baru dimuat onAuthStateChanged. Lewati.
					lastWatchedRoleKey = key;
					return;
				}
				if (key === lastWatchedRoleKey) return;
				lastWatchedRoleKey = key;
				const firestoreUser = await getAppUserById(uid);
				if (!firestoreUser) return;

				// Tentukan roleId yang efektif: jabatanId Firestore lebih dipercaya dari roleId string
				let effectiveRoleId = firestoreUser.roleId || firestoreUser.role;
				let effectiveRoleIds = Array.isArray(firestoreUser.roleIds) ? firestoreUser.roleIds : [];
				if (firestoreUser.jabatanId != null) {
					const jabatanIdStr = String(firestoreUser.jabatanId);
					// FIX (21 Agu 2026): sama dengan resolusi awal onAuthStateChanged di bawah —
					// jangan timpa 'super_admin'.
					if (effectiveRoleId !== 'super_admin') {
						effectiveRoleId = jabatanIdStr;
					}
					if (!effectiveRoleIds.includes(jabatanIdStr)) {
						effectiveRoleIds = [jabatanIdStr, ...effectiveRoleIds];
					}
				}

				authStore.update((s) => ({
					...s,
					role: firestoreUser.role,
					roleId: effectiveRoleId,
					roleIds: effectiveRoleIds
				}));
			}, (err) => {
				console.warn('[watchUserDoc] Gagal memantau dokumen user:', err);
			});
		}

		const unsubscribe = onAuthStateChanged(auth, async (user) => {
			let role: string | null = null;
			let roleId: string | null = null;
			let roleIds: string[] = [];
			let karyawanName: string | null = null;

			let karyawanId: number | null = null;
			let karyawanDivisi: string | null = null;
			let karyawanPosisi: string | null = null;
			let directusToken: string | null = null;
			let manpowerId: number | null = null;
			let manpowerNama: string | null = null;
			let manpowerLeaderProjectIds: number[] = [];

			if (user) {
				// Fetch role dari Firestore + karyawan dari Directus secara paralel
				const [firestoreUserResult, _rolesResult] = await Promise.allSettled([
					getAppUserById(user.uid),
					loadRoles()
				]);

				// Ambil karyawanId hint dari Firestore user (jika ada) sebelum fetch karyawan
				const firestoreUserEarly = firestoreUserResult.status === 'fulfilled' ? firestoreUserResult.value : null;
				const karyawanIdHint = firestoreUserEarly?.karyawanId ?? null;

				// Fetch karyawan setelah kita tahu karyawanId hint (untuk handle duplikat)
				let karyawanData: Awaited<ReturnType<typeof getKaryawanByEmail>> = null;
				if (user.email) {
					try {
						karyawanData = await getKaryawanByEmail(user.email, karyawanIdHint);
					} catch {}
				}

				const firestoreUser = firestoreUserResult.status === 'fulfilled' ? firestoreUserResult.value : null;
				if (firestoreUser) {
					role = firestoreUser.role;
					roleId = firestoreUser.roleId || firestoreUser.role;
					roleIds = Array.isArray(firestoreUser.roleIds) ? firestoreUser.roleIds : [];

					// jabatanId di Firestore adalah ID posisi Directus — gunakan sebagai roleId
					// jika tersedia (admin erp-epi menyimpannya saat assign jabatan ke user)
					if (firestoreUser.jabatanId != null) {
						const jabatanIdStr = String(firestoreUser.jabatanId);
						// FIX (21 Agu 2026): jangan timpa 'super_admin' — akun super_admin yang
						// juga punya jabatanId (mis. Leader) sebelumnya kehilangan status
						// super_admin sepenuhnya (ditemukan lewat pengujian manual Sales B2B PO/RAP v2).
						if (roleId !== 'super_admin') {
							roleId = jabatanIdStr;
						}
						if (!roleIds.includes(jabatanIdStr)) {
							roleIds = [jabatanIdStr, ...roleIds];
						}
					}
				}

				// Rencana RBAC v2, Bagian 7: cek email Super Admin hardcode di sini
				// dihapus -- getAppUserById() (dipanggil di atas) sudah melakukan
				// pengecekan yang sama lewat rbac_config.superAdminEmails, dan
				// hasilnya sudah ikut ke `role`/`roleId` lewat firestoreUser di atas.

				if (karyawanData) {
					karyawanName = karyawanData.nama_karyawan;
					karyawanId = karyawanData.id;
					karyawanDivisi = karyawanData.divisi || null;
					karyawanPosisi = karyawanData.posisi ? String(karyawanData.posisi).trim() : null;

					// Fallback: gunakan posisi dari Directus karyawan sebagai roleId jika:
					// 1) jabatanId Firestore tidak tersedia, DAN
					// 2) roleId saat ini tidak ditemukan di daftar posisi Directus
					const karyawanPosisiRaw = karyawanData.posisi
						? String(karyawanData.posisi).trim()
						: null;
					// FIX (2 Sep 2026): kolom `posisi` di koleksi karyawan menyimpan NAMA jabatan
					// ("SECURITY", "ADMIN SALES", ...), bukan id baris `posisi` (numerik). Dulu nama
					// itu dipakai apa adanya sebagai roleId, sehingga rolesStore tidak pernah
					// menemukannya -> hasPermission() selalu false -> penjaga akses tiap layout
					// memantulkan user keluar-masuk halaman (loop navigasi, tab kehabisan resource).
					// Sekarang nama dipetakan dulu ke id jabatan yang sebenarnya.
					let karyawanPosisiId = karyawanPosisiRaw;

					if (karyawanPosisiId && _rolesResult.status === 'fulfilled') {
						const loadedRoles = _rolesResult.value;
						const posisiByName = loadedRoles.find(
							(r) => (r.label || '').trim().toUpperCase() === karyawanPosisiRaw!.toUpperCase()
						);
						if (posisiByName) karyawanPosisiId = posisiByName.id;
						// FIX (21 Agu 2026): 'super_admin' tidak pernah ada di daftar posisi Directus
						// (bukan jabatan HRD) — tanpa guard ini, currentRoleValid selalu false untuk
						// super_admin dan roleId-nya tertimpa posisi karyawan di bawah. Sama dengan
						// SYSTEM_ROLES yang sudah dipakai di blok diagnosa mismatch beberapa baris ke bawah.
						const isSystemRole = roleId === 'super_admin' || roleId === 'admin' || roleId === 'system';
						const currentRoleValid = isSystemRole || (roleId && loadedRoles.find(r => r.id === roleId));
						if (!currentRoleValid) {
							// roleId Firestore tidak valid → gunakan posisi dari Directus karyawan
							if (!roleIds.includes(karyawanPosisiId)) {
								roleIds = [karyawanPosisiId, ...roleIds];
							}
							roleId = karyawanPosisiId;
							role = String(karyawanData.posisi);
						} else if (karyawanPosisiId && !roleIds.includes(karyawanPosisiId) && karyawanPosisiId !== roleId) {
							// roleId Firestore valid tapi tambahkan posisi karyawan ke roleIds (union)
							roleIds = [...roleIds, karyawanPosisiId];
						}
					}
				}

				// N2 fix (Rencana RBAC v2): dulu di sini login ke Directus pakai
				// directusPassword yang dibaca dari Firestore ke browser (sandi
				// tersimpan & terkirim dalam bentuk terbaca). directusToken adalah
				// lapisan tambahan opsional — getProjects() sudah selalu pakai client
				// admin bersama, dan getProjectById()/timelineAdendum sudah fallback
				// ke client admin bersama saat token ini kosong (perilaku yang SUDAH
				// berlaku untuk akun baru sejak A4 menutup satu-satunya jalur yang
				// membuat akun Directus per-user). Jadi dihapus tanpa fallback baru.

				// Sistem Manpower Leader — petakan akun ini ke baris `manpower` (kalau ada),
				// lalu ambil proyek tempat dia memegang kursi leader/wakil. Kursi inilah
				// yang mengikat orang lapangan ke proyek; role saja tidak mengikat apa-apa.
				try {
					const mp = await resolveManpowerForAccount(user.email, karyawanId);
					if (mp) {
						manpowerId = mp.id;
						manpowerNama = mp.nama;
						manpowerLeaderProjectIds = (await getProyekDipimpin(mp.id)).map((p) => p.id);
					}
				} catch (e) {
					console.warn('[Auth] Gagal memetakan akun ke manpower (diabaikan):', e);
				}

				// Diagnosa mismatch: cek apakah roleId user ada di daftar posisi Directus (abaikan role bawaan sistem)
				if (_rolesResult.status === 'fulfilled') {
					const loadedRoles = _rolesResult.value;
					const SYSTEM_ROLES = ['super_admin', 'admin', 'system'];
					const allRoleIds = [roleId, ...(roleIds || [])].filter(Boolean);
					const mismatched = allRoleIds.filter(id => id && !SYSTEM_ROLES.includes(id) && !loadedRoles.find(r => r.id === id));
					if (mismatched.length > 0) {
						console.warn('[Auth] Role pengguna tidak ditemukan di daftar posisi Directus.');
					}
				}

				watchUserDoc(user.uid);
			} else if (unsubscribeUserDoc) {
				unsubscribeUserDoc();
				unsubscribeUserDoc = null;
			}

			authStore.set({
				user,
				loading: false,
				checked: true,
				role,
				roleId,
				roleIds,
				karyawanName,
				karyawanId,
				karyawanDivisi,
				karyawanPosisi,
				directusToken,
				manpowerId,
				manpowerNama,
				manpowerLeaderProjectIds
			});
			authChecked = true;
			// Keputusan navigasi (redirect ke /login, landing per role, dsb) TIDAK dilakukan
			// di sini lagi -- lihat $effect di bawah. onAuthStateChanged ini async (menunggu
			// beberapa fetch Firestore/Directus) dan hanya terpicu SEKALI per perubahan status
			// auth, jadi `window.location.pathname` yang dibaca di titik ini bisa sudah basi
			// kalau ada navigasi client-side lain yang lolos duluan sebelum goto() di sini
			// sempat jalan -- goto() itu akan dibatalkan SvelteKit tanpa redirect pernah terjadi,
			// meninggalkan UI nyangkut di rute yang salah tanpa pernah sampai ke /login (bug
			// race condition, ditemukan saat pengujian kiosk produksi/deposit HP 26 Agu 2026).
			// $effect yang bereaksi ke page.url.pathname mengevaluasi ulang di SETIAP perubahan
			// rute, jadi redirect tetap terjadi walau ada navigasi susulan.
		});

		// Antrian offline (P2H, checklist peminjaman, driver, dll — lihat $lib/utils/offlineQueue.ts)
		// dikirim ulang otomatis saat koneksi kembali. Token diambil ULANG saat flush (bukan dipakai
		// dari saat antre), supaya tidak kedaluwarsa kalau operator offline lama.
		registerAutoFlush(async (entry: QueuedRequest) => {
			const user = auth.currentUser;
			if (!user) throw new Error('Sesi tidak ditemukan untuk mengirim ulang antrian.');
			const idToken = await user.getIdToken();
			return fetch(entry.url, {
				method: entry.method,
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
				body: JSON.stringify(entry.body)
			});
		});

		return () => {
			unsubscribe();
			if (unsubscribeUserDoc) unsubscribeUserDoc();
		};
	});

	// Semua keputusan navigasi berbasis auth (redirect ke /login, landing per role, blokir
	// /admin) dipusatkan di SATU $effect reaktif terhadap page.url.pathname & $authStore, BUKAN
	// dijalankan sekali di dalam callback onAuthStateChanged (lihat catatan di onMount di atas).
	// Karena $effect ini re-run di setiap perubahan rute, kalau ada goto() yang dibatalkan
	// SvelteKit oleh navigasi susulan yang lebih baru, evaluasi berikutnya (dipicu rute baru
	// itu sendiri) akan tetap mengoreksi ke tujuan yang benar -- race condition tidak lagi bisa
	// meninggalkan user nyangkut di rute yang salah tanpa pernah diarahkan ke /login.
	$effect(() => {
		const path = page.url.pathname as string;
		if (!$authStore.checked) return;

		// Fase 2 (rencana Optimasi Inventory & Produksi + Kiosk Produksi v2, 24 Agu 2026):
		// /kiosk pakai login badge+PIN sendiri (POST /api/kiosk/login), BUKAN Firebase Auth —
		// operator shift produksi tidak punya akun pribadi. Jangan pernah lempar ke /login.
		if (!$authStore.user) {
			// /konfirmasi/* = tautan WhatsApp konfirmasi pengajuan atas nama (token + 4 digit HP, tanpa akun).
			// /verifikasi/* = halaman verifikasi keaslian dokumen lewat QR (publik; dijaga tanda tangan HMAC di server).
			if (path !== '/login' && !path.startsWith('/kiosk') && !path.startsWith('/konfirmasi/') && !path.startsWith('/verifikasi/')) {
				// Simpan tujuan asli (mis. /scan/CP-AU-005 dari QR fisik) supaya setelah
				// login pengguna diarahkan balik ke sana, bukan ke beranda (rencana:
				// QR checkpoint/label scannable langsung dari kamera HP, 2026-07-29).
				const returnTo = path + page.url.search;
				goto(`/login?returnTo=${encodeURIComponent(returnTo)}`);
			}
			return;
		}

		if (path === '/admin' || path.startsWith('/admin/')) {
			goto('/');
			return;
		}

		// Landing page per role: diatur dari admin erp-epi-1 (/roles). Jatuh ke
		// '/ess' bila role tidak punya landingPage tersimpan (perilaku lama).
		let roleLandingPage = $authStore.roleId && getRoleById($authStore.roleId)?.landingPage;
		// Jika landing page adalah /admin (yang sudah dihapus di aplikasi lapangan ini),
		// arahkan ke / (beranda utama lapangan) untuk menghindari 404.
		if (roleLandingPage === '/admin') {
			roleLandingPage = '/';
		}
		const defaultLanding = roleLandingPage && roleLandingPage.startsWith('/') && !roleLandingPage.startsWith('//')
			? roleLandingPage
			: '/ess';

		if (path === '/login') {
			const returnTo = page.url.searchParams.get('returnTo');
			landingRedirectDone = true;
			goto(returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : defaultLanding);
		} else if (path === '/' && defaultLanding !== '/' && !landingRedirectDone) {
			landingRedirectDone = true;
			goto(defaultLanding);
		} else if (path !== '/') {
			// User sudah berada di luar beranda: sesi landing dianggap selesai. Kalau nanti
			// dia balik ke '/' (sengaja lewat menu, atau dipantulkan penjaga akses layout
			// anak), beranda dihormati apa adanya.
			landingRedirectDone = true;
		}
	});
</script>

<svelte:head>
	<title>SI-TAMA OPERATIONAL DASHBOARD</title>
</svelte:head>

<Toast />
<NavigationProgressBar />
<UpdateBanner />

{#if $previewMode === 'desktop'}
	<div class="app-container w-full min-h-screen relative flex flex-col lg:flex-row" data-preview="desktop">
		{#if !authChecked}
			<div class="flex-1 flex items-center justify-center min-h-screen" style="background: var(--sys-bg)">
				<div class="flex flex-col items-center gap-4">
					<div class="relative w-12 h-12">
						<div class="absolute inset-0 rounded-full border-[2.5px] border-[var(--gl)]"></div>
						<div class="absolute inset-0 rounded-full border-[2.5px] border-t-[var(--g)] border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
						<div class="absolute inset-[5px] rounded-full border-[2px] border-t-[var(--gd)]/40 border-r-transparent border-b-transparent border-l-transparent animate-spin" style="animation-duration: 0.5s; animation-direction: reverse;"></div>
					</div>
					<p class="text-[13px] font-medium" style="color: var(--sys-label3)">Memuat...</p>
				</div>
			</div>
		{:else}
			{@render children()}
		{/if}
	</div>
{:else}
	<div class="device-preview-wrapper" data-preview={$previewMode}>
		<div class="device-frame {$previewMode}">
			<div class="device-speaker-notch"></div>
			<div class="device-screen-wrap">
				{#if !authChecked}
					<div class="flex-1 flex items-center justify-center h-full min-h-[360px]" style="background: var(--sys-bg)">
						<div class="flex flex-col items-center gap-4">
							<div class="relative w-12 h-12">
								<div class="absolute inset-0 rounded-full border-[2.5px] border-[var(--gl)]"></div>
								<div class="absolute inset-0 rounded-full border-[2.5px] border-t-[var(--g)] border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
								<div class="absolute inset-[5px] rounded-full border-[2px] border-t-[var(--gd)]/40 border-r-transparent border-b-transparent border-l-transparent animate-spin" style="animation-duration: 0.5s; animation-direction: reverse;"></div>
							</div>
							<p class="text-[13px] font-medium" style="color: var(--sys-label3)">Memuat...</p>
						</div>
					</div>
				{:else}
					<div class="app-container w-full h-full relative flex flex-col overflow-y-auto" data-preview={$previewMode}>
						{@render children()}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

{#if $authStore.user}
	<GlobalSearchModal />
{/if}


