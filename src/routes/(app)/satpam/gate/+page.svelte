<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, tick } from 'svelte';
	import {
		searchKaryawan, searchManpower, fetchOpenGatePersonLogs, submitGatePersonLog,
		fetchOpenGateGoodsLogs, markGoodsReturned, submitGateGoodsLog,
	} from '$lib/services/security';
	import { auth } from '$lib/firebase';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { createGerbangApi, type GAntrianRow, type GDetail, type GHasil, type GPenjualanRow, type GReturDoc, type GReturCek, type GMutasiDoc } from '$lib/services/gerbangSjApi';
	import { TEKS, menitText } from '$lib/data/gerbangSjTeks';
	import GerbangSjForm from '$lib/components/gerbangSj/GerbangSjForm.svelte';
	import GerbangWorkshopPanel from '$lib/components/gerbangSj/GerbangWorkshopPanel.svelte';
	import SectionGuide from '$lib/components/hints/SectionGuide.svelte';
	import { authStore } from '$lib/stores/auth';
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import { resolveGateRetur, confirmGateRetur, type GateReturInfo } from '$lib/services/rentalOrderGateApi';
	import { resolveSewaMasukGate, confirmSewaMasukGate, type SewaMasukGateInfo } from '$lib/services/sewaMasukGateApi';
	import { enqueuePeminjamanScan, registerPeminjamanAutoFlush, type QueuedPeminjamanEntry } from '$lib/utils/offlinePeminjamanQueue';
	import {
		IconArrowLeft, IconLoader2, IconQrcode, IconTruckDelivery, IconBox,
		IconClipboardCheck, IconPhoto, IconX
	} from '@tabler/icons-svelte';

	// ---- Retur Peminjaman External (F3, Bab 6.3) ----
	let returPending = $state<GateReturInfo | null>(null);
	let returCode = $state('');
	let returKondisi = $state<Record<number, string>>({});
	let returSubmitting = $state(false);

	// ---- Gerbang Sewa Masuk dari Vendor (Fase 4, Rencana Pertajam Rental Order v2) ----
	// TERPISAH dari Peminjaman External di atas -- beda arah (kita MENYEWA, bukan meminjamkan).
	let sewaMasukPending = $state<SewaMasukGateInfo | null>(null);
	let sewaMasukCode = $state('');
	let sewaMasukSubmitting = $state(false);
	// Fase 6 §9.2 L5 — foto kondisi WAJIB saat datang & kembali (server menolak kalau kosong).
	let sewaMasukFoto = $state<Array<{ file: File; id: string | null; uploading: boolean; preview: string }>>([]);
	let sewaMasukKondisi = $state('');
	let sewaMasukFotoInputEl: HTMLInputElement;

	let subTab = $state<'orang' | 'barang'>('orang');
	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	// ---- Izin Jam-Jaman (Fase 2) ----
	let izinJamActive = $state<any[]>([]);
	let showQrScanner = $state(false);
	let scanning = $state(false);
	let QrScannerModal = $state<any>(null);
	async function loadQrScannerModal() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
	}

	async function getIdToken(): Promise<string> {
		const user = auth.currentUser;
		if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
		return user.getIdToken();
	}

	async function loadIzinJamActive() {
		try {
			const idToken = await getIdToken();
			const res = await fetch('/api/ess/izin-jam/active', { headers: { Authorization: `Bearer ${idToken}` } });
			if (res.ok) {
				const data = await res.json();
				izinJamActive = data.data || [];
			}
		} catch {
			// non-fatal — panel tetap kosong, tidak menghalangi gate log manual
		}
	}

	// ---- Gerbang Surat Jalan (GSP-09): semua lewat /api/gerbang-sj/* (satu pintu server, sama dgn kiosk & ERP) ----
	const gerbangApi = createGerbangApi(async () => ({ Authorization: `Bearer ${await getIdToken()}` }));
	let antrianSj = $state<GAntrianRow[]>([]);
	let aktorNama = $state('');
	let inspectingSj = $state<GDetail | null>(null);

	async function bukaSj(loader: () => Promise<GDetail>) {
		errorMsg = '';
		successMsg = '';
		scanning = true;
		try {
			inspectingSj = await loader();
			subTab = 'barang';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat data Surat Jalan.';
		}
		scanning = false;
	}
	const startSjInspection = (sjId: number) => bukaSj(() => gerbangApi.detail(sjId));

	// WSK-35 4b — SJ Keluar workshop (Ciketing & Balaraja): panel sendiri, server satu pintu /api/gerbang-workshop
	let workshopPanel = $state<{ bukaDariQr: (code: string) => Promise<void>; muat: () => Promise<void> } | null>(null);
	function pesanWorkshop(p: { ok?: string; err?: string }) {
		if (p.ok !== undefined) successMsg = p.ok;
		if (p.err !== undefined) errorMsg = p.err;
		if (!p.ok && !p.err) { errorMsg = ''; successMsg = ''; }
	}

	// SJ-09 opsi C — SJ penjualan: tampil hanya bila setelan gerbang_penjualan_aktif menyala; status SJ tidak berubah
	let penjualanAktif = $state(false);
	let penjualan = $state<GPenjualanRow[]>([]);
	let penjualanBuka = $state<GPenjualanRow | null>(null);
	let penjualanCatatan = $state('');
	let penjualanBusy = $state(false);

	async function loadPenjualan() {
		try {
			const d = await gerbangApi.antrianPenjualan();
			penjualanAktif = !!d.aktif;
			penjualan = d.antrian || [];
		} catch (e) {
			console.error('[gate] antrean penjualan gagal:', e);
			penjualanAktif = false;
		}
	}
	// RSM-04 — Retur dari proyek (masuk gudang): scan QR lembar RTN / ketik nomor, cek, lalu Loloskan Masuk.
	let returAntrian = $state<GReturDoc[]>([]);
	let returCek = $state<GReturCek[]>([]);
	let returQuery = $state('');
	let returDoc = $state<GReturDoc | null>(null);
	let returInfo = $state<{ perlu_tandai_berangkat: boolean; sudah_diverifikasi: boolean; pesan: string | null } | null>(null);
	let returCeklis = $state<Record<string, boolean>>({});
	let returAlasan = $state('');
	let returBusy = $state(false);
	let tanpaDokProyek = $state('');
	let tanpaDokCatatan = $state('');

	// RSM-13 — e-SJ Mutasi rute via_gudang: hanya tampil bila ada yang menunggu (rute langsung_site tidak lewat gerbang).
	let mutasiAntrian = $state<GMutasiDoc[]>([]);
	let mutasiCek = $state<GReturCek[]>([]);
	let mutasiBuka = $state<GMutasiDoc | null>(null);
	let mutasiCeklis = $state<Record<string, boolean>>({});
	let mutasiAlasan = $state('');
	let mutasiBusy = $state(false);
	async function loadMutasi() {
		try {
			const d = await gerbangApi.antrianMutasi();
			mutasiAntrian = d.antrian || [];
			mutasiCek = d.checklist || [];
		} catch (e) {
			// Skema mutasi belum diterapkan = antrean kosong; kegagalan lain tetap dicatat jelas (Aturan #1).
			console.error('[gate] antrean mutasi gagal:', e);
		}
	}
	async function loloskanMutasiAksi() {
		if (!mutasiBuka || mutasiBusy) return;
		mutasiBusy = true; errorMsg = ''; successMsg = '';
		try {
			const r = await gerbangApi.loloskanMutasi(mutasiBuka.id, { client_event_id: crypto.randomUUID(), checklist: mutasiCeklis });
			successMsg = r.pesan; mutasiBuka = null; mutasiCeklis = {};
			await loadMutasi();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal meloloskan mutasi.';
		} finally {
			mutasiBusy = false;
		}
	}
	async function tahanMutasiAksi() {
		if (!mutasiBuka || mutasiBusy) return;
		if (mutasiAlasan.trim().length < 10) { errorMsg = 'Tulis alasan menahan (min. 10 karakter).'; return; }
		mutasiBusy = true; errorMsg = ''; successMsg = '';
		try {
			const r = await gerbangApi.tahanMutasi(mutasiBuka.id, { client_event_id: crypto.randomUUID(), alasan: mutasiAlasan.trim() });
			successMsg = r.pesan; mutasiAlasan = ''; mutasiBuka = null;
			await loadMutasi();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal menahan mutasi.';
		} finally {
			mutasiBusy = false;
		}
	}

	async function loadRetur() {
		try {
			const d = await gerbangApi.antrianRetur();
			returAntrian = d.antrian || [];
			returCek = d.checklist || [];
		} catch (e) {
			console.error('[gate] antrean retur gagal:', e);
		}
	}
	async function cariReturAksi(q?: string) {
		const kunci = (q ?? returQuery).trim();
		if (!kunci || returBusy) return;
		returBusy = true; errorMsg = ''; successMsg = '';
		try {
			const r = await gerbangApi.cariRetur(kunci);
			returDoc = r.doc; returInfo = r; returCek = r.checklist || returCek; returCeklis = {}; returAlasan = '';
			if (r.pesan && !r.perlu_tandai_berangkat) successMsg = r.pesan;
		} catch (e) {
			returDoc = null; returInfo = null;
			errorMsg = e instanceof Error ? e.message : 'Dokumen retur tidak ditemukan.';
		} finally {
			returBusy = false;
		}
	}
	async function loloskanReturAksi() {
		if (!returDoc || returBusy) return;
		returBusy = true; errorMsg = ''; successMsg = '';
		try {
			const r = await gerbangApi.loloskanRetur(returDoc.id, { client_event_id: crypto.randomUUID(), checklist: returCeklis, tandai_berangkat: !!returInfo?.perlu_tandai_berangkat });
			successMsg = r.pesan + (r.effects_gagal?.length ? ' ' + TEKS.efekGagal : '');
			returDoc = null; returInfo = null; returQuery = '';
			await loadRetur();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal meloloskan.';
		} finally {
			returBusy = false;
		}
	}
	async function tahanReturAksi() {
		if (!returDoc || returBusy) return;
		if (returAlasan.trim().length < 10) { errorMsg = 'Tulis alasan menahan (min. 10 karakter).'; return; }
		returBusy = true; errorMsg = ''; successMsg = '';
		try {
			const r = await gerbangApi.tahanRetur(returDoc.id, { client_event_id: crypto.randomUUID(), alasan: returAlasan.trim() });
			successMsg = r.pesan; returAlasan = '';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal menahan.';
		} finally {
			returBusy = false;
		}
	}
	async function catatTanpaDokumenAksi() {
		if (returBusy) return;
		const pid = Number(tanpaDokProyek);
		if (!pid) { errorMsg = 'Isi nomor ID proyek asal barang (tanya sopir / lihat surat jalan).'; return; }
		returBusy = true; errorMsg = ''; successMsg = '';
		try {
			const r = await gerbangApi.catatReturTanpaDokumen({ client_event_id: crypto.randomUUID(), project_id: pid, catatan: tanpaDokCatatan.trim() });
			successMsg = r.pesan; tanpaDokProyek = ''; tanpaDokCatatan = '';
			await loadRetur();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mencatat.';
		} finally {
			returBusy = false;
		}
	}

	async function tahanPenjualanAksi() {
		if (!penjualanBuka || penjualanBusy) return;
		if (penjualanCatatan.trim().length < 5) { errorMsg = 'Tulis alasan menahan di kolom catatan (min. 5 karakter).'; return; }
		penjualanBusy = true; errorMsg = ''; successMsg = '';
		try {
			const r = await gerbangApi.tahanPenjualan(penjualanBuka.id, { client_event_id: crypto.randomUUID(), kategori: 'lainnya', alasan: penjualanCatatan.trim() });
			successMsg = r.pesan + (r.effects_gagal?.length ? ' ' + TEKS.efekGagal : '');
			penjualanBuka = null; penjualanCatatan = '';
			await loadPenjualan();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal menahan.';
		} finally {
			penjualanBusy = false;
		}
	}
	async function catatLolosPenjualan() {
		if (!penjualanBuka || penjualanBusy) return;
		penjualanBusy = true; errorMsg = ''; successMsg = '';
		try {
			const r = await gerbangApi.loloskanPenjualan(penjualanBuka.id, { client_event_id: crypto.randomUUID(), catatan: penjualanCatatan.trim() || null });
			successMsg = r.pesan + (r.effects_gagal?.length ? ' ' + TEKS.efekGagal : '');
			penjualanBuka = null; penjualanCatatan = '';
			await loadPenjualan();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mencatat.';
		} finally {
			penjualanBusy = false;
		}
	}

	async function onSjDone(r: GHasil) {
		inspectingSj = null;
		successMsg = r.pesan + (r.effects_gagal?.length ? ' ' + TEKS.efekGagal : '');
		await loadAll();
	}

	async function handleQrDetect(value: string) {
		showQrScanner = false;
		errorMsg = '';
		successMsg = '';

		// Cabang EPI:PJM: (F3, Bab 6.3) — retur Peminjaman External di gerbang masuk.
		const epi = parseEpiQr(value);
		if (epi && epi.type === 'PJM') {
			scanning = true;
			try {
				returPending = await resolveGateRetur(value);
				returCode = value;
				returKondisi = Object.fromEntries(returPending.items.map((it) => [it.id, 'Baik']));
				subTab = 'barang';
			} catch (err) {
				errorMsg = err instanceof Error ? err.message : 'Gagal memproses QR retur peminjaman.';
			}
			scanning = false;
			return;
		}

		// Cabang EPI:SWA: (Fase 4) — kedatangan/retur Sewa Masuk dari vendor. TERPISAH dari
		// EPI:PJM di atas -- beda arah (kita MENYEWA, bukan meminjamkan).
		if (epi && epi.type === 'SWA') {
			scanning = true;
			try {
				sewaMasukPending = await resolveSewaMasukGate(value);
				sewaMasukCode = value;
				subTab = 'barang';
			} catch (err) {
				errorMsg = err instanceof Error ? err.message : 'Gagal memproses QR sewa masuk.';
			}
			scanning = false;
			return;
		}

		// Cabang EPI:CIK-SJK(-V2)/BLJ-SJK(-V2): — QR SJ Keluar Workshop (WSK-35 4b): server memvalidasi token QR.
		if (epi && (epi.type === 'CIK-SJK' || epi.type === 'CIK-SJK-V2' || epi.type === 'BLJ-SJK' || epi.type === 'BLJ-SJK-V2')) {
			subTab = 'barang';
			await tick();
			if (workshopPanel) await workshopPanel.bukaDariQr(value);
			else errorMsg = 'Panel SJ workshop belum siap — muat ulang halaman.';
			return;
		}

		// Cabang EPI:SJ: — QR Surat Jalan: Ambil detail & tampilkan modal verifikasi barang
		if (epi && epi.type === 'SJ') {
			await bukaSj(() => gerbangApi.cari({ code: value }));
			return;
		}

		if (!value.startsWith('IZINJAM:')) {
			errorMsg = 'QR tidak dikenali.';
			return;
		}
		scanning = true;
		try {
			const idToken = await getIdToken();
			const res = await fetch('/api/ess/izin-jam/gate-scan', {
				method: 'POST',
				headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ qrValue: value })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
			successMsg = data.arah === 'out' ? 'Tercatat keluar.' : 'Tercatat masuk — izin selesai.';
			await loadIzinJamActive();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal scan QR izin.';
		}
		scanning = false;
	}

	// ---- Orang ----
	let openPersonLogs = $state<any[]>([]);
	let personTipe = $state<'tetap' | 'manpower' | 'tamu'>('tetap');
	let personQuery = $state('');
	let personResults = $state<any[]>([]);
	let selectedPerson = $state<{ id: number; label: string } | null>(null);
	let personArah = $state<'out' | 'in'>('out');
	let personKeperluan = $state('dinas');
	let personNamaManual = $state('');

	// ---- Barang ----
	// Pilihan satuan baku (bukan teks bebas) — temuan 6 Okt: lakban tercatat "50 Inch".
	const SATUAN_BARANG = ['pcs', 'roll', 'dus', 'kg', 'liter', 'unit', 'lainnya'];
	let openGoodsLogs = $state<any[]>([]);
	let goodsForm = $state({
		deskripsi: '', qty: '', satuan: '', arah: 'out' as 'out' | 'in', pembawa_tipe: 'karyawan',
		pembawa_nama: '', jenis: 'barang_pribadi', no_sj_manual: '', wajibKembali: false, expected_return: ''
	});

	async function loadAll() {
		loading = true;
		// allSettled: satu query gagal tidak boleh mengosongkan seluruh halaman
		const [pRes, gRes, sRes] = await Promise.allSettled([
			fetchOpenGatePersonLogs(),
			fetchOpenGateGoodsLogs(),
			gerbangApi.antrian()
		]);
		const gagal: string[] = [];
		if (pRes.status === 'fulfilled') openPersonLogs = pRes.value || []; else gagal.push('orang di luar');
		if (gRes.status === 'fulfilled') openGoodsLogs = gRes.value || []; else gagal.push('barang belum kembali');
		if (sRes.status === 'fulfilled') { antrianSj = sRes.value.antrian || []; aktorNama = sRes.value.aktor?.nama || ''; } else gagal.push('surat jalan');
		for (const r of [pRes, gRes, sRes]) if (r.status === 'rejected') console.error('[gate/loadAll]', r.reason);
		if (gagal.length) {
			const sjAlasan = sRes.status === 'rejected' && sRes.reason instanceof Error ? ` Surat jalan: ${sRes.reason.message}` : '';
			errorMsg = `Sebagian data gagal dimuat (${gagal.join(', ')}). Data lain tetap bisa dipakai — coba muat ulang, bila berulang laporkan ke admin.${sjAlasan}`;
		}
		await Promise.all([loadIzinJamActive(), loadPenjualan(), loadRetur(), loadMutasi()]);
		loading = false;
	}
	onMount(() => {
		loadAll();
		// Router scan global mengarahkan ke /satpam/gate?sj=<id> supaya form langsung terbuka.
		const sjParam = Number(page.url.searchParams.get('sj'));
		if (Number.isInteger(sjParam) && sjParam > 0) startSjInspection(sjParam);
		registerPeminjamanAutoFlush(sendQueuedGateScan);
	});

	let searchTimer: ReturnType<typeof setTimeout>;
	function onPersonQueryInput() {
		selectedPerson = null;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(async () => {
			if (!personQuery.trim()) { personResults = []; return; }
			const results = personTipe === 'manpower' ? await searchManpower(personQuery) : await searchKaryawan(personQuery);
			personResults = results.map((r: any) => ({ id: r.id, label: r.nama_karyawan || r.nama }));
		}, 300);
	}

	function pickPerson(p: { id: number; label: string }) {
		selectedPerson = p;
		personQuery = p.label;
		personResults = [];
	}

	// G_SEC2 (mode soft): alasan tetap mencatat, diminta setelah server menjawab 422.
	let gateSec2Reason = '';

	async function submitPerson() {
		errorMsg = '';
		successMsg = '';
		if (personTipe === 'tamu' && !personNamaManual.trim()) { errorMsg = 'Isi nama.'; return; }
		if (personTipe !== 'tamu' && !selectedPerson) { errorMsg = 'Pilih dari hasil pencarian.'; return; }

		saving = true;
		try {
			const payload: Record<string, any> = {
				karyawan_id: personTipe === 'tetap' ? selectedPerson?.id ?? null : null,
				manpower_id: personTipe === 'manpower' ? selectedPerson?.id ?? null : null,
				nama_manual: personTipe === 'tamu' ? personNamaManual.trim() : null,
				tipe: personTipe === 'manpower' ? 'manpower' : personTipe === 'tamu' ? 'tamu' : 'tetap',
				arah: personArah,
				keperluan: personKeperluan,
				gate_sec2_reason: gateSec2Reason.trim() || undefined
			};
			await submitGatePersonLog(payload as Parameters<typeof submitGatePersonLog>[0]);
			successMsg = 'Gate log tersimpan.';
			selectedPerson = null;
			personQuery = '';
			personNamaManual = '';
			gateSec2Reason = '';
			await loadAll();
		} catch (err) {
			if (err instanceof Error && (err as any).isGateSec2) {
				const alasan = window.prompt(`${err.message}\n\nAlasan tetap mencatat (min. 5 karakter):`, '');
				if (alasan && alasan.trim().length >= 5) {
					gateSec2Reason = alasan.trim();
					saving = false;
					await submitPerson();
					return;
				}
				gateSec2Reason = '';
			}
			errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan gate log.';
		}
		saving = false;
	}

	// SJ-08: security_gate_goods_log.deskripsi = varchar(255). Ubah bersama skema bila GATE-01 K1 = text.
	const DESKRIPSI_MAX = 255;

	async function submitGoods() {
		errorMsg = '';
		successMsg = '';
		if (!goodsForm.deskripsi.trim()) { errorMsg = 'Isi deskripsi barang.'; return; }
		if (goodsForm.deskripsi.trim().length > DESKRIPSI_MAX) { errorMsg = `Deskripsi maksimal ${DESKRIPSI_MAX} karakter — persingkat.`; return; }

		saving = true;
		try {
			await submitGateGoodsLog({
				deskripsi: goodsForm.deskripsi.trim(),
				qty: goodsForm.qty === '' ? null : Number(goodsForm.qty),
				satuan: goodsForm.satuan || null,
				satpam_pencatat_id: get(authStore).karyawanId ?? null,
				arah: goodsForm.arah,
				pembawa_tipe: goodsForm.pembawa_tipe,
				pembawa_nama: goodsForm.pembawa_nama.trim() || null,
				jenis: goodsForm.jenis,
				no_sj_manual: goodsForm.no_sj_manual.trim() || null,
				expected_return: goodsForm.wajibKembali && goodsForm.expected_return ? new Date(goodsForm.expected_return).toISOString() : null
			});
			successMsg = 'Barang tercatat.';
			goodsForm = { deskripsi: '', qty: '', satuan: '', arah: 'out', pembawa_tipe: 'karyawan', pembawa_nama: '', jenis: 'barang_pribadi', no_sj_manual: '', wajibKembali: false, expected_return: '' };
			await loadAll();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan barang.';
		}
		saving = false;
	}

	async function sendQueuedGateScan(entry: QueuedPeminjamanEntry) {
		if (entry.kind !== 'gate') return;
		await confirmGateRetur(entry.code, entry.items);
	}

	async function confirmRetur() {
		if (!returPending) return;
		returSubmitting = true;
		errorMsg = '';
		const items = returPending.items.map((it) => ({ id: it.id, kondisiKembali: returKondisi[it.id] || 'Baik' }));
		const actionLabel = returPending.action === 'kedatangan' ? 'Kedatangan' : 'Retur';
		try {
			await confirmGateRetur(returCode, items);
			successMsg = `${actionLabel} ${returPending.referenceNo} berhasil dicatat.`;
			returPending = null;
			returCode = '';
			returKondisi = {};
		} catch (err) {
			if (err instanceof TypeError) {
				try {
					await enqueuePeminjamanScan({
						kind: 'gate',
						client_txn_id: crypto.randomUUID(),
						code: returCode,
						items,
						createdAt: new Date().toISOString()
					});
					const refNo = returPending?.referenceNo || '';
					successMsg = `${actionLabel} ${refNo} tersimpan offline — akan terkirim otomatis begitu sinyal kembali.`;
					returPending = null;
					returCode = '';
					returKondisi = {};
				} catch (queueErr) {
					errorMsg = queueErr instanceof Error ? queueErr.message : 'Gagal menyimpan secara offline.';
				}
			} else {
				errorMsg = err instanceof Error ? err.message : 'Gagal mengonfirmasi retur.';
			}
		}
		returSubmitting = false;
	}

	function cancelRetur() {
		returPending = null;
		returCode = '';
		returKondisi = {};
	}

	async function handleSewaMasukFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		for (const file of files) {
			const entry = { file, id: null as string | null, uploading: true, preview: URL.createObjectURL(file) };
			sewaMasukFoto = [...sewaMasukFoto, entry];
			const idx = sewaMasukFoto.length - 1;
			try {
				const { compressPhoto } = await import('$lib/utils/photoCompress');
				const { uploadFiles } = await import('@directus/sdk');
				const directus = (await import('$lib/services/directus')).default;
				const compressed = file.type.startsWith('image/') ? await compressPhoto(file) : file;
				const formData = new FormData();
				formData.append('file', compressed);
				formData.append('title', file.name);
				const result = (await directus.request(uploadFiles(formData))) as any;
				sewaMasukFoto[idx] = { ...sewaMasukFoto[idx], id: result?.id || null, uploading: false };
				if (!result?.id) {
					sewaMasukFoto = sewaMasukFoto.filter((_, i) => i !== idx);
				}
			} catch (err) {
				console.error('Gagal mengunggah foto kondisi:', err);
				sewaMasukFoto = sewaMasukFoto.filter((_, i) => i !== idx);
			}
		}
		if (sewaMasukFotoInputEl) sewaMasukFotoInputEl.value = '';
	}

	function removeSewaMasukFoto(idx: number) {
		sewaMasukFoto = sewaMasukFoto.filter((_, i) => i !== idx);
	}

	async function confirmSewaMasuk() {
		if (!sewaMasukPending) return;
		const uploadedIds = sewaMasukFoto.map((f) => f.id).filter(Boolean) as string[];
		if (uploadedIds.length === 0) {
			errorMsg = 'Foto kondisi alat wajib diunggah dulu sebelum konfirmasi.';
			return;
		}
		if (sewaMasukFoto.some((f) => f.uploading)) {
			errorMsg = 'Tunggu foto selesai diunggah.';
			return;
		}
		sewaMasukSubmitting = true;
		errorMsg = '';
		const actionLabel = sewaMasukPending.action === 'kedatangan' ? 'Kedatangan' : 'Retur';
		try {
			await confirmSewaMasukGate(sewaMasukCode, null, uploadedIds, sewaMasukKondisi);
			successMsg = `${actionLabel} alat sewa (Sewa Masuk #${sewaMasukPending.sewaMasukId}) berhasil dicatat.`;
			sewaMasukPending = null;
			sewaMasukCode = '';
			sewaMasukFoto = [];
			sewaMasukKondisi = '';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal mengonfirmasi gerbang sewa masuk.';
		}
		sewaMasukSubmitting = false;
	}

	function cancelSewaMasuk() {
		sewaMasukPending = null;
		sewaMasukCode = '';
		sewaMasukFoto = [];
		sewaMasukKondisi = '';
	}

	async function tandaiKembali(id: number) {
		try {
			await markGoodsReturned(id);
			await loadAll();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menandai kembali.';
		}
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/satpam')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Gate Log</h1>
		</div>

		<div class="flex gap-2 mb-4">
			<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold" style="background: {subTab === 'orang' ? 'var(--g)' : 'var(--sys-fill)'}; color: {subTab === 'orang' ? 'white' : 'var(--sys-label)'}" onclick={() => (subTab = 'orang')}>Orang</button>
			<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold" style="background: {subTab === 'barang' ? 'var(--g)' : 'var(--sys-fill)'}; color: {subTab === 'barang' ? 'white' : 'var(--sys-label)'}" onclick={() => (subTab = 'barang')}>Barang</button>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		{#if !loading}
			<button
				class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2 mb-4 disabled:opacity-50"
				style="background: var(--g)"
				disabled={scanning}
				onclick={async () => { await loadQrScannerModal(); showQrScanner = true; }}
			>
				{#if scanning}<IconLoader2 size={16} class="animate-spin" />{:else}<IconQrcode size={18} />{/if}
				Scan QR (Surat Jalan / Izin Jam / Retur Pinjam)
			</button>
		{/if}

		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data pos satpam & perizinan..." />
		</div>
		{:else if subTab === 'orang'}
			{#if izinJamActive.length > 0}
				<div class="rounded-xl p-3 mb-4" style="background: var(--aml); border: 1px solid var(--am)">
					<p class="text-[11px] font-semibold mb-1" style="color: var(--amd)">Izin Jam-Jaman Aktif ({izinJamActive.length})</p>
					{#each izinJamActive as i}
						<p class="text-[12px]" style="color: var(--amd)">
							{i.karyawan_id?.nama_karyawan || '-'} — {i.kategori_id?.nama || '-'}
							({i.status === 'out_scanned' ? 'sudah keluar' : 'disetujui'}, estimasi {i.estimasi_durasi_jam} jam)
						</p>
					{/each}
				</div>
			{/if}

			{#if openPersonLogs.length > 0}
				<div class="rounded-xl p-3 mb-4" style="background: var(--aml); border: 1px solid var(--am)">
					<p class="text-[11px] font-semibold mb-1" style="color: var(--amd)">Sedang di Luar ({openPersonLogs.length})</p>
					{#each openPersonLogs as l}
						<p class="text-[12px]" style="color: var(--amd)">{l.nama_manual || `Karyawan #${l.karyawan_id ?? l.manpower_id}`}</p>
					{/each}
				</div>
			{/if}

			<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={personTipe} onchange={() => { selectedPerson = null; personQuery = ''; personResults = []; }}>
				<option value="tetap">Karyawan Tetap/Kontrak/Harian</option>
				<option value="manpower">Manpower Proyek</option>
				<option value="tamu">Tamu / Lainnya</option>
			</select>

			{#if personTipe !== 'tamu'}
				<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-1" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Cari nama…" bind:value={personQuery} oninput={onPersonQueryInput} />
				{#if personResults.length > 0}
					<div class="rounded-lg mb-2 overflow-hidden" style="border: 1px solid var(--sys-sep)">
						{#each personResults as r}
							<button class="w-full text-left px-3 py-2 text-[12px]" style="background: white" onclick={() => pickPerson(r)}>{r.label}</button>
						{/each}
					</div>
				{/if}
			{:else}
				<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Nama" bind:value={personNamaManual} />
			{/if}

			<div class="grid grid-cols-2 gap-2 mb-3">
				<select class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={personArah}>
					<option value="out">Keluar</option>
					<option value="in">Masuk</option>
				</select>
				<select class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={personKeperluan}>
					<option value="dinas">Dinas</option>
					<option value="pribadi">Pribadi</option>
					<option value="istirahat">Istirahat</option>
				</select>
			</div>

			<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitPerson}>
				{saving ? 'Menyimpan…' : 'Catat'}
			</button>
		{:else}
			<!-- TAB BARANG -->

			<!-- GSP-09: Gerbang Surat Jalan — form bersama + antrian dari /api/gerbang-sj (sama dgn kiosk & ERP) -->
			<SectionGuide id="gerbang-sj-app" title={TEKS.panduanJudul} steps={[...TEKS.panduanLangkah]} defaultOpen={true} />

			{#if inspectingSj}
				{#key inspectingSj.sj.id}
					<GerbangSjForm detail={inspectingSj} api={gerbangApi} mode="app" onDone={onSjDone} onClose={() => (inspectingSj = null)} />
				{/key}
			{/if}

			<div class="rounded-xl p-3 mb-4" style="background: #f0f9ff; border: 1px solid #bae6fd">
				<div class="flex items-center gap-1.5 mb-2">
					<IconTruckDelivery size={18} class="text-sky-600" />
					<p class="text-[12px] font-bold text-sky-900">{TEKS.judulAntrian} ({antrianSj.length})</p>
				</div>
				{#if aktorNama}<p class="text-[10px] text-sky-800 mb-2">Masuk sebagai {aktorNama}</p>{/if}
				{#if antrianSj.length === 0}
					<p class="text-[11px] text-sky-800 italic">Tidak ada SJ yang menunggu di gerbang.</p>
				{/if}
				<div class="space-y-2">
					{#each antrianSj as sj (sj.id)}
						<div class="bg-white p-2.5 rounded-lg border {sj.is_pre_print ? 'border-amber-300 ring-1 ring-amber-200' : 'border-sky-200'} text-[12px] shadow-2xs">
							<div class="flex justify-between items-start mb-1 gap-2">
								<div class="min-w-0">
									<div class="flex items-center gap-1.5 flex-wrap">
										<span class="font-bold text-gray-900 break-all">{sj.nomor_sj}</span>
										{#if sj.is_pre_print}
											<span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">Pre-Cetak</span>
										{/if}
										{#if sj.belum_discan_muat}
											<span class="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-800 border border-yellow-300" title={TEKS.hintBelumMuat}>🟡 {TEKS.labelBelumMuat}</span>
										{/if}
									</div>
									<span class="block text-[11px] text-gray-500">{sj.driver || '-'}{sj.plat ? ' · ' + sj.plat : ''}{sj.koli_acuan != null ? ' · ' + sj.koli_acuan + ' koli' : ''}</span>
									{#if sj.belum_discan_muat}<span class="block text-[10px] text-yellow-800">{TEKS.hintBelumMuat}</span>{/if}
								</div>
								<div class="flex flex-col items-end gap-1 shrink-0">
									<span class="text-[10px] font-semibold px-2 py-0.5 rounded {sj.terlambat ? 'bg-red-100 text-red-700' : 'bg-sky-100 text-sky-800'}">{sj.terlambat ? 'TERLAMBAT · ' : ''}{menitText(sj.menunggu_menit)}</span>
									{#if sj.ditahan}<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-700">{sj.is_pre_print ? 'PERLU REVISI' : 'DITAHAN'}</span>{/if}
								</div>
							</div>
							{#if sj.ditahan && sj.alasan_tahan}<p class="text-[11px] text-orange-700 mb-1">{sj.is_pre_print ? 'Catatan revisi: ' : 'Ditahan: '}{sj.alasan_tahan}</p>{/if}
							{#if sj.blockers.length > 0}
								<p class="text-[11px] text-red-600 mb-1">🔒 {sj.blockers[0].pesan}</p>
							{/if}
							<button
								class="w-full py-1.5 rounded text-[11px] font-semibold {sj.is_pre_print ? 'text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100' : 'text-sky-700 bg-sky-50 border-sky-200 hover:bg-sky-100'} border flex items-center justify-center gap-1"
								onclick={() => startSjInspection(sj.id)}
							>
								<IconClipboardCheck size={14} /> {sj.is_pre_print ? 'Cek Fisik Lapangan' : 'Periksa'}
							</button>
						</div>
					{/each}
				</div>
			</div>

			<GerbangWorkshopPanel bind:this={workshopPanel} api={gerbangApi} onPesan={pesanWorkshop} />

			<!-- RSM-04: gerbang MASUK untuk retur barang dari proyek -->
			<div class="rounded-xl p-3 mb-4" style="background: #fffbeb; border: 1px solid #fde68a">
				<p class="text-[12px] font-bold text-amber-900 mb-1">📥 Retur dari Proyek (masuk gudang) ({returAntrian.length})</p>
				<p class="text-[10px] text-amber-800 mb-2">Truk dari proyek membawa barang kembali? Scan QR di lembar RTN atau ketik nomor RTN. Cocokkan jumlah &amp; kondisi barang dengan daftar, centang pemeriksaan, lalu tekan <strong>Loloskan Masuk</strong>. Bila tidak sesuai, tulis alasan lalu <strong>Tahan</strong>.</p>
				<div class="flex gap-2 mb-2">
					<input class="flex-1 rounded-lg px-3 py-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Nomor RTN / hasil scan QR" bind:value={returQuery} onkeydown={(e) => e.key === 'Enter' && cariReturAksi()} />
					<button class="px-3 py-2 rounded-lg text-[12px] font-bold text-white bg-amber-600 disabled:opacity-50" disabled={returBusy || !returQuery.trim()} onclick={() => cariReturAksi()}>Cari</button>
				</div>
				{#if returAntrian.length && !returDoc}
					<div class="flex flex-wrap gap-1.5 mb-2">
						{#each returAntrian as r (r.id)}
							<button class="px-2 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-mono" onclick={() => cariReturAksi(r.nomor_retur)}>{r.nomor_retur}{r.vehicle_plate ? ' · ' + r.vehicle_plate : ''} · {menitText(r.menunggu_menit ?? null)}</button>
						{/each}
					</div>
				{:else if !returAntrian.length && !returDoc}
					<p class="text-[11px] text-amber-800 italic mb-1">Tidak ada retur yang menunggu di gerbang.</p>
				{/if}
				{#if returDoc}
					<div class="bg-white p-2.5 rounded-lg border border-amber-200 text-[12px]">
						<p class="font-bold text-gray-900 break-all">{returDoc.nomor_retur} <span class="text-[10px] font-semibold uppercase text-gray-500">{returDoc.status}</span>{#if returDoc.sumber === 'karantina'}<span class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">KARANTINA</span>{/if}</p>
						<p class="text-[11px] text-gray-500">{returDoc.proyek || '-'} · {returDoc.driver_name || '-'}{returDoc.vehicle_plate ? ' · ' + returDoc.vehicle_plate : ''} · {returDoc.items.length} barang · {returDoc.alat} alat</p>
						<ul class="mt-1 text-[11px] text-gray-700 list-disc pl-4">
							{#each returDoc.items as it (it.id)}<li>{it.material_name} — {it.qty_returned} {it.unit}</li>{/each}
						</ul>
						{#if returInfo?.sudah_diverifikasi}
							<p class="text-[11px] text-emerald-700 mt-1.5">{returInfo.pesan}</p>
						{:else if !['diterima', 'diterima_sebagian', 'ditolak', 'batal'].includes(returDoc.status)}
							{#if returInfo?.perlu_tandai_berangkat}
								<p class="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mt-1.5">Dokumen belum ditandai berangkat. Minta sopir/admin menekan <strong>Tandai Dijemput</strong> dulu. Bila truk sudah di gerbang, lanjutkan — <strong>jangan tolak truknya</strong>; waktu berangkat dicatat sekarang.</p>
							{/if}
							<div class="mt-1.5 space-y-1">
								{#each returCek as c (c.key)}
									<label class="flex items-center gap-2 text-[11px] text-gray-700"><input type="checkbox" bind:checked={returCeklis[c.key]} /> {c.label}</label>
								{/each}
							</div>
							<button class="w-full mt-2 py-2 rounded-lg text-[12px] font-bold text-white bg-green-600 disabled:opacity-50" disabled={returBusy || returCek.some((c) => returCeklis[c.key] !== true)} onclick={loloskanReturAksi}>
								{returBusy ? 'Memproses…' : returInfo?.perlu_tandai_berangkat ? '🚚 Tandai berangkat sekarang & Loloskan Masuk' : 'Loloskan Masuk'}
							</button>
							<textarea class="w-full rounded-lg px-3 py-2 text-[12px] mt-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" rows="2" placeholder="Alasan menahan (wajib bila Tahan)" bind:value={returAlasan}></textarea>
							<button class="w-full mt-1.5 py-2 rounded-lg text-[12px] font-bold text-red-700 bg-red-50 border border-red-200 disabled:opacity-50" disabled={returBusy} onclick={tahanReturAksi} title="Status dokumen tidak berubah; gudang diberi tahu dan memutuskan.">Tahan</button>
						{/if}
						<button class="mt-1.5 text-[11px] text-gray-500 underline" onclick={() => { returDoc = null; returInfo = null; }}>Tutup</button>
					</div>
				{/if}
				<details class="mt-2">
					<summary class="text-[11px] font-semibold text-amber-900 cursor-pointer">Truk retur TANPA dokumen?</summary>
					<p class="text-[10px] text-amber-800 my-1">Jangan tolak di gerbang. Catat di sini, arahkan truk ke <strong>area karantina</strong>; gudang akan melengkapi dokumennya.</p>
					<input class="w-full rounded-lg px-3 py-2 text-[12px] mb-1.5" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" inputmode="numeric" placeholder="ID proyek asal barang" bind:value={tanpaDokProyek} />
					<textarea class="w-full rounded-lg px-3 py-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" rows="2" placeholder="Keterangan: barang apa, plat, nama sopir" bind:value={tanpaDokCatatan}></textarea>
					<button class="w-full mt-1.5 py-2 rounded-lg text-[12px] font-bold text-white bg-amber-600 disabled:opacity-50" disabled={returBusy} onclick={catatTanpaDokumenAksi}>Catat tanpa dokumen</button>
				</details>
			</div>

			<!-- RSM-13: e-SJ Mutasi barang rute via gudang (hanya muncul bila ada yang menunggu) -->
			{#if mutasiAntrian.length}
				<div class="rounded-xl p-3 mb-4" style="background: #eef2ff; border: 1px solid #c7d2fe">
					<p class="text-[12px] font-bold text-indigo-900 mb-1">🔁 Mutasi Barang via Gudang ({mutasiAntrian.length})</p>
					<p class="text-[10px] text-indigo-800 mb-2">Truk membawa barang pindahan antar proyek/workshop lewat gerbang. Cocokkan barang &amp; plat dengan dokumen mutasi, centang pemeriksaan, lalu tekan <strong>Loloskan</strong>. Ada yang tidak sesuai? Tekan <strong>Tahan</strong> dan tulis alasannya.</p>
					<div class="space-y-1.5">
						{#each mutasiAntrian as m (m.id)}
							<div class="bg-white p-2.5 rounded-lg border border-indigo-200 text-[12px]">
								<button class="w-full text-left" onclick={() => { mutasiBuka = mutasiBuka?.id === m.id ? null : m; mutasiCeklis = {}; mutasiAlasan = ''; }}>
									<span class="font-bold text-gray-900 break-all">{m.nomor_mutasi}</span>
									<span class="block text-[11px] text-gray-500">{m.asal} → {m.tujuan} · {m.driver_name || '-'}{m.vehicle_plate ? ' · ' + m.vehicle_plate : ''} · {menitText(m.menunggu_menit ?? null)}</span>
								</button>
								{#if mutasiBuka?.id === m.id}
									<ul class="mt-1 text-[11px] text-gray-700 list-disc pl-4">
										{#each m.items as it (it.id)}<li>{it.nama} — {it.qty} {it.unit}</li>{/each}
									</ul>
									<div class="mt-1.5 space-y-1">
										{#each mutasiCek as c (c.key)}
											<label class="flex items-center gap-2 text-[11px] text-gray-700"><input type="checkbox" bind:checked={mutasiCeklis[c.key]} /> {c.label}</label>
										{/each}
									</div>
									<button class="w-full mt-2 py-2 rounded-lg text-[12px] font-bold text-white bg-green-600 disabled:opacity-50" disabled={mutasiBusy || mutasiCek.some((c) => mutasiCeklis[c.key] !== true)} onclick={loloskanMutasiAksi}>{mutasiBusy ? 'Memproses…' : 'Loloskan'}</button>
									<textarea class="w-full rounded-lg px-3 py-2 text-[12px] mt-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" rows="2" placeholder="Alasan menahan (wajib bila Tahan)" bind:value={mutasiAlasan}></textarea>
									<button class="w-full mt-1.5 py-2 rounded-lg text-[12px] font-bold text-red-700 bg-red-50 border border-red-200 disabled:opacity-50" disabled={mutasiBusy} onclick={tahanMutasiAksi} title="Status dokumen tidak berubah; Admin Inventory diberi tahu">Tahan di gerbang</button>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if penjualanAktif}
				<div class="rounded-xl p-3 mb-4" style="background: #f0fdf4; border: 1px solid #bbf7d0">
					<div class="flex items-center gap-1.5 mb-1">
						<IconTruckDelivery size={18} class="text-green-600" />
						<p class="text-[12px] font-bold text-green-900" title={TEKS.hintPenjualan}>{TEKS.judulPenjualan} ({penjualan.length})</p>
					</div>
					<p class="text-[10px] text-green-800 mb-2">{TEKS.hintPenjualan}</p>
					{#if penjualan.length === 0}
						<p class="text-[11px] text-green-800 italic">Tidak ada pengiriman penjualan yang menunggu dicatat.</p>
					{/if}
					<div class="space-y-2">
						{#each penjualan as p (p.id)}
							<div class="bg-white p-2.5 rounded-lg border border-green-200 text-[12px]">
								<button class="w-full text-left" onclick={() => { penjualanBuka = penjualanBuka?.id === p.id ? null : p; penjualanCatatan = ''; }}>
									<span class="font-bold text-gray-900 break-all">{p.nomor_sj}</span>{#if p.ditahan}<span class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">DITAHAN</span>{/if}
									<span class="block text-[11px] text-gray-500">{p.customer || '-'} · {p.driver || '-'}{p.plat ? ' · ' + p.plat : ''} · {menitText(p.menunggu_menit)}</span>
								</button>
								{#if penjualanBuka?.id === p.id}
									<p class="text-[11px] text-gray-600 mt-1">Tujuan: {p.tujuan || '-'}</p>
									{#if p.ditahan && p.alasan_tahan}<p class="text-[11px] text-orange-700">Ditahan: {p.alasan_tahan}</p>{/if}
									<textarea class="w-full rounded-lg px-3 py-2 text-[12px] mt-1" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" rows="2" placeholder="Catatan (opsional). Wajib diisi bila ditahan." bind:value={penjualanCatatan}></textarea>
									<button class="w-full mt-2 py-2 rounded-lg text-[12px] font-bold text-white bg-green-600 disabled:opacity-50" disabled={penjualanBusy} onclick={catatLolosPenjualan}>
										{penjualanBusy ? 'Mencatat…' : 'Catat Lolos'}
									</button>
									<button class="w-full mt-1.5 py-2 rounded-lg text-[12px] font-bold text-red-700 bg-red-50 border border-red-200 disabled:opacity-50" disabled={penjualanBusy} onclick={tahanPenjualanAksi} title="Tahan bila plat/driver/barang tidak cocok dengan SJ. Isi alasan di kolom catatan; logistik otomatis diberi tahu.">Tahan</button>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if returPending}
				<div class="rounded-xl p-3 mb-4" style="background: var(--gl); border: 1px solid var(--g)">
					{#if returPending.action === 'kedatangan'}
						<p class="text-[12px] font-semibold mb-1" style="color: var(--sys-label)">Kedatangan Barang Pinjaman {returPending.referenceNo}</p>
						<p class="text-[11px] mb-2" style="color: var(--sys-label3)">Dipinjam dari: {returPending.peminjam} — catat kondisi saat tiba sebagai baseline.</p>
					{:else}
						<p class="text-[12px] font-semibold mb-1" style="color: var(--sys-label)">
							{returPending.rentalDirection === 'rental_in' ? 'Pengembalian ke Pemilik' : 'Retur Peminjaman'} {returPending.referenceNo}
						</p>
						<p class="text-[11px] mb-2" style="color: var(--sys-label3)">
							{returPending.rentalDirection === 'rental_in' ? 'Pemilik' : 'Peminjam'}: {returPending.peminjam}
						</p>
					{/if}
					<div class="space-y-2 mb-3">
						{#each returPending.items as it}
							<div class="flex items-center justify-between gap-2">
								<span class="text-[12px]" style="color: var(--sys-label)">{it.nama_barang} ({it.qty} {it.satuan})</span>
								<select class="rounded-lg px-2 py-1 text-[11px]" style="background: white; border: 1px solid var(--sys-sep)" bind:value={returKondisi[it.id]}>
									<option value="Baik">Baik</option>
									<option value="Rusak Ringan">Rusak Ringan</option>
									<option value="Rusak Berat">Rusak Berat</option>
									<option value="Hilang">Hilang</option>
								</select>
							</div>
						{/each}
					</div>
					<div class="flex gap-2">
						<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={cancelRetur}>Batal</button>
						<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={returSubmitting} onclick={confirmRetur}>
							{returSubmitting ? 'Menyimpan…' : returPending.action === 'kedatangan' ? 'Konfirmasi Kedatangan' : 'Konfirmasi Retur'}
						</button>
					</div>
				</div>
			{/if}

			{#if sewaMasukPending}
				<div class="rounded-xl p-3 mb-4 border-l-4" style="background: #fff7ed; border-color: #ea580c;">
					<p class="text-[12px] font-semibold mb-1" style="color: #9a3412">
						🔶 {sewaMasukPending.action === 'kedatangan' ? 'Kedatangan Alat Sewa' : 'Retur Alat Sewa ke Vendor'} — Sewa Masuk #{sewaMasukPending.sewaMasukId}
					</p>
					<p class="text-[11px] mb-2" style="color: var(--sys-label3)">
						Vendor: {sewaMasukPending.vendor}{sewaMasukPending.project !== '-' ? ` · Proyek: ${sewaMasukPending.project}` : ''} — bukan aset perusahaan, nilai Rp 0.
					</p>
					<div class="space-y-1 mb-3">
						{#each sewaMasukPending.items as it}
							<div class="text-[12px]" style="color: var(--sys-label)">{it.nama_barang} ({it.qty} {it.satuan})</div>
						{/each}
					</div>

					<!-- Fase 6 §9.2 L5 — foto kondisi WAJIB (server menolak kalau kosong). -->
					<p class="text-[11px] font-semibold mb-1" style="color: #9a3412">
						📷 Foto Kondisi Alat {sewaMasukPending.action === 'kedatangan' ? 'Saat Datang' : 'Saat Kembali'} *
					</p>
					<div class="flex flex-wrap gap-2 mb-2">
						{#each sewaMasukFoto as f, idx}
							<div class="relative w-14 h-14 rounded-lg overflow-hidden border" style="border-color: #ea580c">
								<img src={f.preview} alt="Foto kondisi {idx + 1}" class="w-full h-full object-cover" />
								{#if f.uploading}
									<div class="absolute inset-0 flex items-center justify-center bg-black/40">
										<IconLoader2 size={16} class="animate-spin text-white" />
									</div>
								{:else}
									<button
										type="button"
										class="absolute top-0 right-0 w-4 h-4 flex items-center justify-center bg-black/60 text-white"
										onclick={() => removeSewaMasukFoto(idx)}
									>
										<IconX size={10} />
									</button>
								{/if}
							</div>
						{/each}
						<button
							type="button"
							class="w-14 h-14 rounded-lg border-2 border-dashed flex items-center justify-center"
							style="border-color: #ea580c; color: #ea580c"
							onclick={() => sewaMasukFotoInputEl?.click()}
						>
							<IconPhoto size={20} />
						</button>
						<input
							bind:this={sewaMasukFotoInputEl}
							type="file"
							accept="image/*"
							capture="environment"
							multiple
							class="hidden"
							onchange={handleSewaMasukFotoChange}
						/>
					</div>
					<textarea
						class="w-full rounded-lg px-2 py-1.5 text-[11px] mb-3"
						style="background: white; border: 1px solid var(--sys-sep)"
						rows="2"
						placeholder="Catatan kondisi (opsional, mis. ada lecet di sisi kiri)"
						bind:value={sewaMasukKondisi}
					></textarea>

					<div class="flex gap-2">
						<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={cancelSewaMasuk}>Batal</button>
						<button class="flex-1 rounded-lg py-2 text-[12px] font-semibold text-white disabled:opacity-50" style="background: #ea580c" disabled={sewaMasukSubmitting} onclick={confirmSewaMasuk}>
							{sewaMasukSubmitting ? 'Menyimpan…' : sewaMasukPending.action === 'kedatangan' ? 'Konfirmasi Kedatangan' : 'Konfirmasi Retur'}
						</button>
					</div>
				</div>
			{/if}

			{#if openGoodsLogs.length > 0}
				<div class="rounded-xl p-3 mb-4" style="background: var(--aml); border: 1px solid var(--am)">
					<p class="text-[11px] font-semibold mb-1" style="color: var(--amd)">Belum Kembali ({openGoodsLogs.length})</p>
					{#each openGoodsLogs as g}
						<div class="flex justify-between items-center text-[12px] py-0.5" style="color: var(--amd)">
							<span>{g.deskripsi} ({g.pembawa_nama || '-'})</span>
							<button class="text-[11px] underline" onclick={() => tandaiKembali(g.id)}>Kembali</button>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Form Catat Barang Manual -->
			<p class="text-[12px] font-bold mb-2" style="color: var(--sys-label)">Pencatatan Barang Manual</p>
			<input class="w-full rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Deskripsi barang (maks. {DESKRIPSI_MAX} karakter)" title="Tulis singkat: nama barang, merk/ukuran bila perlu." maxlength={DESKRIPSI_MAX} bind:value={goodsForm.deskripsi} />
			<p class="text-[11px] text-right mb-2" style="color: {goodsForm.deskripsi.length >= DESKRIPSI_MAX ? 'var(--sys-red, #dc2626)' : 'var(--sys-label)'}">{goodsForm.deskripsi.length}/{DESKRIPSI_MAX}</p>
			<div class="grid grid-cols-2 gap-2 mb-2">
				<input class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" type="number" placeholder="Qty" bind:value={goodsForm.qty} />
				<select class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={goodsForm.satuan}>
					<option value="">Satuan…</option>
					{#each SATUAN_BARANG as sat}<option value={sat}>{sat}</option>{/each}
				</select>
			</div>
			<div class="grid grid-cols-2 gap-2 mb-2">
				<select class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={goodsForm.arah}>
					<option value="out">Keluar</option>
					<option value="in">Masuk</option>
				</select>
				<select class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={goodsForm.jenis}>
					<option value="aset_perusahaan">Aset Perusahaan</option>
					<option value="barang_pribadi">Barang Pribadi</option>
					<option value="kiriman">Kiriman</option>
				</select>
			</div>
			<div class="grid grid-cols-2 gap-2 mb-2">
				<select class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={goodsForm.pembawa_tipe}>
					<option value="karyawan">Karyawan</option>
					<option value="tamu">Tamu</option>
					<option value="kurir">Kurir</option>
				</select>
				<input class="rounded-lg px-3 py-2 text-[13px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Nama pembawa" bind:value={goodsForm.pembawa_nama} />
			</div>
			<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="No. Surat Jalan (opsional)" bind:value={goodsForm.no_sj_manual} />
			<label class="flex items-center gap-2 text-[12px] mb-2" style="color: var(--sys-label)">
				<input type="checkbox" bind:checked={goodsForm.wajibKembali} /> Wajib kembali (aset/alat pinjam)
			</label>
			{#if goodsForm.wajibKembali}
				<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" type="datetime-local" bind:value={goodsForm.expected_return} />
			{/if}

			<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitGoods}>
				{saving ? 'Menyimpan…' : 'Catat'}
			</button>
		{/if}
	</div>
</div>

{#if showQrScanner && QrScannerModal}
	<QrScannerModal
		onDetect={handleQrDetect}
		onClose={() => (showQrScanner = false)}
	/>
{/if}
