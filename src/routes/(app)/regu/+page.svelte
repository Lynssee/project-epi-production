<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import KioskProyekTab from '$lib/components/regu/KioskProyekTab.svelte';
	import GateFixKtpNik from '$lib/components/shared/GateFixKtpNik.svelte';
	import { identitasLengkap, type StatusIdentitas } from '$lib/shared/ktpStatus';
	import { absensiNormal, alasanAnomali } from '$lib/shared/kioskFlags';
	import { verifikasiMassal } from '$lib/services/kioskProyekLeader';
	// Regu Saya — layar Manpower Leader (posisi tertinggi di lapangan).
	// Dokumen: erp-epi-1/docs/rencana-manpower-leader.md
	//
	// Dua hal yang bisa dilakukan di sini:
	//   1. Absenkan anggota regu (absensi representatif);
	//   2. Verifikasi lapis 1 absensi regu.
	//
	// Gerbangnya BUKAN role semata — role tidak mengikat orang ke proyek tertentu.
	// Yang mengikat adalah kursi di projects.manpower_leader_id / _wakil_id, jadi
	// daftar proyek di sini datang dari kursi itu.

	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { IconArrowLeft, IconLoader2, IconCheck, IconX, IconUsers } from '@tabler/icons-svelte';
	import { authStore } from '$lib/stores/auth';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getProyekDipimpin,
		getAnggotaRegu,
		getAntrianVerifikasi,
		verifikasiAbsensi,
		absenkanAnggota,
		absenkanReguMassal,
		getStatusIdentitasRegu,
		getAntrianLembur,
		verifikasiLembur,
		bolehVerifikasi,
		nominasikanAnggota,
		getGayaKomunikasi,
		getKesiapanHariIni,
		simpanKesiapan,
		PERAN_LEADER,
		type ProyekDipimpin
	} from '$lib/services/manpowerLeader';
	import { findAbsensiToday } from '$lib/services/manpowerAbsensi';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { getManpowerSetting, loadManpowerSettings } from '$lib/services/manpowerSettings';
	import { statusButuhBukti } from '$lib/shared/absenReguMassal';
	import { TAG_NOMINASI, validasiNominasi } from '$lib/shared/leaderNominasi';
	import { tindakanDisarankan, validasiCheckin } from '$lib/shared/kesiapanKru';

	let loading = $state(true);
	let busyId = $state<number | null>(null);
	let tab = $state<'regu' | 'verifikasi' | 'lembur' | 'kesiapan' | 'kiosk'>('regu');
	let gayaMap = $state<Record<number, { profil: string; tip: string }>>({});

	let proyek = $state<ProyekDipimpin[]>([]);
	// PDP-25: status NIK/KTP anggota + dialog unggah (pintu di luar PA, supaya KTP terkumpul sebelum mengajukan).
	let identitasMap = $state<Record<number, StatusIdentitas>>({});
	let ktpDialog = $state<{ open: boolean; manpowerId: number; manpowerName: string }>({ open: false, manpowerId: 0, manpowerName: '' });
	const jumlahIdentitasBelum = $derived(
		anggota.filter((a: any) => identitasMap[Number(mpIdOf(a.manpower_id))] && !identitasLengkap(identitasMap[Number(mpIdOf(a.manpower_id))])).length
	);
	async function muatIdentitas() {
		identitasMap = await getStatusIdentitasRegu(anggota.map((a: any) => Number(mpIdOf(a.manpower_id))));
	}
	let selectedProjectId = $state<number | null>(null);
	let anggota = $state<any[]>([]);
	let absensiHariIni = $state<Record<number, any>>({}); // assignmentId → baris absensi
	let antrian = $state<any[]>([]);
	let antrianLembur = $state<any[]>([]);

	// Absensi butuh bukti: foto kamera + GPS. Keduanya divalidasi ulang di server
	// (/api/manpower-leader/absen-regu) — yang di sini hanya pengambilannya.
	let fileInput = $state<HTMLInputElement | null>(null);
	let pendingAbsen = $state<{ anggota: any; status: string } | null>(null);

	const hariIni = new Date().toLocaleDateString('sv-SE');

	// Fase 1.1 (Penajaman Pengajuan Anggaran v2, 18 Agu 2026): sebelumnya tanggal
	// absensi selalu hardcode hari ini, padahal API absen-regu sudah menerima tanggal
	// bebas sejak awal — jadi Leader tidak punya cara mengisi hari yang terlewat.
	// Batas mundur diatur admin (app_settings module=manpower), bukan hardcode.
	let tanggalDipilih = $state(hariIni);
	let maxBackfillHari = $state(7);
	const tanggalMin = $derived.by(() => {
		const d = new Date();
		d.setDate(d.getDate() - maxBackfillHari);
		return d.toLocaleDateString('sv-SE');
	});
	const isBackfill = $derived(tanggalDipilih !== hariIni);

	const manpowerId = $derived($authStore.manpowerId);
	const bisaAbsen = $derived(hasPermission($authStore.roleId, 'absensi_tim_lapangan'));
	const bisaVerifikasi = $derived(hasPermission($authStore.roleId, 'verifikasi_absensi_tim'));
	const proyekAktif = $derived(proyek.find((p) => p.id === selectedProjectId) || null);

	const mpIdOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

	// Verifikasi massal (Kiosk Proyek, Fase 2): baris anomali tampil dulu & wajib dilihat satu per satu;
	// baris normal boleh disetujui sekali tekan. Server menilai ulang — klien hanya mengirim id.
	let massalBusy = $state(false);
	const antrianTerurut = $derived([...antrian].sort((a, b) => Number(absensiNormal(a)) - Number(absensiNormal(b))));
	const normalIds = $derived(
		antrian.filter((r) => absensiNormal(r) && bolehVerifikasi(manpowerId, Number(mpIdOf(r.manpower_id)))).map((r) => r.id)
	);
	const jumlahAnomali = $derived(antrian.filter((r) => !absensiNormal(r)).length);

	async function setujuiMassal() {
		if (!selectedProjectId || !normalIds.length || massalBusy) return;
		if (!confirm(`Setujui ${normalIds.length} absensi normal (di dalam radius, tanpa penanda)?`)) return;
		massalBusy = true;
		try {
			const r = await verifikasiMassal(selectedProjectId, normalIds);
			if (r.dilewati.length) alert(`${r.disetujui} disetujui. ${r.dilewati.length} dilewati karena perlu diperiksa satu per satu.`);
			await muatProyek();
		} catch (e) {
			alert((e as Error).message || 'Gagal menyetujui massal');
		} finally {
			massalBusy = false;
		}
	}

	// ── PDP-24: Absen Regu massal ("Hadir Semua" lalu kecualikan) ─────────────────
	// Semua anggota yang belum diabsen dianggap hadir; leader mengubah yang tidak masuk. Satu foto regu + GPS
	// untuk seluruh yang hadir; server tetap mencatat SATU BARIS PER NAMA lewat inti absensi yang sama.
	let massalAktif = $state(true);
	let massalMin = $state(5);
	let massalOpen = $state(false);
	let massalStatus = $state<Record<number, string>>({}); // assignment_id -> status
	let massalFoto = $state<File | null>(null);
	let massalFotoUrl = $state<string | null>(null);
	let massalInput = $state<HTMLInputElement | null>(null);
	let absenMassalBusy = $state(false);
	let massalHasil = $state<{ manpower_id: number; ok: boolean; hasil: string; status: string; message: string }[] | null>(null);
	const STATUS_MASSAL_OPSI: [string, string][] = [
		['hadir', 'Hadir'],
		['setengah_hari', 'Setengah hari'],
		['izin', 'Izin'],
		['sakit', 'Sakit'],
		['alpha', 'Alpha']
	];
	// Anggota yang BELUM punya absensi di tanggal terpilih dan bukan leader sendiri.
	const massalKandidat = $derived(
		anggota.filter((a: any) => !absensiHariIni[a.id] && Number(mpIdOf(a.manpower_id)) !== Number(manpowerId))
	);
	const massalRingkas = $derived.by(() => {
		const per: Record<string, number> = {};
		for (const a of massalKandidat) {
			const st = massalStatus[a.id] || 'hadir';
			per[st] = (per[st] || 0) + 1;
		}
		return per;
	});
	const massalAdaHadir = $derived(Object.keys(massalRingkas).some((s) => statusButuhBukti(s)));

	function bukaMassal() {
		const m: Record<number, string> = {};
		for (const a of massalKandidat) m[a.id] = 'hadir';
		massalStatus = m;
		massalFoto = null;
		if (massalFotoUrl) URL.revokeObjectURL(massalFotoUrl);
		massalFotoUrl = null;
		massalHasil = null;
		massalOpen = true;
	}

	function tutupMassal() {
		massalOpen = false;
		massalHasil = null;
		if (massalFotoUrl) URL.revokeObjectURL(massalFotoUrl);
		massalFotoUrl = null;
		massalFoto = null;
	}

	// PENTING (Aturan #5): kamera dibuka LANGSUNG dari klik — tidak ada await sebelum .click().
	function ambilFotoRegu() {
		if (massalInput) {
			massalInput.value = '';
			massalInput.click();
		}
	}

	function onFotoReguDipilih(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0] || null;
		if (!file) return;
		massalFoto = file;
		if (massalFotoUrl) URL.revokeObjectURL(massalFotoUrl);
		massalFotoUrl = URL.createObjectURL(file);
	}

	async function kirimMassal() {
		if (!selectedProjectId || absenMassalBusy || massalKandidat.length === 0) return;
		if (massalAdaHadir && !massalFoto) {
			alert('Ambil foto regu dulu. Foto harus memperlihatkan seluruh regu yang hadir di lokasi kerja.');
			return;
		}
		absenMassalBusy = true;
		try {
			let pos: { lat: number; lng: number; accuracy: number } | null = null;
			if (massalAdaHadir) {
				try {
					pos = await getCurrentPosition(); // GPS diambil SEKALI untuk seluruh regu
				} catch (err: any) {
					alert(`Lokasi tidak bisa diambil: ${err?.message || err}\n\nAbsensi dibatalkan — bukti GPS wajib untuk yang hadir.`);
					return;
				}
			}
			const res = await absenkanReguMassal({
				projectId: selectedProjectId,
				tanggal: tanggalDipilih,
				entries: massalKandidat.map((a: any) => ({
					assignment_id: a.id,
					manpower_id: Number(mpIdOf(a.manpower_id)),
					status: massalStatus[a.id] || 'hadir'
				})),
				lat: pos?.lat ?? null,
				lng: pos?.lng ?? null,
				accuracy: pos?.accuracy ?? null,
				photoFile: massalAdaHadir ? massalFoto : null
			});
			if (!res.success) {
				alert(res.error || 'Gagal menyimpan absensi regu');
				return;
			}
			massalHasil = res.hasil || [];
			await muatProyek(); // yang berhasil keluar dari daftar kandidat; yang gagal tetap bisa dikirim ulang
			if ((res.ringkasan?.gagal ?? 0) === 0) tutupMassal();
		} finally {
			absenMassalBusy = false;
		}
	}

	const namaAnggota = (mid: number) => {
		const a = anggota.find((x: any) => Number(mpIdOf(x.manpower_id)) === Number(mid));
		return a?.manpower_id?.nama || `#${mid}`;
	};

	onMount(async () => {
		loadManpowerSettings()
			.then((m) => {
				massalAktif = m['manpower.absen_regu_massal.aktif'] !== false;
				massalMin = Number(m['manpower.absen_regu_massal.min_anggota']) || 5;
			})
			.catch((e) => console.warn('[regu] gagal memuat setelan absen massal (pakai default):', e));
		getManpowerSetting('backfill_absensi_max_hari').then((v) => (maxBackfillHari = v)).catch(() => {});
		if (!manpowerId) { loading = false; return; }
		proyek = await getProyekDipimpin(manpowerId);
		if (proyek.length > 0) {
			// Deep link dari Gate Absensi (G12): /regu?project=<id>&tanggal=<yyyy-mm-dd> —
			// dibangun oleh pesan gate di erp-epi-1/gateAbsensi.js, arahkan Leader langsung
			// ke proyek+tanggal yang bolong tanpa perlu cari manual.
			const qProject = Number($page.url.searchParams.get('project'));
			const qTanggal = $page.url.searchParams.get('tanggal');
			const cocok = qProject && proyek.find((p) => p.id === qProject);
			selectedProjectId = cocok ? qProject : proyek[0].id;
			if (qTanggal && /^\d{4}-\d{2}-\d{2}$/.test(qTanggal)) tanggalDipilih = qTanggal;
			await muatProyek();
		}
		loading = false;
	});

	async function muatProyek() {
		if (!selectedProjectId) { anggota = []; antrian = []; return; }
		loading = true;
		try {
			anggota = await getAnggotaRegu(selectedProjectId);
			muatIdentitas(); // tidak di-await: lencana menyusul, tidak menahan layar
			antrian = await getAntrianVerifikasi(selectedProjectId);
			antrianLembur = await getAntrianLembur(selectedProjectId);
			// tip gaya komunikasi (DISC) — tidak memblokir tampilan regu bila gagal
			getGayaKomunikasi(selectedProjectId).then((m) => (gayaMap = m));

			// Status absen per anggota UNTUK TANGGAL TERPILIH (bisa backfill, Fase 1.1)
			// — bukan selalu hari ini lagi. Nama variabel dipertahankan, isinya per-tanggal.
			const peta: Record<number, any> = {};
			await Promise.all(
				anggota.map(async (a: any) => {
					const row = await findAbsensiToday(a.id, tanggalDipilih);
					if (row) peta[a.id] = row;
				})
			);
			absensiHariIni = peta;
		} finally {
			loading = false;
		}
	}

	/**
	 * Mulai absensi: minta foto kamera. GPS diambil setelah foto dipilih.
	 * Absensi ini memposting biaya, jadi bukti foto+GPS WAJIB — sama seperti
	 * jalur absensi ERP. Verdict geofence dihitung server, bukan di sini.
	 */
	function mulaiAbsen(a: any, status: 'hadir' | 'setengah_hari' | 'izin' | 'sakit' | 'alpha') {
		if (!manpowerId || !selectedProjectId) return;
		const targetId = mpIdOf(a.manpower_id);

		// Leader mengabsenkan dirinya sendiri tetap lewat ESS (absen mandiri),
		// supaya jejaknya tidak jadi "dicatat leader" oleh dirinya sendiri.
		if (Number(targetId) === Number(manpowerId)) {
			alert('Absensi Anda sendiri lewat menu Absensi Mandiri (ESS), bukan dari sini.');
			return;
		}

		const nama = a.manpower_id?.nama || `#${targetId}`;
		// Bukti hanya untuk status yang berbiaya. Untuk izin/sakit/alpha orangnya
		// tidak ada di lokasi — tidak ada yang difoto, dan biayanya nol.
		const butuhBukti = status === 'hadir' || status === 'setengah_hari';

		const labelTanggal = isBackfill ? `tanggal ${tanggalDipilih} (susulan)` : 'hari ini';
		const pesan = butuhBukti
			? `Catat ${nama} sebagai "${status}" untuk ${labelTanggal}?\n\nAnda akan diminta foto bukti + lokasi. Tercatat atas nama Anda dan masuk antrean verifikasi.`
			: `Catat ${nama} sebagai "${status}" untuk ${labelTanggal}?\n\nTercatat atas nama Anda dan masuk antrean verifikasi.`;
		if (!confirm(pesan)) return;

		pendingAbsen = { anggota: a, status };

		if (!butuhBukti) {
			kirimAbsen(null);
			return;
		}
		if (fileInput) {
			fileInput.value = '';
			fileInput.click();
		}
	}

	function onFotoDipilih(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0] || null;
		if (!file) { pendingAbsen = null; return; }
		kirimAbsen(file);
	}

	/** @param file null untuk status tanpa biaya (izin/sakit/alpha) — tidak butuh bukti. */
	async function kirimAbsen(file: File | null) {
		if (!pendingAbsen || !manpowerId || !selectedProjectId) {
			pendingAbsen = null;
			return;
		}

		const { anggota: a, status } = pendingAbsen;
		pendingAbsen = null;
		busyId = a.id;
		try {
			let pos: { lat: number; lng: number; accuracy: number } | null = null;
			if (file) {
				try {
					pos = await getCurrentPosition();
				} catch (err: any) {
					alert(`Lokasi tidak bisa diambil: ${err?.message || err}\n\nAbsensi dibatalkan — bukti GPS wajib untuk status berbiaya.`);
					return;
				}
			}

			const res = await absenkanAnggota({
				projectId: selectedProjectId,
				assignmentId: a.id,
				manpowerId: mpIdOf(a.manpower_id),
				status,
				tanggal: tanggalDipilih,
				lat: pos?.lat ?? null,
				lng: pos?.lng ?? null,
				accuracy: pos?.accuracy ?? null,
				photoFile: file
			});

			if (res.success) {
				if (res.masuk_valid === false) alert(res.message);
				await muatProyek();
			} else {
				alert(res.error || 'Gagal menyimpan absensi');
			}
		} finally {
			busyId = null;
		}
	}

	async function putuskanLembur(row: any, setuju: boolean) {
		if (!manpowerId) return;
		let catatan = '';
		if (!setuju) {
			catatan = prompt('Alasan penolakan lembur:') || '';
			if (!catatan.trim()) return;
		}
		busyId = row.id;
		try {
			const res = await verifikasiLembur({
				requestId: row.id,
				verifikatorManpowerId: manpowerId,
				setuju,
				catatan
			});
			if (res.success) await muatProyek();
			else alert(res.error || 'Gagal menyimpan verifikasi lembur');
		} finally {
			busyId = null;
		}
	}

	async function putuskan(row: any, setuju: boolean) {
		if (!manpowerId) return;
		let catatan = '';
		if (!setuju) {
			catatan = prompt('Alasan penolakan:') || '';
			if (!catatan.trim()) return;
		}
		busyId = row.id;
		try {
			const res = await verifikasiAbsensi({
				absensiId: row.id,
				verifikatorManpowerId: manpowerId,
				setuju,
				catatan
			});
			if (res.success) await muatProyek();
			else alert(res.error || 'Gagal menyimpan verifikasi');
		} finally {
			busyId = null;
		}
	}

	// ── Check-in kesiapan kru (toolbox meeting) ───────────────────────────────
	type Kond = 'fit' | 'kurang' | 'tidak';
	type CK = { kondisi_fisik: Kond; kondisi_mental: Kond; tidur_cukup: boolean; tindakan: '' | 'lanjut' | 'ringan' | 'istirahat'; catatan: string };
	let ck = $state<Record<number, CK>>({});
	let ckSudah = $state(false);
	let ckBusy = $state(false);
	const LABEL_TINDAKAN: Record<string, string> = {
		lanjut: 'Lanjut kerja',
		ringan: 'Tugas ringan / dipantau',
		istirahat: 'Istirahat, jangan kerja berisiko'
	};
	const OPSI_FISIK: [Kond, string][] = [['fit', 'Fit'], ['kurang', 'Kurang fit'], ['tidak', 'Tidak fit']];
	const OPSI_MENTAL: [Kond, string][] = [['fit', 'Fokus'], ['kurang', 'Kurang fokus'], ['tidak', 'Tidak fokus']];
	const warnaKond = (aktif: boolean, v: Kond) =>
		aktif
			? v === 'fit' ? 'bg-emerald-600 text-white border-emerald-600' : v === 'kurang' ? 'bg-amber-500 text-white border-amber-500' : 'bg-red-600 text-white border-red-600'
			: 'bg-white text-gray-600';

	async function bukaKesiapan() {
		tab = 'kesiapan';
		if (!selectedProjectId) return;
		const ada = await getKesiapanHariIni(selectedProjectId);
		ckSudah = ada.length > 0;
		const peta: Record<number, CK> = {};
		for (const a of anggota) {
			const mid = Number(mpIdOf(a.manpower_id));
			const e = ada.find((x: any) => Number(x.manpower_id) === mid);
			peta[mid] = e
				? { kondisi_fisik: e.kondisi_fisik, kondisi_mental: e.kondisi_mental, tidur_cukup: e.tidur_cukup !== false, tindakan: e.tindakan, catatan: e.catatan || '' }
				: { kondisi_fisik: 'fit', kondisi_mental: 'fit', tidur_cukup: true, tindakan: '', catatan: '' };
		}
		ck = peta;
	}

	const saran = (c: CK) => tindakanDisarankan(c);
	const tindakanEfektif = (c: CK) => c.tindakan || saran(c);
	const jumlahBerisiko = $derived(Object.values(ck).filter((c) => tindakanEfektif(c) !== 'lanjut').length);

	async function kirimKesiapan() {
		if (!selectedProjectId) return;
		const items = Object.entries(ck).map(([mid, c]) => ({ manpower_id: Number(mid), ...c, tindakan: tindakanEfektif(c) }));
		for (const it of items) {
			const salah = validasiCheckin(it);
			if (salah) { alert(salah); return; }
		}
		ckBusy = true;
		try {
			const r = await simpanKesiapan(selectedProjectId, items);
			if (r.success) { ckSudah = true; alert(`Check-in kesiapan tersimpan (${items.length} orang).`); }
			else alert(r.error || 'Gagal menyimpan check-in');
		} finally {
			ckBusy = false;
		}
	}

	// ── Nominasi calon leader (Fase 4 Kaderisasi) ──────────────────────────────
	let nominasiTarget = $state<any | null>(null);
	let nomRating = $state(0);
	let nomTags = $state<string[]>([]);
	let nomCatatan = $state('');
	let nomBusy = $state(false);

	function bukaNominasi(a: any) {
		nominasiTarget = a;
		nomRating = 0;
		nomTags = [];
		nomCatatan = '';
	}

	function toggleTag(k: string) {
		nomTags = nomTags.includes(k) ? nomTags.filter((t) => t !== k) : [...nomTags, k];
	}

	async function kirimNominasi() {
		if (!nominasiTarget || !selectedProjectId) return;
		const salah = validasiNominasi({ rating: nomRating, tags: nomTags, catatan: nomCatatan });
		if (salah) { alert(salah); return; }
		nomBusy = true;
		try {
			const res = await nominasikanAnggota({
				projectId: selectedProjectId,
				nomineeManpowerId: Number(mpIdOf(nominasiTarget.manpower_id)),
				rating: nomRating,
				tags: nomTags,
				catatan: nomCatatan
			});
			if (res.success) {
				alert('Nominasi terkirim. HRD akan me-review sebelum masuk penilaian kaderisasi.');
				nominasiTarget = null;
			} else {
				alert(res.error || 'Gagal mengirim nominasi');
			}
		} finally {
			nomBusy = false;
		}
	}
</script>

<input
	type="file"
	accept="image/*"
	capture="environment"
	bind:this={fileInput}
	onchange={onFotoDipilih}
	class="hidden"
/>

<input
	type="file"
	accept="image/*"
	capture="environment"
	bind:this={massalInput}
	onchange={onFotoReguDipilih}
	class="hidden"
/>

<div class="p-4 max-w-3xl mx-auto">
	<button onclick={() => goto('/')} class="flex items-center gap-1 text-sm text-gray-500 mb-3">
		<IconArrowLeft size={16} /> Kembali
	</button>

	<h1 class="text-xl font-bold flex items-center gap-2 mb-1">
		<IconUsers size={22} /> Regu Saya
	</h1>
	<p class="text-sm text-gray-500 mb-4">
		Koordinasi lapangan saat Project Leader tidak di lokasi.
	</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat penugasan regu lapangan..." />
		</div>
	{:else if !manpowerId}
		<div class="p-4 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
			Akun ini belum terhubung ke data manpower mana pun. Minta HRD mengisi
			<strong>Email akun</strong> pada data manpower Anda.
		</div>
	{:else if proyek.length === 0}
		<div class="p-4 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-600">
			Anda belum ditetapkan sebagai Manpower Leader atau Wakil di proyek mana pun.
		</div>
	{:else}
		<!-- Pemilih proyek -->
		<select
			bind:value={selectedProjectId}
			onchange={muatProyek}
			class="w-full mb-3 px-3 py-2 border border-gray-300 rounded-lg text-sm"
		>
			{#each proyek as p (p.id)}
				<option value={p.id}>{p.name} — {p.peran === PERAN_LEADER ? 'Leader' : 'Wakil'}</option>
			{/each}
		</select>

		{#if proyekAktif}
			<div class="mb-3 text-xs text-gray-500">
				{proyekAktif.lokasi || '-'} · Anda: <strong>{proyekAktif.peran === PERAN_LEADER ? 'Manpower Leader' : 'Wakil Leader'}</strong>
			</div>
		{/if}

		<!-- Fase 1.1: pemilih tanggal — mengisi absensi yang terlewat (backfill) -->
		<div class="mb-3">
			<label class="block text-xs text-gray-500 mb-1">Tanggal absensi</label>
			<input
				type="date"
				bind:value={tanggalDipilih}
				min={tanggalMin}
				max={hariIni}
				onchange={muatProyek}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
			/>
			{#if isBackfill}
				<p class="mt-1 text-[11px] text-amber-600">
					Mengisi absensi susulan untuk {tanggalDipilih} (maks. mundur {maxBackfillHari} hari) — tercatat sebagai backfill.
				</p>
			{/if}
		</div>

		<div class="flex gap-2 mb-4 border-b border-gray-200">
			<button
				onclick={() => (tab = 'regu')}
				class="px-3 py-2 text-sm font-semibold border-b-2 {tab === 'regu' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500'}"
			>Anggota ({anggota.length})</button>
			<button
				onclick={() => (tab = 'verifikasi')}
				class="px-3 py-2 text-sm font-semibold border-b-2 {tab === 'verifikasi' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500'}"
			>Verifikasi ({antrian.length})</button>
			<button
				onclick={() => (tab = 'lembur')}
				class="px-3 py-2 text-sm font-semibold border-b-2 {tab === 'lembur' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500'}"
			>Lembur ({antrianLembur.length})</button>
			<button
				onclick={bukaKesiapan}
				class="px-3 py-2 text-sm font-semibold border-b-2 {tab === 'kesiapan' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500'}"
			>Kesiapan</button>
			<button
				onclick={() => (tab = 'kiosk')}
				title="Aktifkan HP/tablet kiosk agar kru bisa absen sendiri"
				class="px-3 py-2 text-sm font-semibold border-b-2 {tab === 'kiosk' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500'}"
			>Kiosk</button>
		</div>

		{#if tab === 'regu'}
			{#if !bisaAbsen}
				<div class="p-3 mb-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
					Anda tidak punya izin mengabsenkan anggota regu — daftar di bawah hanya untuk dilihat.
				</div>
			{/if}
			{#if anggota.length === 0}
				<p class="text-sm text-gray-500 py-8 text-center">Belum ada penugasan aktif di proyek ini.</p>
			{:else}
				{#if jumlahIdentitasBelum > 0}
					<div class="mb-3 p-2.5 rounded-lg border border-amber-300 bg-amber-50 text-[11px] text-amber-900">
						🪪 <b>{jumlahIdentitasBelum} anggota</b> belum punya NIK + KTP terverifikasi. Unggah foto KTP dan isi NIK dari sini <b>sebelum</b> mengajukan upah supaya tidak tertahan di cek kelengkapan. HRD akan memverifikasi.
					</div>
				{/if}
				{#if bisaAbsen && massalAktif && !massalOpen && massalKandidat.length >= massalMin}
					<div class="mb-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50/60">
						<button
							onclick={bukaMassal}
							class="w-full py-2.5 text-sm font-bold rounded-lg bg-emerald-600 text-white"
							title="Anggap semua anggota yang belum diabsen hadir, ubah yang tidak masuk, lalu cukup satu foto regu."
						>✅ Hadir Semua ({massalKandidat.length} orang) — absen sekaligus</button>
						<p class="mt-1.5 text-[11px] text-emerald-800">
							Regu besar? Satu foto + satu lokasi untuk semua yang hadir. Tiap nama tetap tercatat dan masuk antrean verifikasi.
						</p>
					</div>
				{/if}

				{#if massalOpen}
					<div class="mb-3 p-3 rounded-lg border-2 border-emerald-300 bg-white space-y-3">
						<div class="flex items-center justify-between">
							<div class="font-bold text-sm">Absen Regu — {isBackfill ? tanggalDipilih + ' (susulan)' : 'hari ini'}</div>
							<button onclick={tutupMassal} class="text-xs text-gray-500 underline" disabled={absenMassalBusy}>Batal</button>
						</div>
						<p class="text-[11px] text-gray-600">
							<b>Langkah:</b> (1) semua dianggap <b>Hadir</b> — ubah yang tidak masuk; (2) ambil <b>satu foto regu</b> yang memperlihatkan seluruh yang hadir di lokasi kerja;
							(3) tekan <b>Kirim</b>. Lokasi (GPS) diambil otomatis sekali. Anggota yang sudah diabsen tidak ikut di sini.
						</p>

						<div class="space-y-1.5 max-h-80 overflow-y-auto">
							{#each massalKandidat as a (a.id)}
								<div class="flex items-center justify-between gap-2 p-2 rounded border border-gray-200">
									<span class="text-sm truncate">{a.manpower_id?.nama || `#${mpIdOf(a.manpower_id)}`}</span>
									<select
										bind:value={massalStatus[a.id]}
										disabled={absenMassalBusy}
										class="text-xs border rounded px-1.5 py-1 {(massalStatus[a.id] || 'hadir') === 'hadir' ? 'border-emerald-300 bg-emerald-50' : 'border-amber-400 bg-amber-50'}"
									>
										{#each STATUS_MASSAL_OPSI as [val, label]}
											<option value={val}>{label}</option>
										{/each}
									</select>
								</div>
							{/each}
						</div>

						{#if massalAdaHadir}
							<div class="flex items-center gap-3">
								<button
									onclick={ambilFotoRegu}
									disabled={absenMassalBusy}
									class="px-3 py-2 text-sm font-semibold rounded-lg border border-emerald-600 text-emerald-700 disabled:opacity-50"
								>📷 {massalFoto ? 'Ganti Foto Regu' : 'Ambil Foto Regu'}</button>
								{#if massalFotoUrl}
									<img src={massalFotoUrl} alt="Foto regu" class="h-14 w-14 object-cover rounded border" />
								{/if}
							</div>
						{/if}

						<div class="text-xs font-semibold text-gray-700">
							Ringkasan:
							{#each Object.entries(massalRingkas) as [st, n], i}{i > 0 ? ', ' : ' '}{n} {st.replace('_', ' ')}{/each}
							{#if massalAdaHadir} — 1 foto regu + lokasi{/if}
						</div>

						<button
							onclick={kirimMassal}
							disabled={absenMassalBusy || massalKandidat.length === 0 || (massalAdaHadir && !massalFoto)}
							class="w-full py-2.5 text-sm font-bold rounded-lg bg-emerald-600 text-white disabled:opacity-50 flex items-center justify-center gap-2"
						>
							{#if absenMassalBusy}<IconLoader2 size={16} class="animate-spin" /> Mengirim…{:else}Kirim Absen Regu{/if}
						</button>

						{#if massalHasil}
							{@const gagalList = massalHasil.filter((h) => !h.ok)}
							<div class="text-xs">
								<div class="font-semibold {gagalList.length ? 'text-red-700' : 'text-emerald-700'}">
									{massalHasil.length - gagalList.length} berhasil{gagalList.length ? `, ${gagalList.length} gagal` : ''}
								</div>
								{#if gagalList.length}
									<ul class="mt-1 space-y-1">
										{#each gagalList as h}
											<li class="p-1.5 rounded bg-red-50 text-red-800"><b>{namaAnggota(h.manpower_id)}</b>: {h.message}</li>
										{/each}
									</ul>
									<p class="mt-1 text-gray-600">Yang berhasil sudah tersimpan. Perbaiki penyebabnya lalu tekan Kirim lagi — hanya yang gagal yang diulang.</p>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<div class="space-y-2">
					{#each anggota as a (a.id)}
						{@const sudah = absensiHariIni[a.id]}
						{@const diriSendiri = Number(mpIdOf(a.manpower_id)) === Number(manpowerId)}
						<div class="p-3 rounded-lg border {sudah ? 'border-emerald-200 bg-emerald-50/40' : 'border-gray-200 bg-white'}">
							<div class="flex items-center justify-between gap-2">
								<div class="min-w-0">
									<div class="font-semibold text-sm truncate">
										{a.manpower_id?.nama || `#${mpIdOf(a.manpower_id)}`}
										{#if a.peran_lapangan === PERAN_LEADER}
											<span class="ml-1 text-[10px] font-bold text-emerald-700">🦺 Leader</span>
										{/if}
									</div>
									<div class="text-xs text-gray-500 truncate">{a.jabatan || a.manpower_id?.posisi || '-'}</div>
									{#if identitasMap[Number(mpIdOf(a.manpower_id))]}
										{@const idt = identitasMap[Number(mpIdOf(a.manpower_id))]}
										<div class="mt-1 flex flex-wrap items-center gap-1.5">
											{#if identitasLengkap(idt)}
												<span class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-emerald-100 text-emerald-700" title="NIK valid dan KTP sudah diverifikasi HRD">🪪 KTP ✓</span>
											{:else}
												<span class="px-1.5 py-0.5 text-[10px] font-bold rounded {idt.ktp === 'menunggu' && idt.nik === 'valid' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}"
													title="Gate identitas butuh NIK 16 digit + foto KTP terverifikasi HRD. Tanpa itu pengajuan upah bisa tertahan.">
													🪪 {idt.ktp === 'menunggu' && idt.nik === 'valid' ? 'KTP menunggu HRD' : idt.ktp === 'ditolak' ? 'KTP ditolak — unggah ulang' : idt.nik !== 'valid' ? 'NIK/KTP belum lengkap' : 'KTP belum ada'}
												</span>
																{#if idt.ktp === 'ditolak' && idt.alasanTolak}
													<span class="basis-full text-[10px] text-red-700">Alasan HRD: {idt.alasanTolak}</span>
												{/if}
								{#if bisaAbsen && !(idt.ktp === 'menunggu' && idt.nik === 'valid')}
													<button
														onclick={() => (ktpDialog = { open: true, manpowerId: Number(mpIdOf(a.manpower_id)), manpowerName: a.manpower_id?.nama || '' })}
														class="px-1.5 py-0.5 text-[10px] font-semibold rounded border border-blue-300 text-blue-700"
													>Unggah KTP + NIK</button>
												{/if}
											{/if}
										</div>
									{/if}
										{#if gayaMap[Number(mpIdOf(a.manpower_id))]}
											{@const g = gayaMap[Number(mpIdOf(a.manpower_id))]}
											<div class="mt-1 text-[10px] text-indigo-700 bg-indigo-50 rounded px-1.5 py-1" title="Berdasarkan tes gaya kerja DISC. Hanya panduan komunikasi, bukan penilaian pribadi.">
												💬 Gaya kerja <b>{g.profil}</b>: {g.tip}
											</div>
										{/if}
										<!-- Emergency Medical Badge: golongan darah + alergi + telepon kontak darurat (K3) -->
										<div class="mt-1 flex flex-wrap items-center gap-1.5">
											<span
												class="px-1.5 py-0.5 text-[10px] font-bold rounded {a.manpower_id?.golongan_darah ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400'}"
												title="Golongan darah untuk keselamatan kerja / transfusi darurat. Kosong = belum diisi, minta HRD melengkapi."
											>🩸 {a.manpower_id?.golongan_darah || 'Gol. darah ?'}</span>
											{#if a.manpower_id?.riwayat_alergi}
												<span class="px-1.5 py-0.5 text-[10px] rounded bg-amber-100 text-amber-800" title="Alergi: {a.manpower_id.riwayat_alergi}">⚠️ Alergi</span>
											{/if}
											{#if a.manpower_id?.kontak_darurat_telp}
												<a
													href="tel:+62{String(a.manpower_id.kontak_darurat_telp).replace(/\D/g, '').replace(/^(62|0)/, '')}"
													class="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-emerald-100 text-emerald-800"
													title="Hubungi kontak darurat{a.manpower_id.nama_kontak_darurat ? ': ' + a.manpower_id.nama_kontak_darurat : ''} — hanya saat darurat"
												>📞 Kontak darurat</a>
											{/if}
										</div>
								</div>
								{#if sudah}
									<span class="shrink-0 text-xs font-semibold text-emerald-700">✓ {sudah.status}</span>
								{/if}
							</div>

							{#if bisaAbsen && !sudah && !diriSendiri}
								<div class="flex flex-wrap gap-1.5 mt-2">
									{#each ['hadir', 'setengah_hari', 'izin', 'sakit', 'alpha'] as st}
										<button
											onclick={() => mulaiAbsen(a, st as any)}
											disabled={busyId === a.id}
											class="px-2 py-1 text-xs font-semibold rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
										>{st.replace('_', ' ')}</button>
									{/each}
								</div>
							{:else if diriSendiri}
								<p class="mt-2 text-[11px] text-gray-400">
									Absensi Anda sendiri lewat menu Absensi Mandiri (ESS).
								</p>
							{/if}
							{#if !diriSendiri}
								<button
									onclick={() => bukaNominasi(a)}
									class="mt-2 text-[11px] font-semibold text-indigo-600 underline"
									title="Rekomendasikan anggota ini sebagai calon leader regu. HRD akan me-review sebelum dihitung."
								>⭐ Nominasikan jadi calon leader</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{:else if tab === 'kiosk'}
			{#if selectedProjectId}
				{#key selectedProjectId}
					<KioskProyekTab projectId={selectedProjectId} projectName={proyek.find((p) => Number(p.id) === Number(selectedProjectId))?.name ?? ''} />
				{/key}
			{/if}
		{:else if tab === 'kesiapan'}
			<div class="space-y-3">
				<p class="text-xs text-gray-600">
					Dipakai saat toolbox meeting sebelum kerja. Langkah: (1) tanya kondisi tiap orang, (2) semua sudah terisi <b>Fit</b> secara default — ubah hanya yang bermasalah, (3) tekan Simpan. Hanya berlaku untuk hari ini.
				</p>
				{#if ckSudah}<p class="text-[11px] text-emerald-700 font-semibold">✓ Check-in hari ini sudah tersimpan — menyimpan lagi akan memperbarui.</p>{/if}
				{#each anggota as a (a.id)}
					{@const mid = Number(mpIdOf(a.manpower_id))}
					{@const c = ck[mid]}
					{#if c}
						<div class="p-3 rounded-lg border {tindakanEfektif(c) === 'lanjut' ? 'border-gray-200' : 'border-amber-300 bg-amber-50/50'}">
							<div class="text-sm font-semibold truncate mb-2">{a.manpower_id?.nama || `#${mid}`}</div>
							<div class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 items-center text-[11px]">
								<span class="text-gray-500">Fisik</span>
								<div class="flex gap-1">
									{#each OPSI_FISIK as [v, l]}
										<button type="button" onclick={() => (c.kondisi_fisik = v)} class="px-2 py-1 rounded border {warnaKond(c.kondisi_fisik === v, v)}">{l}</button>
									{/each}
								</div>
								<span class="text-gray-500">Mental</span>
								<div class="flex gap-1">
									{#each OPSI_MENTAL as [v, l]}
										<button type="button" onclick={() => (c.kondisi_mental = v)} class="px-2 py-1 rounded border {warnaKond(c.kondisi_mental === v, v)}">{l}</button>
									{/each}
								</div>
								<span class="text-gray-500">Tidur</span>
								<label class="flex items-center gap-1"><input type="checkbox" bind:checked={c.tidur_cukup} /> Tidur cukup (≥ 6 jam)</label>
							</div>
							{#if tindakanEfektif(c) !== 'lanjut'}
								<div class="mt-2 space-y-1">
									<select class="w-full px-2 py-1 border border-gray-300 rounded text-xs" bind:value={c.tindakan}>
										<option value="">Saran sistem: {LABEL_TINDAKAN[saran(c)]}</option>
										{#each Object.entries(LABEL_TINDAKAN) as [k, l]}<option value={k}>{l}</option>{/each}
									</select>
									<input class="w-full px-2 py-1 border border-gray-300 rounded text-xs" maxlength="300" placeholder="Catatan (mis. demam, kurang tidur karena lembur)" bind:value={c.catatan} />
								</div>
							{/if}
						</div>
					{/if}
				{:else}
					<p class="text-sm text-gray-500 py-6 text-center">Belum ada anggota aktif di proyek ini.</p>
				{/each}
				<div class="sticky bottom-0 bg-white pt-2 pb-1 border-t border-gray-100">
					{#if jumlahBerisiko > 0}<p class="text-[11px] text-amber-700 mb-1">⚠️ {jumlahBerisiko} orang perlu perhatian — jangan beri pekerjaan berisiko tinggi.</p>{/if}
					<button type="button" onclick={kirimKesiapan} disabled={ckBusy || anggota.length === 0} class="w-full py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">{ckBusy ? 'Menyimpan…' : 'Simpan check-in kesiapan'}</button>
				</div>
			</div>
		{:else if tab === 'verifikasi'}
			{#if !bisaVerifikasi}
				<div class="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
					Anda tidak punya izin verifikasi absensi regu.
				</div>
			{:else if antrian.length === 0}
				<p class="text-sm text-gray-500 py-8 text-center">Tidak ada absensi yang menunggu verifikasi.</p>
			{:else}
				{#if normalIds.length > 0}
					<div class="p-3 mb-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2">
						<p class="text-xs text-emerald-900"><b>{normalIds.length}</b> absensi normal (di dalam radius, tanpa penanda){#if jumlahAnomali > 0} · <b class="text-amber-700">{jumlahAnomali} perlu diperiksa</b> (di atas){/if}</p>
						<button onclick={setujuiMassal} disabled={massalBusy} class="shrink-0 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50" title="Setujui semua absensi yang normal sekaligus. Yang anomali tidak ikut.">{massalBusy ? 'Memproses…' : 'Setujui semua normal'}</button>
					</div>
				{/if}
				<div class="space-y-2">
					{#each antrianTerurut as row (row.id)}
						{@const bolehPutuskan = bolehVerifikasi(manpowerId, Number(mpIdOf(row.manpower_id)))}
						{@const anomali = alasanAnomali(row)}
						<div class="p-3 rounded-lg border bg-white {anomali.length ? 'border-amber-300' : 'border-gray-200'}">
							<div class="flex items-center justify-between gap-2">
								<div class="min-w-0">
									<div class="font-semibold text-sm truncate">{row.manpower_id?.nama || `#${mpIdOf(row.manpower_id)}`}</div>
									<div class="text-xs text-gray-500">
										{row.tanggal} · {row.status}
										{#if row.jam_kerja} · {row.jam_kerja} jam{/if}
										{#if row.metode_catat === 'leader'} · dicatat leader{:else if row.metode_catat === 'kiosk_rekan'} · via kiosk bersama{:else if row.metode_catat === 'kiosk_mandiri'} · via HP sendiri{/if}
									</div>
									{#if anomali.length}
										<ul class="mt-1 text-[11px] text-amber-700 list-disc pl-4">{#each anomali as a}<li>{a}</li>{/each}</ul>
									{/if}
								</div>
								{#if row.dikunci}
									<span class="shrink-0 text-[11px] font-semibold text-gray-400">Terkunci</span>
								{:else if !bolehPutuskan}
									<span class="shrink-0 text-[11px] text-gray-400">Absensi Anda</span>
								{:else}
									<div class="shrink-0 flex gap-1">
										<button
											onclick={() => putuskan(row, true)}
											disabled={busyId === row.id}
											class="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
											title="Setujui"><IconCheck size={18} /></button>
										<button
											onclick={() => putuskan(row, false)}
											disabled={busyId === row.id}
											class="p-1.5 rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
											title="Tolak"><IconX size={18} /></button>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			<!-- Lembur: lapis 1 saja. Keputusan akhir tetap HRD lewat overtime_request.status. -->
			{#if !bisaVerifikasi}
				<div class="p-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600">
					Anda tidak punya izin verifikasi lembur regu.
				</div>
			{:else if antrianLembur.length === 0}
				<p class="text-sm text-gray-500 py-8 text-center">Tidak ada pengajuan lembur yang menunggu.</p>
			{:else}
				<div class="p-3 mb-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-900">
					Ini saringan lapangan. Keputusan akhir tetap di HRD — persetujuan Anda tidak
					langsung mengesahkan pembayaran lembur.
				</div>
				<div class="space-y-2">
					{#each antrianLembur as row (row.id)}
						{@const bolehPutuskan = bolehVerifikasi(manpowerId, Number(mpIdOf(row.manpower_id)))}
						<div class="p-3 rounded-lg border border-gray-200 bg-white">
							<div class="flex items-center justify-between gap-2">
								<div class="min-w-0">
									<div class="font-semibold text-sm truncate">{row.manpower_id?.nama || `#${mpIdOf(row.manpower_id)}`}</div>
									<div class="text-xs text-gray-500">
										{row.tanggal} · {row.jam_diajukan} jam
									</div>
									{#if row.alasan}
										<div class="text-xs text-gray-400 mt-0.5 line-clamp-2">{row.alasan}</div>
									{/if}
								</div>
								{#if !bolehPutuskan}
									<span class="shrink-0 text-[11px] text-gray-400">Pengajuan Anda</span>
								{:else}
									<div class="shrink-0 flex gap-1">
										<button
											onclick={() => putuskanLembur(row, true)}
											disabled={busyId === row.id}
											class="p-1.5 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
											title="Setujui lapis 1"><IconCheck size={18} /></button>
										<button
											onclick={() => putuskanLembur(row, false)}
											disabled={busyId === row.id}
											class="p-1.5 rounded text-red-600 hover:bg-red-50 disabled:opacity-50"
											title="Tolak"><IconX size={18} /></button>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}

	{#if nominasiTarget}
		<!-- Lembar nominasi calon leader -->
		<div class="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
			<div class="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto">
				<h3 class="text-sm font-bold">Nominasikan {nominasiTarget.manpower_id?.nama || 'anggota'} jadi calon leader</h3>
				<p class="text-[11px] text-gray-500">
					Langkah: (1) beri nilai potensi memimpin, (2) pilih alasan, (3) kirim. HRD me-review dulu — nominasi belum otomatis menjadikannya leader.
				</p>
				<div>
					<p class="text-xs font-semibold mb-1">Potensi memimpin (1 = rendah, 5 = sangat tinggi)</p>
					<div class="flex gap-2">
						{#each [1, 2, 3, 4, 5] as n}
							<button
								type="button"
								onclick={() => (nomRating = n)}
								class="w-10 h-10 rounded-full border text-sm font-bold {nomRating === n ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600'}"
							>{n}</button>
						{/each}
					</div>
				</div>
				<div>
					<p class="text-xs font-semibold mb-1">Alasan / kompetensi (pilih minimal 1)</p>
					<div class="flex flex-wrap gap-1.5">
						{#each TAG_NOMINASI as t}
							<button
								type="button"
								onclick={() => toggleTag(t.key)}
								class="px-2 py-1 text-xs rounded-full border {nomTags.includes(t.key) ? 'bg-indigo-50 border-indigo-500 text-indigo-700 font-semibold' : 'bg-white text-gray-600'}"
							>{t.label}</button>
						{/each}
					</div>
				</div>
				<div>
					<label class="text-xs font-semibold" for="nom-catatan">Catatan (opsional)</label>
					<textarea id="nom-catatan" bind:value={nomCatatan} maxlength="500" rows="3" class="w-full mt-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Contoh: sering memimpin pekerjaan blasting saat mandor tidak ada"></textarea>
				</div>
				<div class="flex gap-2">
					<button type="button" onclick={() => (nominasiTarget = null)} class="flex-1 py-2 rounded-lg border text-sm">Batal</button>
					<button type="button" onclick={kirimNominasi} disabled={nomBusy} class="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">
						{nomBusy ? 'Mengirim…' : 'Kirim nominasi'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<GateFixKtpNik
	open={ktpDialog.open}
	manpowerId={ktpDialog.manpowerId}
	manpowerName={ktpDialog.manpowerName}
	onClose={() => (ktpDialog = { ...ktpDialog, open: false })}
	onSuccess={() => {
		ktpDialog = { ...ktpDialog, open: false };
		muatIdentitas();
	}}
/>
