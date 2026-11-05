<script lang="ts">
	// Kiosk Proyek — layar kru di HP/tablet yang sudah diaktifkan leader (Rencana Kiosk Proyek, Fase 1).
	// Tanpa Firebase: identitas perangkat = cookie HMAC (epi_kiosk_proyek) yang dipasang saat aktivasi.
	// Fase 1 aktivasi + daftar kru; Fase 2 absen HADIR/PULANG; Fase 3 HP pribadi (ikat nama + kode harian) & PWA.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { IconLoader2, IconRefresh, IconSearch, IconHelp, IconAlertTriangle, IconShieldCheck, IconCamera, IconCircleCheck, IconX, IconDeviceMobile, IconNotes, IconPackage } from '@tabler/icons-svelte';
	import { AbsenKioskError, ambilLokasi, kirimAbsenKiosk, kompresFotoKiosk, type HasilAbsen, type Lokasi } from '$lib/services/kioskProyekAbsen';
	import { lokasiMasihSegar } from '$lib/utils/kioskProyekRetry';
	import { filterKru, inisial, labelStatusKru, tokenDariHash } from '$lib/utils/kioskProyekRoster';
	import { ikatLangkahKode, ikatPilih, infoIkat, type KruIkat } from '$lib/services/kioskProyekIkat';
	import { pasangManifestKiosk } from '$lib/utils/kioskProyekPwa';
	import PasangDiLayarUtama from '$lib/components/kiosk/PasangDiLayarUtama.svelte';
	import CatatanKerjaSheet from '$lib/components/kiosk/CatatanKerjaSheet.svelte';
	import PakaiBarangSheet from '$lib/components/kiosk/PakaiBarangSheet.svelte';
	import type { PengaturanCatatan } from '$lib/services/kioskProyekCatatan';

	type Fase = 'memuat' | 'aktivasi' | 'siap' | 'butuh_aktivasi' | 'ikat' | 'mati' | 'tidak_sah' | 'kode_beda' | 'gagal';

	const kode = $derived(String(page.params.kode || '').toUpperCase());

	let fase = $state<Fase>('memuat');
	let pesan = $state('');
	let roster = $state<any>(null);
	let perangkat = $state<any>(null);
	let q = $state('');
	let bantuan = $state(false);
	let memuatUlang = $state(false);
	let fotoMaxKb = $state(150);
	let mode = $state<'bersama' | 'pribadi'>('bersama');

	// ── Catatan Kerja (Fase 4) ─────────────────────────────────────────────────
	let pengCatatan = $state<PengaturanCatatan | null>(null); // null = dimatikan admin → tombol tidak tampil
	let catatanUntuk = $state<any>(null);

	// ── Pakai Barang / draf pemakaian (Fase 5) ─────────────────────────────────
	let pengPemakaian = $state<{ foto_wajib: boolean } | null>(null); // null = dimatikan admin → tombol tidak tampil
	let pakaiBarangUntuk = $state<any>(null);

	function bukaCatatan(k: any) {
		catatanUntuk = k;
	}
	/** Alasan penolakan perangkat dari server (dicabut / kedaluwarsa / kiosk dimatikan) → layar yang sesuai. */
	function tanganiAlasanPerangkat(reason: string) {
		catatanUntuk = null;
		pakaiBarangUntuk = null;
		if (reason === 'perangkat_tidak_sah') fase = 'tidak_sah';
		else if (reason === 'belum_aktif') fase = 'butuh_aktivasi';
		else if (reason === 'kiosk_mati') fase = 'mati';
	}

	// ── Ikat HP pribadi (Fase 3) ───────────────────────────────────────────────
	let ikatLangkah = $state<'kode' | 'nama'>('kode');
	let ikatKode = $state('');
	let ikatToken = $state('');
	let ikatKru = $state<KruIkat[]>([]);
	let ikatQ = $state('');
	let ikatTerpilih = $state<KruIkat | null>(null);
	let ikatBusy = $state(false);
	let ikatPesan = $state('');
	let ikatProyek = $state('');
	const ikatTampil = $derived(filterKru(ikatKru, ikatQ));

	async function mulaiIkat() {
		ikatPesan = '';
		ikatKode = '';
		ikatQ = '';
		ikatTerpilih = null;
		ikatBusy = true;
		try {
			const info = await infoIkat(kode);
			ikatProyek = info.project_name;
			ikatLangkah = 'kode';
			fase = 'ikat';
			if (!info.butuh_kode_harian) await kirimKodeHarian(); // admin mematikan kode harian
		} catch (e) {
			ikatPesan = (e as Error).message;
			fase = 'ikat';
		} finally {
			ikatBusy = false;
		}
	}

	async function kirimKodeHarian() {
		ikatPesan = '';
		ikatBusy = true;
		try {
			const r = await ikatLangkahKode(kode, ikatKode.trim() || undefined);
			ikatToken = r.bind_token;
			ikatKru = r.kru;
			ikatProyek = r.project_name;
			ikatLangkah = 'nama';
		} catch (e) {
			ikatPesan = (e as Error).message;
		} finally {
			ikatBusy = false;
		}
	}

	async function konfirmasiIkat() {
		if (!ikatTerpilih) return;
		ikatPesan = '';
		ikatBusy = true;
		try {
			await ikatPilih(kode, ikatToken, ikatTerpilih.manpower_id);
			fase = 'memuat';
			await muatRoster();
		} catch (e) {
			ikatPesan = (e as Error).message;
		} finally {
			ikatBusy = false;
		}
	}

	// ── Absen (Fase 2) ─────────────────────────────────────────────────────────
	let dipilih = $state<any>(null); // kru yang namanya ditekan
	type Tahap = 'siap' | 'lokasi' | 'kirim' | 'sukses' | 'gagal';
	let tahap = $state<Tahap>('siap');
	let pesanAbsen = $state('');
	let hasil = $state<HasilAbsen | null>(null);
	let fotoInput = $state<HTMLInputElement | null>(null);
	let lokasiPromise: Promise<Lokasi> | null = null;
	let tutupTimer: ReturnType<typeof setTimeout> | null = null;

	// Foto TERKOMPRES + lokasi disimpan di memori selama satu percobaan absen, supaya "Kirim ulang" setelah sinyal putus
	// tidak memaksa memotret ulang. Hanya hidup di memori halaman (hilang saat ditutup/pindah orang), tidak disimpan di disk.
	type PercobaanAbsen = { aksi: 'masuk' | 'pulang'; manpowerId: number; foto: File; lokasi: Lokasi | null; lokasiAt: number | null };
	let percobaan = $state<PercobaanAbsen | null>(null);
	let bisaUlangAbsen = $state(false);
	function lupakanPercobaan() {
		percobaan = null;
		bisaUlangAbsen = false;
	}

	/** Aksi yang tersedia untuk satu kru hari ini: masuk, pulang, atau tidak ada (sudah lengkap / izin dll). */
	function aksiUntuk(k: any): 'masuk' | 'pulang' | null {
		const h = k?.hari_ini;
		if (!h || !h.status) return 'masuk';
		if ((h.status === 'hadir' || h.status === 'setengah_hari') && !h.jam_pulang) return 'pulang';
		return null;
	}
	const aksiDipilih = $derived(aksiUntuk(dipilih));

	function bukaSheet(k: any) {
		lupakanPercobaan();
		dipilih = k;
		tahap = 'siap';
		pesanAbsen = '';
		hasil = null;
	}
	function tutupSheet() {
		lupakanPercobaan();
		if (tutupTimer) clearTimeout(tutupTimer);
		dipilih = null;
		lokasiPromise = null;
	}

	/** HP pribadi: tombol utama langsung membuka kamera (nama sudah pasti), tanpa memilih nama dulu. */
	function absenDiri(diri: any) {
		dipilih = diri;
		tahap = 'siap';
		pesanAbsen = '';
		hasil = null;
		mulaiAbsen();
	}

	// Dipanggil LANGSUNG dari tap tombol (gestur pengguna): GPS dimulai di sini supaya izin lokasi muncul
	// bersamaan dengan kamera dan tidak diblokir browser; input foto dibuka sinkron (tanpa await sebelumnya).
	function mulaiAbsen() {
		if (!aksiDipilih) return;
		lokasiPromise = ambilLokasi();
		lokasiPromise.catch(() => {}); // ditangani saat dipakai
		fotoInput?.click();
	}

	async function fotoDipilih(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const foto = input.files?.[0];
		input.value = ''; // boleh memilih ulang file yang sama
		if (!foto || !dipilih || !aksiDipilih) return;
		const aksi = aksiDipilih;
		lupakanPercobaan();
		try {
			tahap = 'kirim';
			// Kompres SEKALI dan simpan — kegagalan sinyal berikutnya tidak membuang foto ini.
			const kecil = await kompresFotoKiosk(foto, fotoMaxKb);
			percobaan = { aksi, manpowerId: dipilih.manpower_id, foto: kecil, lokasi: null, lokasiAt: null };
			// Bila GPS gagal, foto tetap tersimpan di `percobaan`; Kirim ulang akan meminta GPS lagi.
			tahap = 'lokasi';
			percobaan.lokasi = await (lokasiPromise ?? ambilLokasi());
			percobaan.lokasiAt = Date.now();
			await kirimPercobaan();
		} catch (err) {
			tanganiGagal(err);
		}
	}

	/** Kirim (atau kirim ulang) percobaan yang tersimpan. Lokasi lama dipakai ulang hanya bila masih segar (< 3 menit). */
	async function kirimPercobaan() {
		const c = percobaan;
		if (!c) return;
		try {
			if (!c.lokasi || !lokasiMasihSegar(c.lokasiAt)) {
				tahap = 'lokasi';
				c.lokasi = await ambilLokasi();
				c.lokasiAt = Date.now();
			}
			tahap = 'kirim';
			hasil = await kirimAbsenKiosk({ aksi: c.aksi, manpowerId: c.manpowerId, foto: c.foto, lokasi: c.lokasi });
			tahap = 'sukses';
			lupakanPercobaan();
			muatRoster(true); // server sudah membuang cache roster
			tutupTimer = setTimeout(tutupSheet, hasil.peringatan.length || hasil.masuk_valid === false ? 7000 : 3500);
		} catch (err) {
			tanganiGagal(err);
		}
	}

	function tanganiGagal(err: unknown) {
		const ex = err as AbsenKioskError;
		pesanAbsen = ex?.message || 'Absen gagal.';
		tahap = 'gagal';
		// Kirim ulang hanya bila kegagalannya jaringan/server DAN fotonya masih ada; penolakan karena isi (foto ganda,
		// di luar jam, dsb.) selalu kembali ke awal agar kru mengubah sesuatu.
		bisaUlangAbsen = !!percobaan && (ex?.bisaUlang ?? false);
		if (!bisaUlangAbsen) lupakanPercobaan();
		if (ex?.reason === 'perangkat_tidak_sah') { tutupSheet(); fase = 'tidak_sah'; }
		else if (ex?.reason === 'belum_aktif') { tutupSheet(); fase = 'butuh_aktivasi'; }
		else if (ex?.reason === 'kiosk_mati') { tutupSheet(); fase = 'mati'; }
	}

	const kruTampil = $derived(filterKru(roster?.kru, q));
	const tanggalLabel = $derived(
		roster?.tanggal
			? new Date(`${roster.tanggal}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })
			: ''
	);

	const tone: Record<string, string> = {
		belum: 'bg-gray-100 text-gray-600',
		hadir: 'bg-emerald-100 text-emerald-700',
		pulang: 'bg-blue-100 text-blue-700',
		izin: 'bg-amber-100 text-amber-700',
		lain: 'bg-red-100 text-red-700'
	};

	function labelPerangkat(): string {
		const ua = navigator.userAgent || '';
		const jenis = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : 'Peramban';
		return `${jenis} · ${new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
	}

	async function aktivasi(token: string): Promise<boolean> {
		fase = 'aktivasi';
		try {
			const res = await fetch('/api/kiosk-proyek/aktivasi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kode, token, label: labelPerangkat() })
			});
			if (!res.ok) {
				const j = await res.json().catch(() => null);
				pesan = j?.message || `Aktivasi gagal (${res.status}).`;
				fase = res.status === 403 ? 'mati' : 'gagal';
				return false;
			}
			return true;
		} catch {
			pesan = 'Tidak ada koneksi internet. Coba lagi saat sinyal ada.';
			fase = 'gagal';
			return false;
		}
	}

	async function muatRoster(manual = false) {
		if (manual) memuatUlang = true;
		try {
			const res = await fetch(`/api/kiosk-proyek/roster?kode=${encodeURIComponent(kode)}`, { cache: 'no-store' });
			const j = await res.json().catch(() => null);
			if (res.ok && j?.ok) {
				roster = j.roster;
				perangkat = j.device;
				mode = j.mode === 'pribadi' ? 'pribadi' : 'bersama';
				pengCatatan = j.pengaturan?.catatan ?? null;
				pengPemakaian = j.pengaturan?.pemakaian ?? null;
				fotoMaxKb = j.pengaturan?.foto_maks_kb ?? 150;
				fase = 'siap';
				return;
			}
			const reason = j?.reason;
			if (reason === 'kiosk_mati') fase = 'mati';
			else if (reason === 'belum_aktif') fase = 'butuh_aktivasi';
			else if (reason === 'perangkat_tidak_sah') fase = 'tidak_sah';
			else if (reason === 'kode_beda') {
				pesan = j?.project_name || '';
				fase = 'kode_beda';
			} else {
				pesan = j?.message || `Gagal memuat (${res.status}).`;
				if (manual && roster) return; // pertahankan daftar lama saat refresh manual gagal
				fase = 'gagal';
			}
		} catch {
			pesan = 'Tidak ada koneksi internet.';
			if (!(manual && roster)) fase = 'gagal';
		} finally {
			memuatUlang = false;
		}
	}

	// Ikon layar utama membuka kiosk proyek INI (bukan beranda aplikasi) — manifest per kode.
	onMount(() => pasangManifestKiosk(kode));

	onMount(async () => {
		const token = tokenDariHash(location.hash);
		if (token) {
			// Hapus token dari bilah alamat segera — sekali pakai, tidak perlu tersimpan di riwayat.
			history.replaceState(null, '', location.pathname + location.search);
			if (!(await aktivasi(token))) return;
		}
		await muatRoster();
	});
</script>

<svelte:head><title>Kiosk Proyek {kode}</title></svelte:head>

<div class="min-h-screen bg-gray-50 text-gray-900">
	<div class="max-w-xl mx-auto p-4 pb-16">
		{#if fase === 'memuat' || fase === 'aktivasi'}
			<div class="flex flex-col items-center gap-3 py-24 text-gray-500">
				<IconLoader2 class="animate-spin" size={36} />
				<p class="text-lg">{fase === 'aktivasi' ? 'Mengaktifkan perangkat…' : 'Memuat daftar kru…'}</p>
			</div>

		{:else if fase === 'butuh_aktivasi'}
			<div class="py-16 text-center space-y-4">
				<IconShieldCheck size={56} class="mx-auto text-emerald-600" />
				<h1 class="text-2xl font-bold">Perangkat ini belum diaktifkan</h1>
				<p class="text-lg text-gray-600">Minta <b>leader proyek</b> membuka <b>Regu → Kiosk → Tampilkan QR aktivasi</b>, lalu scan QR itu dengan kamera HP ini.</p>
				<div class="pt-2 space-y-2">
					<p class="text-sm text-gray-500">Memakai HP sendiri dan tidak ada tablet bersama?</p>
					<button onclick={mulaiIkat} disabled={ikatBusy} class="inline-flex items-center gap-2 px-6 py-4 rounded-2xl bg-emerald-600 text-white text-xl font-bold disabled:opacity-50"><IconDeviceMobile size={26} /> Ikat HP saya</button>
				</div>
				<p class="text-sm text-gray-400">Kode proyek: <b class="tracking-widest">{kode}</b></p>
				<PasangDiLayarUtama sebelumIkat />
			</div>

		{:else if fase === 'ikat'}
			<div class="py-6 space-y-4">
				<div class="text-center space-y-1">
					<IconDeviceMobile size={48} class="mx-auto text-emerald-600" />
					<h1 class="text-2xl font-bold">Ikat HP saya</h1>
					{#if ikatProyek}<p class="text-gray-500">{ikatProyek}</p>{/if}
				</div>

				{#if ikatLangkah === 'kode'}
					<p class="text-lg text-gray-600 text-center">Tanyakan <b>kode harian 6 digit</b> ke leader (tampil di HP leader, tab Kiosk). Kode berganti tiap hari.</p>
					<input bind:value={ikatKode} inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" aria-label="Kode harian 6 digit"
						class="w-full text-center text-4xl tracking-[0.35em] py-4 rounded-2xl border border-gray-300 bg-white" placeholder="••••••" />
					<button onclick={kirimKodeHarian} disabled={ikatKode.trim().length !== 6 || ikatBusy} class="w-full py-4 rounded-2xl bg-emerald-600 text-white text-xl font-bold disabled:opacity-40">
						{ikatBusy ? 'Memeriksa…' : 'Lanjut'}
					</button>
				{:else if ikatTerpilih}
					<div class="p-5 rounded-3xl bg-white border border-gray-200 text-center space-y-3">
						<p class="text-lg text-gray-600">HP ini akan terikat ke nama:</p>
						<p class="text-3xl font-bold">{ikatTerpilih.nama}</p>
						<p class="text-base text-gray-500">Pastikan itu <b>nama Anda sendiri</b>. HP ini hanya bisa dipakai absen untuk nama ini.</p>
						{#if ikatTerpilih.terikat}
							<p class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-base">Nama ini sudah terikat ke HP lain. Melanjutkan akan <b>mencabut HP yang lama</b>.</p>
						{/if}
						<button onclick={konfirmasiIkat} disabled={ikatBusy} class="w-full py-4 rounded-2xl bg-emerald-600 text-white text-xl font-bold disabled:opacity-50">{ikatBusy ? 'Mengikat…' : 'Ya, ini saya'}</button>
						<button onclick={() => (ikatTerpilih = null)} disabled={ikatBusy} class="w-full py-3 rounded-2xl border border-gray-300 text-lg">Bukan, pilih lagi</button>
					</div>
				{:else}
					<p class="text-lg text-gray-600 text-center">Pilih <b>nama Anda</b>.</p>
					<label class="flex items-center gap-2 px-3 py-3 rounded-xl border border-gray-300 bg-white">
						<IconSearch size={20} class="text-gray-400 shrink-0" />
						<input bind:value={ikatQ} placeholder="Cari nama…" class="w-full text-lg outline-none bg-transparent" autocomplete="off" />
					</label>
					<ul class="space-y-2">
						{#each ikatTampil as k (k.manpower_id)}
							<li>
								<button type="button" onclick={() => (ikatTerpilih = k)} class="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-white border border-gray-200 active:bg-emerald-50">
									<div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center shrink-0">{inisial(k.nama)}</div>
									<div class="min-w-0 flex-1">
										<p class="text-lg font-semibold leading-tight truncate">{k.nama}</p>
										<p class="text-sm text-gray-500 truncate">{k.posisi || '—'}{k.terikat ? ' · sudah terikat ke HP lain' : ''}</p>
									</div>
								</button>
							</li>
						{:else}
							<li class="p-4 text-center text-gray-500">Tidak ada nama yang cocok. Belum terdaftar? Hubungi leader.</li>
						{/each}
					</ul>
				{/if}

				{#if ikatPesan}
					<p class="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-base">{ikatPesan}</p>
				{/if}
				<button onclick={() => { fase = 'butuh_aktivasi'; ikatPesan = ''; }} disabled={ikatBusy} class="w-full py-3 text-gray-500 underline">Batal</button>
				<PasangDiLayarUtama sebelumIkat />
			</div>

		{:else if fase === 'mati'}
			<div class="py-16 text-center space-y-3">
				<IconAlertTriangle size={56} class="mx-auto text-amber-500" />
				<h1 class="text-2xl font-bold">Kiosk Proyek belum dibuka</h1>
				<p class="text-lg text-gray-600">Fitur ini belum dinyalakan oleh admin. Hubungi leader atau admin proyek.</p>
			</div>

		{:else if fase === 'tidak_sah'}
			<div class="py-16 text-center space-y-3">
				<IconAlertTriangle size={56} class="mx-auto text-red-500" />
				<h1 class="text-2xl font-bold">Perangkat tidak berlaku lagi</h1>
				<p class="text-lg text-gray-600">Perangkat ini sudah dicabut atau masa berlakunya habis. Minta leader menampilkan QR aktivasi baru, atau ikat HP Anda lagi dengan kode harian.</p>
				<button onclick={mulaiIkat} disabled={ikatBusy} class="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-600 text-white text-lg font-bold disabled:opacity-50"><IconDeviceMobile size={22} /> Ikat HP saya</button>
			</div>

		{:else if fase === 'kode_beda'}
			<div class="py-16 text-center space-y-3">
				<IconAlertTriangle size={56} class="mx-auto text-amber-500" />
				<h1 class="text-2xl font-bold">Ini bukan proyek perangkat ini</h1>
				<p class="text-lg text-gray-600">Perangkat ini aktif untuk proyek <b>{pesan || 'lain'}</b>, bukan kode <b>{kode}</b>. Untuk pindah proyek, minta QR aktivasi baru dari leader proyek tujuan.</p>
			</div>

		{:else if fase === 'gagal'}
			<div class="py-16 text-center space-y-4">
				<IconAlertTriangle size={56} class="mx-auto text-red-500" />
				<h1 class="text-2xl font-bold">Tidak berhasil</h1>
				<p class="text-lg text-gray-600">{pesan}</p>
				<button onclick={() => { fase = 'memuat'; muatRoster(); }} class="px-6 py-3 rounded-xl bg-emerald-600 text-white text-lg font-semibold">Coba lagi</button>
			</div>

		{:else if fase === 'siap' && roster && mode === 'pribadi'}
			{@const diri = roster.kru[0]}
			<header class="mb-4 flex items-start justify-between gap-2">
				<div class="min-w-0">
					<h1 class="text-xl font-bold leading-tight">{roster.project.name}</h1>
					<p class="text-sm text-gray-500">{tanggalLabel}</p>
				</div>
				<div class="flex gap-2 shrink-0">
					<button onclick={() => muatRoster(true)} disabled={memuatUlang} class="p-3 rounded-xl border border-gray-300 bg-white disabled:opacity-40" aria-label="Muat ulang" title="Muat ulang">
						<IconRefresh size={22} class={memuatUlang ? 'animate-spin' : ''} />
					</button>
					<button onclick={() => (bantuan = !bantuan)} class="p-3 rounded-xl border border-gray-300 bg-white" aria-label="Cara pakai" title="Cara pakai"><IconHelp size={22} /></button>
				</div>
			</header>

			{#if bantuan}
				<div class="mb-3 p-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-900 space-y-1">
					<p class="font-semibold">Cara pakai</p>
					<ul class="list-disc pl-5 space-y-0.5">
						<li>Pagi: tekan <b>HADIR</b> → foto wajah (kamera depan). Sore: tekan <b>PULANG</b> → foto lagi.</li>
						<li>Aktifkan izin lokasi bila diminta. Foto harus diambil langsung, bukan dari galeri.</li>
						{#if pengCatatan}<li>Tombol <b>Catatan kerja</b>: kirim foto progres atau kendala ke leader tanpa perlu mengetik panjang.</li>{/if}
						{#if pengPemakaian}<li>Tombol <b>Pakai barang</b>: ajukan barang proyek yang Anda pakai. Stok baru berkurang setelah leader memasukkannya ke laporan.</li>{/if}
						<li>HP ini hanya untuk absen <b>diri sendiri</b>. Ganti HP? Ikat HP baru lewat kode harian, HP lama otomatis dicabut.</li>
						<li>Aktif sampai {perangkat?.kedaluwarsa_pada ? new Date(perangkat.kedaluwarsa_pada).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' }) : '—'}. Hilang? Beri tahu leader agar dicabut.</li>
					</ul>
				</div>
			{/if}

			{#if !diri}
				<p class="p-5 text-center text-lg text-gray-600 rounded-2xl bg-white border border-gray-200">Anda tidak terdaftar lagi di proyek ini. Hubungi leader.</p>
			{:else}
				{@const st = labelStatusKru(diri.hari_ini)}
				{@const aksi = aksiUntuk(diri)}
				<div class="p-6 rounded-3xl bg-white border border-gray-200 text-center space-y-3">
					<div class="w-20 h-20 mx-auto rounded-full bg-emerald-100 text-emerald-700 text-2xl font-bold flex items-center justify-center">{inisial(diri.nama)}</div>
					<p class="text-2xl font-bold leading-tight">{diri.nama}</p>
					<p class="text-gray-500">{diri.posisi || '—'}</p>
					<span class="inline-block px-4 py-1.5 rounded-full text-base font-semibold {tone[st.tone]}">{st.teks}</span>
					{#if aksi}
						<button onclick={() => absenDiri(diri)} class="w-full flex items-center justify-center gap-3 py-6 rounded-2xl text-white text-3xl font-bold {aksi === 'masuk' ? 'bg-emerald-600' : 'bg-blue-600'}">
							<IconCamera size={34} /> {aksi === 'masuk' ? 'HADIR' : 'PULANG'}
						</button>
					{:else}
						<p class="text-lg text-gray-600 pt-2">Absen hari ini sudah lengkap atau dicatat leader. Terima kasih.</p>
					{/if}
					{#if pengCatatan}
						<button onclick={() => bukaCatatan(diri)} class="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-gray-300 text-gray-800 text-xl font-semibold">
							<IconNotes size={24} /> Catatan kerja
						</button>
					{/if}
					{#if pengPemakaian}
						<button onclick={() => (pakaiBarangUntuk = diri)} class="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-gray-300 text-gray-800 text-xl font-semibold">
							<IconPackage size={24} /> Pakai barang
						</button>
					{/if}
				</div>
			{/if}
			<PasangDiLayarUtama />

		{:else if fase === 'siap' && roster}
			<header class="mb-4">
				<div class="flex items-start justify-between gap-2">
					<div class="min-w-0">
						<h1 class="text-xl font-bold leading-tight">{roster.project.name}</h1>
						<p class="text-sm text-gray-500">{tanggalLabel}</p>
					</div>
					<div class="flex gap-2 shrink-0">
						<button onclick={() => muatRoster(true)} disabled={memuatUlang} class="p-3 rounded-xl border border-gray-300 bg-white disabled:opacity-40" aria-label="Muat ulang daftar" title="Muat ulang daftar">
							<IconRefresh size={22} class={memuatUlang ? 'animate-spin' : ''} />
						</button>
						<button onclick={() => (bantuan = !bantuan)} class="p-3 rounded-xl border border-gray-300 bg-white" aria-label="Cara pakai" title="Cara pakai"><IconHelp size={22} /></button>
					</div>
				</div>

				{#if bantuan}
					<div class="mt-3 p-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-900 space-y-1">
						<p class="font-semibold">Cara pakai</p>
						<ul class="list-disc pl-5 space-y-0.5">
							<li>Tekan <b>nama Anda</b> → tekan tombol hijau → foto wajah (kamera depan) → selesai. Aktifkan izin lokasi bila diminta.</li>
							<li>Pagi: <b>HADIR</b>. Sore: tekan nama lagi → <b>PULANG</b>. Jam dicatat otomatis oleh server, bukan jam HP.</li>
							<li>Foto harus diambil langsung (bukan dari galeri). Absen di luar jam atau di luar area proyek tetap tercatat tapi ditandai untuk leader.</li>
							{#if pengCatatan}<li>Mau melapor pekerjaan atau kendala? Tekan nama → <b>Catatan kerja</b> → pilih jenis, ambil foto, kirim. Leader yang memasukkannya ke laporan.</li>{/if}
							{#if pengPemakaian}<li>Memakai barang proyek? Tekan nama → <b>Pakai barang</b> → pilih barang, isi jumlah, foto, ajukan. Ini pengajuan: stok baru berkurang setelah leader memasukkannya ke laporan.</li>{/if}
							<li>Tekan ikon muat ulang untuk melihat status terbaru.</li>
							<li>Perangkat ini aktif sampai {perangkat?.kedaluwarsa_pada ? new Date(perangkat.kedaluwarsa_pada).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' }) : '—'}. Hilang? Beri tahu leader agar dicabut.</li>
						</ul>
					</div>
				{/if}

				<div class="grid grid-cols-3 gap-2 mt-3 text-center">
					<div class="p-2 rounded-xl bg-white border border-gray-200"><p class="text-2xl font-bold">{roster.ringkasan.terdaftar}</p><p class="text-xs text-gray-500">Terdaftar</p></div>
					<div class="p-2 rounded-xl bg-emerald-50 border border-emerald-200"><p class="text-2xl font-bold text-emerald-700">{roster.ringkasan.hadir}</p><p class="text-xs text-emerald-700">Hadir</p></div>
					<div class="p-2 rounded-xl bg-gray-100 border border-gray-200"><p class="text-2xl font-bold text-gray-700">{roster.ringkasan.belum}</p><p class="text-xs text-gray-500">Belum absen</p></div>
				</div>

				<label class="mt-3 flex items-center gap-2 px-3 py-3 rounded-xl border border-gray-300 bg-white">
					<IconSearch size={20} class="text-gray-400 shrink-0" />
					<input bind:value={q} placeholder="Cari nama…" class="w-full text-lg outline-none bg-transparent" autocomplete="off" />
				</label>
			</header>

			{#if roster.kru.length === 0}
				<p class="p-4 text-center text-gray-500 rounded-xl bg-white border border-gray-200">Belum ada kru terdaftar di proyek ini.</p>
			{:else if kruTampil.length === 0}
				<p class="p-4 text-center text-gray-500">Tidak ada nama yang cocok dengan “{q}”.</p>
			{:else}
				<ul class="space-y-2">
					{#each kruTampil as k (k.manpower_id)}
						{@const st = labelStatusKru(k.hari_ini)}
						<li>
						<button type="button" onclick={() => bukaSheet(k)} class="w-full text-left flex items-center gap-3 p-3 rounded-2xl bg-white border border-gray-200 active:bg-emerald-50">
							<div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 font-bold flex items-center justify-center shrink-0">{inisial(k.nama)}</div>
							<div class="min-w-0 flex-1">
								<p class="text-lg font-semibold leading-tight truncate">{k.nama}</p>
								<p class="text-sm text-gray-500 truncate">{k.posisi || '—'}{k.adalah_leader ? ' · Leader' : ''}{k.penugasan !== 'aktif' ? ' · Baru (menunggu SPK)' : ''}</p>
							</div>
							<span class="px-3 py-1 rounded-full text-sm font-semibold shrink-0 {tone[st.tone]}">{st.teks}</span>
						</button>
						</li>
					{/each}
				</ul>
			{/if}
		{/if}
	</div>
</div>

<!-- Selalu ada di DOM: HP pribadi membuka kamera langsung dari tombol utama (tanpa sheet). -->
<input bind:this={fotoInput} type="file" accept="image/*" capture="user" class="hidden" onchange={fotoDipilih} />

{#if dipilih && (mode !== 'pribadi' || tahap !== 'siap')}
	{@const stDipilih = labelStatusKru(dipilih.hari_ini)}
	<div class="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
		<div class="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-4">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<p class="text-2xl font-bold leading-tight">{dipilih.nama}</p>
					<p class="text-sm text-gray-500">{dipilih.posisi || '—'} · <span class="font-semibold">{stDipilih.teks}</span></p>
				</div>
				{#if tahap !== 'lokasi' && tahap !== 'kirim'}
					<button onclick={tutupSheet} class="p-2 rounded-xl border border-gray-300" aria-label="Tutup"><IconX size={22} /></button>
				{/if}
			</div>

			{#if tahap === 'siap'}
				{#if aksiDipilih}
					<p class="text-base text-gray-600">Pastikan Anda memilih <b>nama sendiri</b>. Foto wajah akan diambil dengan kamera depan.</p>
					<button onclick={mulaiAbsen} class="w-full flex items-center justify-center gap-3 py-5 rounded-2xl text-white text-2xl font-bold {aksiDipilih === 'masuk' ? 'bg-emerald-600' : 'bg-blue-600'}">
						<IconCamera size={30} /> {aksiDipilih === 'masuk' ? 'HADIR' : 'PULANG'}
					</button>
				{:else}
					<p class="text-lg text-gray-600 py-4">Absen hari ini untuk {dipilih.nama} sudah lengkap atau dicatat leader. Tidak ada yang perlu dilakukan.</p>
				{/if}
				{#if pengCatatan || pengPemakaian}
					<div class="space-y-2">
						{#if pengCatatan}
							<button onclick={() => { const k = dipilih; tutupSheet(); bukaCatatan(k); }} class="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-gray-300 text-gray-800 text-xl font-semibold">
								<IconNotes size={24} /> Catatan kerja
							</button>
						{/if}
						{#if pengPemakaian}
							<button onclick={() => { const k = dipilih; tutupSheet(); pakaiBarangUntuk = k; }} class="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-gray-300 text-gray-800 text-xl font-semibold">
								<IconPackage size={24} /> Pakai barang
							</button>
						{/if}
					</div>
				{/if}

			{:else if tahap === 'lokasi' || tahap === 'kirim'}
				<div class="flex flex-col items-center gap-3 py-8 text-gray-600">
					<IconLoader2 class="animate-spin" size={40} />
					<p class="text-lg">{tahap === 'lokasi' ? 'Membaca lokasi…' : 'Mengirim absen…'}</p>
				</div>

			{:else if tahap === 'sukses' && hasil}
				<div class="flex flex-col items-center gap-2 py-4 text-center">
					<IconCircleCheck size={64} class="text-emerald-600" />
					<p class="text-2xl font-bold">{hasil.sudah_ada ? 'Sudah tercatat' : `${hasil.aksi === 'masuk' ? 'Tercatat HADIR' : 'Tercatat PULANG'} ${hasil.jam}`}</p>
					<p class="text-base text-gray-600">{hasil.message}</p>
					{#if hasil.masuk_valid === false}
						<p class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-base">Lokasi Anda di luar area proyek ({hasil.jarak_m} m). Leader akan memeriksa.</p>
					{/if}
					{#each hasil.peringatan as w}
						<p class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-base">⚠️ {w}. Leader akan memeriksa.</p>
					{/each}
					<button onclick={tutupSheet} class="mt-2 px-8 py-3 rounded-xl bg-gray-900 text-white text-lg font-semibold">Selesai</button>
				</div>

			{:else if tahap === 'gagal'}
				<div class="space-y-3">
					<p class="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-lg">{pesanAbsen}</p>
					{#if bisaUlangAbsen}
						<p class="text-sm text-gray-600">Foto dan lokasi Anda masih tersimpan — tidak perlu memotret ulang.</p>
						<button onclick={kirimPercobaan} class="w-full py-4 rounded-2xl bg-emerald-600 text-white text-xl font-bold">Kirim ulang</button>
						<button onclick={() => { lupakanPercobaan(); tahap = 'siap'; }} class="w-full py-3 rounded-2xl border border-gray-300 text-gray-700 text-base">Ambil foto baru</button>
					{:else}
						<button onclick={() => { lupakanPercobaan(); tahap = 'siap'; }} class="w-full py-4 rounded-2xl bg-emerald-600 text-white text-xl font-bold">Coba lagi</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

{#if catatanUntuk && pengCatatan}
	<CatatanKerjaSheet
		nama={catatanUntuk.nama}
		manpowerId={mode === 'pribadi' ? null : catatanUntuk.manpower_id}
		pengaturan={pengCatatan}
		{fotoMaxKb}
		onTutup={() => (catatanUntuk = null)}
		onGagalPerangkat={tanganiAlasanPerangkat}
	/>
{/if}

{#if pakaiBarangUntuk && pengPemakaian}
	<PakaiBarangSheet
		nama={pakaiBarangUntuk.nama}
		manpowerId={mode === 'pribadi' ? null : pakaiBarangUntuk.manpower_id}
		fotoWajib={pengPemakaian.foto_wajib}
		{fotoMaxKb}
		onTutup={() => (pakaiBarangUntuk = null)}
		onGagalPerangkat={tanganiAlasanPerangkat}
	/>
{/if}
