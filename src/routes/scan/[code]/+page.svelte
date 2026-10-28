<!-- src/routes/scan/[code]/+page.svelte -->
<!--
	Titik masuk publik untuk QR fisik (checkpoint GA Checklist/Patroli Satpam, label
	inventory) — dicetak sebagai URL /scan/<kode> (lihat checkpointScanUrl di
	erp-epi-1/SecurityCheckpointMaster.svelte & qrLinkFor di QrLabelPrint.svelte) supaya
	kamera bawaan HP bisa langsung membuka link ini tanpa buka aplikasi dulu.

	Rute ini berada di luar folder (app) tapi tetap kena guard auth global di
	root +layout.svelte: kalau belum login, layout sudah redirect ke
	/login?returnTo=/scan/<kode> sebelum halaman ini sempat dirender, dan balik
	kemari otomatis setelah login berhasil. Jadi begitu komponen ini mount,
	$authStore.user dijamin sudah ada.
-->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolveCheckpoint } from '$lib/services/gaChecklist';
	import { routeCheckpointScan } from '$lib/utils/checkpointScanRoute';
	import { parseEpiQr, type ParsedEpiQr } from '$lib/utils/qrParse';
	import { resolveServisLuarQr } from '$lib/services/servisLuar';
	import { resolveSjQr, submitWorkshopSjkConfirmReceipt, SjkReasonRequiredError, resolveBatchQr, type ResolveSjResult, type ResolveCiketingSjkResult, type ResolveBatchResult } from '$lib/services/scanResolve';
	import { getSOForPO } from '$lib/services/salesPo';
	import { authStore } from '$lib/stores/auth';
	import { submitProofOfDelivery, submitProofOfDeliveryBlobs, dataUrlToBlob } from '$lib/services/proofOfDelivery';
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { enqueuePeminjamanScan, registerPeminjamanAutoFlush, type QueuedPeminjamanEntry } from '$lib/utils/offlinePeminjamanQueue';
	import { getEquipmentByCode } from '$lib/services/preventive';
	import { getComponentUnitById, recordComponentInspection, type ComponentUnitLite } from '$lib/services/clm';
	import { resolveGudangArea } from '$lib/services/cekAreaApi';
	import { saveScanProof } from '$lib/utils/p2hScanProof';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { IconLoader2, IconAlertTriangle, IconQrcode, IconArrowLeft, IconTruck, IconCircleCheck } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import KnowledgeCard from '$lib/components/inventory360/KnowledgeCard.svelte';

	const code = decodeURIComponent(page.params.code || '');

	let status = $state<'resolving' | 'error' | 'epi' | 'sj' | 'comp' | 'ciketing_sjk'>('resolving');
	let errorMsg = $state('');
	let epiParsed = $state<ParsedEpiQr | null>(null);
	let sjResolved = $state<ResolveSjResult | null>(null);
	// QR label kaleng cat (EPI:BATCH:<id>, Fase 4 QC Re-test): info batch + CoA + Re-QC + HOLD.
	let batchInfo = $state<ResolveBatchResult | null>(null);
	let batchLoadError = $state('');

	// R7 (24 Sep 2026) — serah-terima digital SJ Keluar Ciketing (QR CIK-SJK-V2).
	let sjkResolved = $state<ResolveCiketingSjkResult | null>(null);
	let sjkReceiverName = $state('');
	let sjkSubmitting = $state(false);
	let sjkError = $state('');
	let sjkDone = $state(false);
	// WSK-14: token dari QR (dikirim ke server saat konfirmasi) + alasan pengecualian bila gate bermode soft
	let sjkToken = $state('');
	let sjkNeedReason = $state(false);
	let sjkReason = $state('');
	let sjkReasonMin = $state(20);

	// Aset/equipment (Fase 6, sambungkan ke barcode project yang ada): meniru pola
	// EquipmentActionSheet di dashboard Maintenance — dulu di sini scan EQUIPMENT
	// cuma dead-end "buka dashboard admin", sekarang tawarkan aksi kontekstual
	// (Isi P2H / Lapor Kerusakan / Cek PM / Riwayat) langsung dari QR fisik.
	let EquipmentActionSheet = $state<any>(null);
	async function loadEquipmentActionSheet() {
		EquipmentActionSheet ??= (await import('$lib/components/scanner/EquipmentActionSheet.svelte')).default;
	}
	let scannedEquipment = $state<{ id: string; name: string; code?: string | null } | null>(null);

	// QR komponen (EPI:COMP:<id>, CLM v2 Fase 4) — mekanik/operator hanya melihat identitas
	// & mencatat kondisi. TIDAK ada rupiah di layar lapangan.
	let compUnit = $state<ComponentUnitLite | null>(null);
	let compKondisi = $state<'baik' | 'perlu_perhatian' | 'rusak'>('baik');
	let compNote = $state('');
	let compSaving = $state(false);
	let compDone = $state(false);
	let compError = $state('');

	async function submitCompInspection() {
		if (!compUnit?.equipmentId) return;
		compSaving = true;
		compError = '';
		try {
			await recordComponentInspection({
				component_unit_id: compUnit.id,
				equipment_id: compUnit.equipmentId,
				scanned_code: code,
				scan_method: 'scan',
				match_status: 'match',
				kondisi: compKondisi,
				catatan: compNote || null,
				operatorName: $authStore.user?.displayName || $authStore.user?.email || null
			});
			compDone = true;
		} catch (err) {
			compError = err instanceof Error ? err.message : 'Gagal mencatat kondisi komponen.';
		}
		compSaving = false;
	}

	// R7 (24 Sep 2026) — serah-terima digital SJ Keluar Ciketing.
	async function handleSjkConfirmReceipt() {
		if (!sjkResolved) return;
		const name = sjkReceiverName.trim();
		if (!name) {
			sjkError = 'Nama penerima wajib diisi.';
			return;
		}
		sjkSubmitting = true;
		sjkError = '';
		try {
			if (!sjkToken) {
				sjkError = 'QR tidak lengkap. Pindai ulang QR di surat jalan.';
				return;
			}
			if (sjkNeedReason && sjkReason.trim().length < sjkReasonMin) {
				sjkError = `Alasan minimal ${sjkReasonMin} karakter.`;
				return;
			}
			await submitWorkshopSjkConfirmReceipt({
				workshopKey: sjkResolved.workshop === 'balaraja' ? 'balaraja' : 'ciketing',
				sjkId: sjkResolved.sjk.id,
				token: sjkToken,
				receiverName: name,
				...(sjkNeedReason ? { exceptionReason: sjkReason.trim() } : {})
			});
			sjkDone = true;
		} catch (err) {
			if (err instanceof SjkReasonRequiredError) {
				sjkNeedReason = true;
				sjkReasonMin = err.minAlasan;
			}
			sjkError = err instanceof Error ? err.message : 'Gagal mengirim konfirmasi terima.';
		} finally {
			sjkSubmitting = false;
		}
	}

	// Proof of Delivery (F3, Keputusan D3) — driver TTD + foto di HP-nya sendiri.
	let showPodForm = $state(false);
	let podPhotoFile = $state<File | null>(null);
	let podSubmitting = $state(false);
	let podError = $state('');
	let podDone = $state(false);
	let podSignaturePad: any = $state(null);

	const EPI_TYPE_LABEL: Record<string, string> = {
		ITEM: 'Barang',
		LOC: 'Lokasi Gudang',
		BATCH: 'Batch/Lot'
	};

	async function resolve() {
		if (!code) {
			status = 'error';
			errorMsg = 'Kode QR tidak valid.';
			return;
		}

		// QR Surat Jalan (EPI:SJ:<id>:<token>, Keputusan D1) — resolver tunggal menentukan
		// peran & aksi yang diizinkan di server (Bab 6.2), klien hanya merutekan.
		const epi = parseEpiQr(code);
		if (epi && epi.type === 'SJ') {
			try {
				const res = await resolveSjQr(code);
				if (res.kind !== 'sj') throw new Error('Respons resolver tidak sesuai.');
				sjResolved = res;
				status = 'sj';
			} catch (err) {
				status = 'error';
				errorMsg = err instanceof Error ? err.message : 'Gagal memproses QR Surat Jalan.';
			}
			return;
		}

		// QR Surat Jalan Internal (EPI:SJI:<id>:<token>, Fase 2 SJI v2) — arahkan langsung ke
		// halaman konfirmasi serah-terima gudang, token dibawa sebagai query param (dicocokkan
		// ulang di server sebelum stok dipotong, lihat api/sji/[id]/serahkan).
		if (epi && epi.type === 'SJI') {
			await goto(`/sji/konfirmasi?id=${epi.id}&token=${encodeURIComponent(epi.token || '')}`, { replaceState: true });
			return;
		}

		// R7 (24 Sep 2026) — QR SJ Keluar Ciketing chokepoint BARU (EPI:CIK-SJK-V2:<id>:<token>).
		// Beda dari CIK-SJK lama: di sini lapangan bisa KONFIRMASI TERIMA digital, bukan
		// cuma lihat tracking read-only (dicek lebih dulu — prefix beda, tidak konflik).
		// Fase 7 Unifikasi Workshop: BLJ-SJK-V2 = padanan Balaraja (serah-terima digital yang sama).
		if (epi && (epi.type === 'CIK-SJK-V2' || epi.type === 'BLJ-SJK-V2')) {
			try {
				const res = await resolveSjQr(code);
				if (res.kind !== 'ciketing_sjk' && res.kind !== 'balaraja_sjk') throw new Error('Respons resolver tidak sesuai.');
				sjkResolved = res;
				sjkToken = epi.token || '';
				status = 'ciketing_sjk';
			} catch (err) {
				status = 'error';
				errorMsg = err instanceof Error ? err.message : `Gagal memproses QR SJ Keluar ${epi.type === 'BLJ-SJK-V2' ? 'Balaraja' : 'Ciketing'}.`;
			}
			return;
		}

		// QR SJ Keluar Workshop (EPI:CIK-SJK:<id>:<token> / EPI:BLJ-SJK:<id>:<token>, Fase 5).
		// Lapangan hanya MELIHAT status pengiriman — arahkan ke halaman tracking read-only
		// (batch di-resolve dari id baris di halaman detail).
		if (epi && (epi.type === 'CIK-SJK' || epi.type === 'BLJ-SJK')) {
			const ws = epi.type === 'BLJ-SJK' ? 'balaraja' : 'ciketing';
			await goto(`/pengiriman-workshop/detail?w=${ws}&k=${encodeURIComponent('id-' + epi.id)}`, { replaceState: true });
			return;
		}

		// QR SOP cetak (EPI:SOP:<id>, R3) — langsung ke pembaca digital + konfirmasi baca.
		// Tanpa token: SOP bersifat baca publik-internal di balik login biasa (Fase 2C),
		// tidak perlu verifikasi tanda tangan seperti dokumen transaksional SJ/PJM/SJI.
		if (epi && epi.type === 'SOP') {
			await goto(`/ess/pelatihan/sop/${epi.id}`, { replaceState: true });
			return;
		}

		// QR komponen (EPI:COMP:<id>, CLM v2 Fase 4) — tampilkan identitas unit + form
		// catat kondisi. Kalau kode valid tapi unit tak ada di sistem: jangan dipaksa,
		// arahkan lapor supervisor (hint wajib rencana §7).
		if (epi && epi.type === 'COMP') {
			const unit = await getComponentUnitById(Number(epi.id));
			if (!unit) {
				status = 'error';
				errorMsg = `Komponen #${epi.id} tidak cocok dengan data sistem. Jangan dipaksa — laporkan ke supervisor.`;
				return;
			}
			compUnit = unit;
			epiParsed = epi;
			status = 'comp';
			return;
		}

		// QR SO (EPI:SO:<id>, R10) — dicetak/ditampilkan admin dari /sales/po-verify.
		// Redirect ke halaman unggah PO lapangan HANYA kalau SO ini milik sales yang scan
		// (karyawan_id cocok) — kalau tidak, tampilkan pesan jelas, jangan tebak-tebak buka punya orang lain.
		if (epi && epi.type === 'SO') {
			const soId = Number(epi.id);
			const so = await getSOForPO(soId).catch(() => null);
			if (!so) {
				status = 'error';
				errorMsg = `SO #${soId} tidak ditemukan.`;
				return;
			}
			if (so.karyawan_id !== $authStore.karyawanId) {
				status = 'error';
				errorMsg = `SO ${so.nomor_so} bukan milik Anda di sistem — hubungi admin sales kalau ini seharusnya SO Anda.`;
				return;
			}
			await goto(`/sales/po/${soId}`, { replaceState: true });
			return;
		}

		// QR aset/equipment (EPI:EQUIPMENT:<code>) — cari equipment lewat kode, lalu tawarkan
		// action sheet kontekstual (sama seperti dashboard Maintenance), bukan dead-end.
		if (epi && epi.type === 'EQUIPMENT') {
			const equipCode = String(epi.id);
			const equipment = await getEquipmentByCode(equipCode);
			if (!equipment) {
				status = 'error';
				errorMsg = `Equipment dengan kode "${equipCode}" tidak ditemukan.`;
				return;
			}
			saveScanProof(equipment.id);
			await loadEquipmentActionSheet();
			scannedEquipment = { id: equipment.id, name: equipment.name, code: equipment.code };
			status = 'epi';
			epiParsed = epi;
			return;
		}

		// QR SPK (EPI:SPK:<id>:<token>, Kiosk Produksi Fase 3B K3) — label ini untuk scanner
		// kiosk di kiosk/input-produksi (keyboard-wedge), bukan kamera HP. Kalau tetap
		// terpindai kamera, beri pesan jelas alih-alih jatuh ke menu stok yang salah konteks.
		if (epi && epi.type === 'SPK') {
			status = 'error';
			errorMsg = `SPK #${epi.id} adalah label lantai produksi — pindai dengan scanner di Kiosk Produksi, bukan kamera HP.`;
			return;
		}

		// Label QR gudang/rak (EPI:LOC:<id>) -- Fase 3 (Rencana Sistem Penempatan Area
		// Inventory & Verifikasi Barcode v2, 20 Agu 2026): dulu SELALU dead-end ke menu 3
		// tombol di bawah dengan instruksi "cari manual". Sekarang: kalau lokasi ini rak/zona
		// atau sudah punya penempatan item, langsung ke Cek Area. Kalau bukan (gudang level
		// teratas tanpa penempatan), tiga tombol lama tetap tampil sebagai fallback.
		if (epi && epi.type === 'LOC') {
			const area = await resolveGudangArea(Number(epi.id)).catch(() => null);
			if (area) {
				await goto(`/stock-lapangan/cek-area/${area.id}`, { replaceState: true });
				return;
			}
		}

		// Label QR inventory (EPI:ITEM:<id> / EPI:LOC:<id> / EPI:BATCH:<id>) belum
		// terikat ke satu alur kerja tunggal — arahkan ke menu pilihan alur stok.
		// Khusus EPI:BATCH: tampilkan dulu info batch cat (gagal baca tidak memblokir menu stok di bawahnya).
		if (epi) {
			if (epi.type === 'BATCH') {
				try {
					batchInfo = await resolveBatchQr(Number(epi.id));
				} catch (e: any) {
					batchLoadError = e?.message || 'Gagal membaca info batch.';
				}
			}
			epiParsed = epi;
			status = 'epi';
			return;
		}

		// Fase 6 (Pergerakan External Terpadu v2.0): qr_token Surat Jalan servis luar
		// (UUID polos, tidak berprefix) — coba resolusi ke sini dulu sebelum jatuh ke
		// checkpoint GA/Satpam di bawah, supaya kode SJ tidak salah dianggap titik ronda.
		try {
			await resolveServisLuarQr(code);
			await goto(`/maintenance/servis-luar?code=${encodeURIComponent(code)}`, { replaceState: true });
			return;
		} catch {
			// Bukan qr_token SJ servis luar — lanjut coba sebagai checkpoint GA/Satpam.
		}

		// Selain itu, anggap ini kode checkpoint GA Checklist / titik ronda Satpam —
		// server yang menentukan konteksnya (sama seperti tombol Scan universal).
		// Keputusan tujuan dipusatkan di routeCheckpointScan (dipakai juga oleh tombol
		// Scan universal di (app)/+layout.svelte) — non-petugas diarahkan ke Halaman
		// Ruangan, petugas terjadwal tetap ke checklist.
		try {
			const result = await resolveCheckpoint(code);
			const { url } = routeCheckpointScan(result, { scanRouteMode: result.scan_route_mode });
			await goto(url, { replaceState: true });
		} catch (err) {
			status = 'error';
			errorMsg = err instanceof Error ? err.message : 'QR tidak dikenali atau bukan titik terdaftar.';
		}
	}

	// Jaring pengaman draf untuk Proof of Delivery. Hanya FOTO yang disimpan, bukan
	// tanda tangan: TTD adalah langkah terakhir dan murah diulang di tempat, sedangkan
	// foto bukti serah-terima menuntut driver kembali ke titik antar kalau hilang.
	// (Kebijakan yang sama dipakai di P2H — lihat p2hDraft.ts.)
	const POD_PHOTO_KEY = 'pod';
	const podPersist = createFormPersist<{ showPodForm: boolean }>(`pod_${code}`);
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function podSnapshot() {
		return { showPodForm };
	}

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void podSnapshot();
		if (!draftArmed) return;
		podPersist.save(podSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(podPersist, podSnapshot));

	function onPodPhotoChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		podPhotoFile = file || null;
		if (podPhotoFile) podPersist.savePhoto(POD_PHOTO_KEY, podPhotoFile);
	}

	let podQueuedOffline = $state(false);

	async function sendQueuedPod(entry: QueuedPeminjamanEntry) {
		if (entry.kind !== 'pod') return;
		await submitProofOfDeliveryBlobs({
			suratJalanId: entry.suratJalanId,
			gps: entry.gps,
			signatureBlob: entry.signatureBlob,
			photoBlob: entry.photoBlob
		});
	}

	async function handlePodSubmit() {
		if (!sjResolved) return;
		podError = '';
		if ((!podSignaturePad || podSignaturePad.isEmpty()) && !podPhotoFile) {
			podError = 'Tanda tangan atau foto bukti wajib diisi.';
			return;
		}
		podSubmitting = true;
		const gps = await getCurrentPosition().catch(() => null);
		const gpsPlain = gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null;
		try {
			await submitProofOfDelivery({
				suratJalanId: sjResolved.suratJalan.id,
				signaturePad: podSignaturePad,
				photoFile: podPhotoFile,
				gps: gpsPlain
			});
			// Terkirim — draf lokal (termasuk foto POD di IndexedDB) sudah tidak relevan.
			podPersist.clear();
			await podPersist.clearPhotos();
			draftSavedAt = null;
			podDone = true;
			showPodForm = false;
		} catch (err) {
			// L4 (Bab 11): TypeError = fetch gagal total (offline), bukan galat dari server —
			// simpan ke antrian lokal untuk dikirim ulang otomatis saat sinyal kembali.
			if (err instanceof TypeError) {
				try {
					await enqueuePeminjamanScan({
						kind: 'pod',
						client_txn_id: crypto.randomUUID(),
						suratJalanId: sjResolved.suratJalan.id,
						gps: gpsPlain,
						signatureBlob: podSignaturePad && !podSignaturePad.isEmpty() ? dataUrlToBlob(podSignaturePad.toDataURL()) : undefined,
						photoBlob: podPhotoFile || undefined,
						createdAt: new Date().toISOString()
					});
					// Masuk antrean offline — draf lokal juga sudah tidak relevan.
					podPersist.clear();
					await podPersist.clearPhotos();
					draftSavedAt = null;
					podDone = true;
					podQueuedOffline = true;
					showPodForm = false;
				} catch (queueErr) {
					podError = queueErr instanceof Error ? queueErr.message : 'Gagal menyimpan bukti serah-terima secara offline.';
				}
			} else {
				podError = err instanceof Error ? err.message : 'Gagal mengirim bukti serah-terima.';
			}
		}
		podSubmitting = false;
	}

	onMount(async () => {
		resolve();
		registerPeminjamanAutoFlush(sendQueuedPod);

		const draft = podPersist.restore();
		if (draft?.showPodForm) {
			showPodForm = true;
			const blob = await podPersist.restorePhoto(POD_PHOTO_KEY);
			if (blob) podPhotoFile = new File([blob], 'pod.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});
</script>

<div class="scroll-body">
	<div class="max-w-md mx-auto p-4 pt-10 flex flex-col items-center text-center">
		{#if status === 'resolving'}
			<div class="py-6 flex justify-center">
				<CircularProgressGauge size={64} strokeWidth={5} label="Memverifikasi QR..." sublabel="Mengecek keabsahan kode Directus" />
			</div>
		{:else if status === 'error'}
			<div class="rounded-xl p-6 w-full" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconAlertTriangle size={28} style="color: var(--red); margin: 0 auto 8px" />
				<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Gagal memproses QR</p>
				<p class="text-[12px] mb-4" style="color: var(--sys-label3)">{errorMsg}</p>
				<p class="text-[11px] mb-4" style="color: var(--sys-label4)">Kode: {code}</p>
				<button
					class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2"
					style="background: var(--g)"
					onclick={() => goto('/ess')}
				>
					<IconArrowLeft size={16} /> Kembali ke Beranda
				</button>
			</div>
		{:else if status === 'sj' && sjResolved}
			<div class="rounded-xl p-6 w-full" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				{#if podDone}
					<IconCircleCheck size={28} style="color: var(--g); margin: 0 auto 8px" />
					<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">
						{podQueuedOffline ? 'Tersimpan — menunggu sinyal' : 'Serah terima tercatat'}
					</p>
					<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
						{podQueuedOffline
							? 'Sinyal sedang buruk — bukti serah-terima tersimpan di HP ini dan akan terkirim otomatis begitu koneksi kembali.'
							: 'Terima kasih — bukti serah-terima berhasil dikirim.'}
					</p>
					<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/ess')}>
						Kembali ke Beranda
					</button>
				{:else}
					<IconTruck size={28} style="color: var(--g); margin: 0 auto 8px" />
					<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">
						Surat Jalan {sjResolved.suratJalan.nomorSj}
					</p>
					{#if showPodForm}
						<div class="flex justify-center mb-1"><DraftIndicator savedAt={draftSavedAt} hasPhotos={!!podPhotoFile} /></div>
					{/if}
					<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
						{sjResolved.suratJalan.customerName || '-'} · Status: {sjResolved.suratJalan.status} · Driver: {sjResolved.suratJalan.driver || '-'}
					</p>

					{#if showPodForm}
						<div class="text-left">
							<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Tanda Tangan Penerima</p>
							<div class="mb-3">
								<SignaturePad bind:this={podSignaturePad} height={130} />
							</div>
							<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Foto Bukti (opsional bila TTD sudah diisi)</p>
							<input type="file" accept="image/*" capture="environment" class="w-full mb-3 text-[12px]" onchange={onPodPhotoChange} />
							{#if podError}
								<p class="text-[11px] mb-2" style="color: var(--red)">{podError}</p>
							{/if}
							<div class="flex gap-2">
								<button class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => (showPodForm = false)}>
									Batal
								</button>
								<button
									class="flex-1 rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
									style="background: var(--g)"
									disabled={podSubmitting}
									onclick={handlePodSubmit}
								>
									{podSubmitting ? 'Mengirim...' : 'Kirim Bukti'}
								</button>
							</div>
						</div>
					{:else}
						<div class="flex flex-col gap-2">
							{#if sjResolved.allowedActions.includes('gate_scan')}
								<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/satpam/gate')}>
									Catat di Gate Log
								</button>
							{/if}
							{#if sjResolved.allowedActions.includes('goods_receipt')}
								<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan/masuk')}>
									Konfirmasi Penerimaan Barang
								</button>
							{/if}
							{#if sjResolved.allowedActions.includes('proof_of_delivery')}
								<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => (showPodForm = true)}>
									Serah Terima ke Peminjam (TTD)
								</button>
							{/if}
							{#if sjResolved.allowedActions.length === 1 && sjResolved.allowedActions.includes('view_summary')}
								<p class="text-[11px]" style="color: var(--sys-label4)">Anda tidak punya aksi untuk Surat Jalan ini — ringkasan saja.</p>
							{/if}
							<!-- Tracking SJ v2 Fase 4: timeline tahap + aksi lengkap di halaman Lacak SJ -->
							<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold" style="background: var(--sys-fill2, #eef2ff); color: var(--sys-label, #1e293b); border: 1px solid var(--sys-sep)" onclick={() => goto(`/lacak-sj/${sjResolved.suratJalan.id}`)}>
								Lihat Lacak & Riwayat Tahap
							</button>
						</div>
					{/if}
				{/if}
			</div>
		{:else if status === 'ciketing_sjk' && sjkResolved}
			<div class="rounded-xl p-6 w-full" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				{#if sjkDone || sjkResolved.sjk.diterimaAt}
					<IconCircleCheck size={28} style="color: var(--g); margin: 0 auto 8px" />
					<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Serah terima tercatat</p>
					<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
						SJ {sjkResolved.sjk.noSj} diterima oleh {sjkReceiverName || sjkResolved.sjk.diterimaOleh}.
					</p>
					<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/workshop')}>
						Kembali ke Workshop
					</button>
				{:else}
					<IconTruck size={28} style="color: var(--g); margin: 0 auto 8px" />
					<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">SJ Keluar {sjkResolved.workshop === 'balaraja' ? 'Balaraja' : 'Ciketing'} {sjkResolved.sjk.noSj}</p>
					<p class="text-[11px] mb-1" style="color: var(--sys-label3)">Status: {sjkResolved.sjk.statusKirim || '-'}</p>
					<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
						Finance: {sjkResolved.sjk.approvalStatus === 'approved' ? '✓ disetujui' : '⏳ belum disetujui'} · Satpam: {sjkResolved.sjk.securityVerified ? '✓ lolos' : '⏳ belum diperiksa'}
					</p>

					{#if sjkResolved.allowedActions.includes('confirm_receipt')}
						<div class="text-left">
							<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Nama Penerima</p>
							<input
								type="text"
								bind:value={sjkReceiverName}
								placeholder="Nama lengkap penerima barang"
								class="w-full mb-3 px-3 py-2 rounded-lg text-[13px] border"
								style="border-color: var(--sys-sep)"
							/>
							{#if sjkNeedReason}
								<p class="text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Alasan tetap diterima (min. {sjkReasonMin} karakter)</p>
								<textarea bind:value={sjkReason} rows="2" class="w-full mb-3 px-3 py-2 rounded-lg text-[13px] border" style="border-color: var(--sys-sep)" placeholder="Mis. barang sudah dicek bersama sopir dan jumlahnya sesuai..."></textarea>
							{/if}
							{#if sjkError}
								<p class="text-[11px] mb-2" style="color: var(--red)">{sjkError}</p>
							{/if}
							<p class="text-[10px] mb-2" style="color: var(--sys-label4)">Konfirmasi hanya setelah barang benar-benar diterima dan jumlahnya dicek.</p>
							<button
								class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
								style="background: var(--g)"
								disabled={sjkSubmitting}
								onclick={handleSjkConfirmReceipt}
							>
								{sjkSubmitting ? 'Mengirim...' : 'Konfirmasi Terima'}
							</button>
						</div>
					{:else}
						<p class="text-[11px]" style="color: var(--sys-label4)">SJ ini sudah dikonfirmasi diterima sebelumnya — tidak ada aksi lagi.</p>
					{/if}
				{/if}
			</div>
		{:else if status === 'comp' && compUnit}
			<div class="rounded-xl p-6 w-full" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				{#if compDone}
					<IconCircleCheck size={28} style="color: var(--g); margin: 0 auto 8px" />
					<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Kondisi komponen tercatat</p>
					<p class="text-[11px] mb-4" style="color: var(--sys-label3)">{compUnit.nama} · #{compUnit.id}</p>
					<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/ess')}>
						Kembali ke Beranda
					</button>
				{:else}
					<IconQrcode size={28} style="color: var(--g); margin: 0 auto 8px" />
					<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">{compUnit.nama}</p>
					<p class="text-[11px] mb-1" style="color: var(--sys-label3)">
						#{compUnit.id} · {compUnit.kategori}{compUnit.merek ? ` · ${compUnit.merek}` : ''}
						{#if compUnit.kode_unit} · {compUnit.kode_unit}{/if}
					</p>
					<p class="text-[11px] mb-3" style="color: var(--sys-label3)">
						Status: {compUnit.status_fisik}
						{#if compUnit.equipmentName} · terpasang di {compUnit.equipmentName}{/if}
					</p>
					{#if compUnit.warranty_expiry}
						<p class="text-[11px] mb-3" style="color: var(--sys-label4)">Garansi s/d {compUnit.warranty_expiry}</p>
					{/if}

					{#if compUnit.equipmentId}
						<p class="text-[11px] font-semibold mb-1 text-left" style="color: var(--sys-label3)">Kondisi saat ini</p>
						<div class="flex gap-2 mb-3">
							{#each [['baik', 'Baik'], ['perlu_perhatian', 'Perlu perhatian'], ['rusak', 'Rusak']] as [val, label]}
								<button
									class="flex-1 rounded-lg py-2 text-[12px] font-semibold border"
									style={compKondisi === val
										? 'background: var(--g); color: #fff; border-color: var(--g)'
										: 'background: var(--sys-bg); color: var(--sys-label); border-color: var(--sys-sep)'}
									onclick={() => (compKondisi = val as typeof compKondisi)}
								>{label}</button>
							{/each}
						</div>
						<textarea
							bind:value={compNote}
							rows="2"
							placeholder="Catatan (opsional)"
							class="w-full rounded-lg p-2 mb-2 text-[12px]"
							style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)"
						></textarea>
						{#if compError}
							<p class="text-[11px] mb-2" style="color: var(--red)">{compError}</p>
						{/if}
						<button
							class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
							style="background: var(--g)"
							disabled={compSaving}
							onclick={submitCompInspection}
						>
							{compSaving ? 'Menyimpan…' : 'Catat Kondisi Komponen'}
						</button>
					{:else}
						<p class="text-[11px]" style="color: var(--sys-label4)">
							Komponen ini belum terpasang di alat manapun di sistem — verifikasi kondisi dilakukan lewat P2H alat terkait.
						</p>
					{/if}
					<p class="text-[10px] mt-3" style="color: var(--sys-label4)">
						Kalau kode tidak cocok dengan barang fisik, jangan dipaksa — laporkan ke supervisor.
					</p>
				{/if}
			</div>
		{:else if status === 'epi' && epiParsed && epiParsed.type !== 'EQUIPMENT'}
			<div class="rounded-xl p-6 w-full" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconQrcode size={28} style="color: var(--g); margin: 0 auto 8px" />
				<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">
					{EPI_TYPE_LABEL[epiParsed.type] || epiParsed.type} #{epiParsed.id}
				</p>
				{#if epiParsed.type === 'ITEM'}
					<!-- Inventory 360°: panduan pakai, APD, dan tanda harus ganti langsung dari QR barang -->
					<div class="text-left rounded-lg p-3 mb-3 border bg-white" style="border-color: var(--sys-sep)">
						<KnowledgeCard itemId={Number(epiParsed.id)} context="usage" inline />
					</div>
					{/if}
					{#if epiParsed.type === 'BATCH'}
					{#if batchInfo}
						<div class="text-left rounded-lg p-3 mb-3 border" style="border-color: var(--sys-sep)">
							{#if batchInfo.hold}
								<p class="text-[12px] font-bold mb-2 rounded p-2" style="background: #FEE2E2; color: #B91C1C">
									BATCH DITAHAN (HOLD) — ada komplain customer terbuka. Jangan dipakai/dikirim sebelum dikonfirmasi tim QC.
								</p>
							{/if}
							<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{batchInfo.batch.namaBarang || 'Produk'}</p>
							<p class="text-[11px] mb-2" style="color: var(--sys-label3)">Batch {batchInfo.batch.batchNo || '-'}</p>
							<dl class="text-[12px] grid grid-cols-2 gap-x-3 gap-y-1" style="color: var(--sys-label)">
								<dt style="color: var(--sys-label3)">Tgl produksi</dt><dd>{batchInfo.batch.tanggalProduksi?.slice(0, 10) || '-'}</dd>
								<dt style="color: var(--sys-label3)">Umur</dt><dd>{batchInfo.batch.umurHari != null ? `${batchInfo.batch.umurHari} hari` : '-'}</dd>
								<dt style="color: var(--sys-label3)">Kadaluarsa</dt>
								<dd style={batchInfo.batch.kadaluarsaLewat ? 'color:#B91C1C;font-weight:600' : ''}>{batchInfo.batch.tanggalKadaluarsa?.slice(0, 10) || '-'}{batchInfo.batch.kadaluarsaLewat ? ' (LEWAT)' : ''}</dd>
								<dt style="color: var(--sys-label3)">CoA</dt><dd>{batchInfo.coa ? batchInfo.coa.kode : 'Belum terbit'}</dd>
								<dt style="color: var(--sys-label3)">Re-QC</dt><dd>{batchInfo.retest.aktif ? 'Terverifikasi' : 'Tidak ada / tidak berlaku'}</dd>
							</dl>
							{#if batchInfo.panduan}
								<p class="text-[11px] font-semibold mt-3 mb-1" style="color: var(--sys-label3)">Panduan Pemakaian</p>
								<ul class="text-[12px] list-disc pl-4" style="color: var(--sys-label)">
									{#if batchInfo.panduan.thinnerType || batchInfo.panduan.thinningRatio}<li>Thinner: {batchInfo.panduan.thinnerType || '-'}{batchInfo.panduan.thinningRatio ? ` · pengenceran ${batchInfo.panduan.thinningRatio}` : ''}</li>{/if}
									{#if batchInfo.panduan.persiapanPermukaan}<li>Permukaan: {batchInfo.panduan.persiapanPermukaan}</li>{/if}
									{#if batchInfo.panduan.metodeAplikasi}<li>Aplikasi: {batchInfo.panduan.metodeAplikasi}</li>{/if}
									{#if batchInfo.panduan.overcoatMinJam != null || batchInfo.panduan.overcoatMaxJam != null}<li>Overcoat: {batchInfo.panduan.overcoatMinJam ?? '?'}–{batchInfo.panduan.overcoatMaxJam ?? '?'} jam</li>{/if}
									{#if batchInfo.panduan.penyimpanan}<li>Simpan: {batchInfo.panduan.penyimpanan}</li>{/if}
								</ul>
							{:else}
								<p class="text-[11px] mt-3" style="color: var(--sys-label3)">Panduan teknis produk ini belum diisi di sistem.</p>
							{/if}
							<button
								class="w-full mt-3 rounded-lg py-2 text-[12px] font-semibold border"
								style="border-color: #DC2626; color: #DC2626"
								onclick={() => goto(`/komplain-customer?batch=${encodeURIComponent(batchInfo?.batch.batchNo || '')}`)}
							>
								Cat bermasalah? Laporkan batch ini
							</button>
						</div>
					{:else if batchLoadError}
						<p class="text-[11px] mb-3" style="color: #B91C1C">{batchLoadError}</p>
					{/if}
				{/if}
				<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
					Pilih alur stok lapangan untuk memproses kode ini — cari kode {code} secara manual di dalam form.
				</p>
				<div class="flex flex-col gap-2">
					<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan/opname')}>
						Stok Opname
					</button>
					<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan/masuk')}>
						Barang Masuk
					</button>
					<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/stock-lapangan/output')}>
						Barang Keluar
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

{#if scannedEquipment && EquipmentActionSheet}
	<EquipmentActionSheet equipment={scannedEquipment} onClose={() => { scannedEquipment = null; goto('/ess'); }} />
{/if}
