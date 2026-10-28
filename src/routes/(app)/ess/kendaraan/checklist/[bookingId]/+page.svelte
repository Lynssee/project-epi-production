<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		getFleetBookingDetail,
		getFleetBookingMeta,
		submitFleetChecklist,
		requestCheckinDispensation,
		type FleetBookingRecord,
		type FleetBookingMeta,
		type ChecklistItemInput
	} from '$lib/services/ess/fleetBooking';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { isNetworkError } from '$lib/utils/fetchTimeout';
	import { enqueueP2H, currentP2HUserId } from '$lib/utils/offlineP2HQueue';
	import { FieldHint } from '$lib/components/hints';
	import { essHints } from '$lib/data/hints/ess';
	import { getHint } from '$lib/data/hints/getHint';
	import P2HChecklistForm from '$lib/components/fleet/P2HChecklistForm.svelte';
	import { normalizeP2HTemplate } from '$lib/data/p2hChecklist';
	import {
		IconLoader2,
		IconCircleCheck,
		IconAlertTriangle,
		IconArrowLeft,
		IconBrandWhatsapp
	} from '@tabler/icons-svelte';

	const h = (key: string) => getHint(essHints, key, 'ess');

	const bookingId: string = $page.params.bookingId ?? '';
	const tahap = ($page.url.searchParams.get('tahap') || 'sebelum') as 'sebelum' | 'selama' | 'setelah';
	// Peminjaman 08 §3.7 — peminjam lupa P2H sebelum berangkat: langsung isi pengembalian (server buat trip retroaktif).
	const lupaSebelum = tahap === 'setelah' && $page.url.searchParams.get('lupa_sebelum') === '1';

	let loading = $state(true);
	let loadError = $state('');
	let usingCache = $state(false);
	let booking = $state<FleetBookingRecord | null>(null);
	let meta = $state<FleetBookingMeta | null>(null);
	let itemStatus = $state<Record<string, 'ok' | 'rusak' | 'tidak_ada'>>({});
	// Peminjaman 08 §3.3 — KM TIDAK diisi otomatis: peminjam wajib mengetik angka yang terlihat di dashboard.
	let kmSaatCek = $state<number | null>(null);
	let kmKoreksiAlasan = $state('');
	let perluAlasanKm = $state(false);
	let temuan = $state('');
	let fotoFile = $state<File | null>(null);
	let fotoDashboardFile = $state<File | null>(null);
	let submitting = $state(false);
	let submitError = $state('');
	let networkPending = $state(false);
	let resultBlocked = $state(false);
	let resultSuccess = $state(false);
	let resultAlready = $state(false);
	let resultQueued = $state(false); // P2H tersimpan di HP, terkirim otomatis saat ada sinyal
	let queuedTidakLaik = $state(false);
	let resultWorkOrderId = $state<string | null>(null);

	// Kunci idempotensi per (booking, tahap) — bertahan saat halaman dimuat ulang, jadi kirim ulang tidak menggandakan.
	const txnKey = `p2h_txn_${bookingId}_${tahap}`;
	let txnId = $state('');
	let firstSubmitAt = $state<string | null>(null); // waktu kejadian asli (dipakai server bila ≤ 24 jam)

	const bookingCacheKey = `ess_kendaraan_booking_${bookingId}`;
	const gaWaCacheKey = 'ess_kendaraan_ga_wa';

	function readSession<T>(key: string): T | null {
		try {
			const r = sessionStorage.getItem(key);
			return r ? (JSON.parse(r) as T) : null;
		} catch {
			return null;
		}
	}
	function writeSession(key: string, value: unknown) {
		try {
			sessionStorage.setItem(key, JSON.stringify(value));
		} catch {
			/* penyimpanan penuh/diblokir — cache hanya kenyamanan */
		}
	}

	const TAHAP_LABEL: Record<string, string> = {
		sebelum: 'Sebelum Pakai',
		selama: 'Selama Pakai (Harian)',
		setelah: 'Pengembalian'
	};
	// Peminjaman 08 §3.9 — 2 langkah (tahap "selama" belum punya pintu masuk UI).
	const LANGKAH = [
		{ tahap: 'sebelum', label: 'Sebelum Pakai' },
		{ tahap: 'setelah', label: 'Pengembalian' }
	];
	const langkahAktif = tahap === 'setelah' ? 2 : 1;

	async function loadPage() {
		loading = true;
		loadError = '';
		usingCache = false;
		const [bR, mR] = await Promise.allSettled([getFleetBookingDetail(bookingId), getFleetBookingMeta()]);
		if (mR.status === 'fulfilled') {
			meta = mR.value;
			const wa = (mR.value as any)?.kontak_ga_wa;
			if (wa) writeSession(gaWaCacheKey, wa);
		}
		if (bR.status === 'fulfilled') {
			booking = bR.value;
			writeSession(bookingCacheKey, bR.value);
		} else {
			// Cache hanya dipakai saat JARINGAN bermasalah — penolakan server (404/403) tidak boleh ditutupi cache lama.
			const cached = isNetworkError(bR.reason) ? readSession<FleetBookingRecord>(bookingCacheKey) : null;
			if (cached) {
				booking = cached;
				usingCache = true;
			} else {
				loadError = bR.reason?.message || 'Gagal memuat data peminjaman.';
			}
		}
		loading = false;
	}

	onMount(() => {
		if (!bookingId) {
			loadError = 'ID peminjaman tidak valid.';
			loading = false;
			return;
		}
		try {
			txnId = sessionStorage.getItem(txnKey) || '';
			if (!txnId) {
				txnId = crypto.randomUUID();
				sessionStorage.setItem(txnKey, txnId);
			}
		} catch {
			txnId = crypto.randomUUID();
		}
		loadPage();
	});

	// Template tanpa item "dashboard": foto dashboard kini kolom foto tersendiri (bukan status OK/Rusak).
	let template = $derived(
		normalizeP2HTemplate(meta?.settings?.checklist_template_peminjam || []).filter((t) => t.key !== 'dashboard')
	);
	let adaRusak = $derived(Object.values(itemStatus).some((v) => v !== 'ok'));
	let kritisLabels = $derived(template.filter((t) => t.kritis).map((t) => t.label));
	let semuaTerpilih = $derived(template.length > 0 && template.every((t) => !!itemStatus[t.key]));
	let gaWa = $derived<string | null>(((meta as any)?.kontak_ga_wa as string | undefined) || readSession<string>(gaWaCacheKey) || null);

	const fmtKm = (v: unknown) => (Number(v) > 0 ? Number(v).toLocaleString('id-ID') : '');
	let kmHint = $derived.by(() => {
		const ref = tahap === 'setelah' && !lupaSebelum ? booking?.km_awal : (booking?.vehicle as any)?.km_terakhir ?? (booking?.vehicle as any)?.odometer;
		const label = tahap === 'setelah' && !lupaSebelum ? 'KM awal tercatat' : 'KM terakhir tercatat';
		const teks = fmtKm(ref);
		return teks ? `${label}: ${teks} — ketik angka yang terlihat di dashboard sekarang.` : 'Ketik angka yang terlihat di dashboard sekarang.';
	});

	// Alasan tombol nonaktif — dijelaskan di bawah tombol (bukan diam).
	let blokirAlasan = $derived.by(() => {
		if (submitting) return '';
		if (!semuaTerpilih) return 'Pilih kondisi semua item — atau ketuk "Semua Baik" bila semuanya baik.';
		if (kmSaatCek == null || !(Number(kmSaatCek) > 0)) return 'Isi angka KM (odometer) dulu.';
		if (adaRusak && meta?.settings?.foto_checklist_wajib && !fotoFile) return 'Ambil foto kerusakan dulu (ada item bermasalah).';
		if (perluAlasanKm && !kmKoreksiAlasan.trim()) return 'Jelaskan kenapa KM lebih kecil (odometer rusak/diganti).';
		return '';
	});

	async function handleSubmit() {
		if (!booking || blokirAlasan) return;
		submitError = '';
		needDispensation = false;
		networkPending = false;

		// Semua item kritis "baik" → minta pernyataan sadar (P2H bukan formalitas satu ketukan).
		const kritisSemuaOk = template.filter((t) => t.kritis).every((t) => itemStatus[t.key] === 'ok');
		if (kritisSemuaOk && kritisLabels.length > 0 && tahap !== 'setelah') {
			const setuju = confirm(`Anda menyatakan ${kritisLabels.join(', ')} sudah dicek dan dalam kondisi baik?`);
			if (!setuju) return;
		}

		if (!firstSubmitAt) firstSubmitAt = new Date().toISOString();
		submitting = true;
		try {
			const items: ChecklistItemInput[] = template.map((t) => ({
				key: t.key,
				label: t.label,
				kritis: t.kritis,
				status: itemStatus[t.key] || 'ok'
			}));
			const [compressedFoto, compressedDash] = await Promise.all([
				fotoFile ? compressPhoto(fotoFile) : Promise.resolve(null),
				fotoDashboardFile ? compressPhoto(fotoDashboardFile) : Promise.resolve(null)
			]);
			const result = await submitFleetChecklist({
				bookingId,
				tahap,
				items,
				kmSaatCek: Number(kmSaatCek),
				temuan: temuan.trim() || undefined,
				foto: compressedFoto,
				fotoDashboard: compressedDash,
				clientTxnId: txnId || undefined,
				kmKoreksiAlasan: perluAlasanKm ? kmKoreksiAlasan.trim() : undefined,
				lupaSebelum,
				clientCreatedAt: firstSubmitAt
			});
			try {
				sessionStorage.removeItem(txnKey);
			} catch {
				/* abaikan */
			}
			if (result.blocked) {
				resultBlocked = true;
				resultWorkOrderId = result.work_order?.id || null;
			} else {
				resultAlready = !!result.already;
				resultSuccess = true;
				setTimeout(() => goto('/ess/kendaraan'), 1800);
			}
		} catch (err: any) {
			if (isNetworkError(err)) {
				// Peminjaman 08 Fase B: tidak ada sinyal → simpan di HP (antrean offline). Aman walau request sempat sampai
				// server: pengiriman ulang idempoten lewat client_txn_id yang sama. Peminjam boleh berangkat/pulang.
				const queued = await simpanKeAntrean();
				if (!queued) networkPending = true; // IndexedDB tidak tersedia → jalur manual "Kirim Lagi"
			} else if (err?.code === 'KM_MUNDUR') {
				perluAlasanKm = true;
				submitError = err.message;
			} else {
				submitError = err?.message || 'Gagal menyimpan checklist.';
				needDispensation = err?.code === 'CHECKIN_REQUIRED';
			}
		} finally {
			submitting = false;
		}
	}

	async function simpanKeAntrean(): Promise<boolean> {
		try {
			const compressedFoto = fotoFile ? await compressPhoto(fotoFile) : null;
			const compressedDash = fotoDashboardFile ? await compressPhoto(fotoDashboardFile) : null;
			await enqueueP2H({
				client_txn_id: txnId || crypto.randomUUID(),
				bookingId,
				tahap: tahap === 'setelah' ? 'setelah' : 'sebelum',
				items: template.map((t) => ({ key: t.key, label: t.label, kritis: t.kritis, status: itemStatus[t.key] || 'ok' })),
				kmSaatCek: Number(kmSaatCek),
				temuan: temuan.trim() || null,
				kmKoreksiAlasan: perluAlasanKm ? kmKoreksiAlasan.trim() : null,
				lupaSebelum,
				fotoBlob: compressedFoto,
				fotoName: compressedFoto?.name || null,
				fotoDashboardBlob: compressedDash,
				createdAt: firstSubmitAt || new Date().toISOString(),
				userId: currentP2HUserId()
			});
			try {
				sessionStorage.removeItem(txnKey);
			} catch {
				/* abaikan */
			}
			// Kondisi tidak laik sudah terlihat dari isian peminjam meski server belum bisa dihubungi.
			queuedTidakLaik = template.some((t) => t.kritis && itemStatus[t.key] && itemStatus[t.key] !== 'ok');
			resultQueued = true;
			setTimeout(() => goto('/ess/kendaraan'), queuedTidakLaik ? 6000 : 2500);
			return true;
		} catch (e) {
			console.error('[p2h] gagal menyimpan ke antrean offline:', e);
			return false;
		}
	}

	// Fase 3 G7 — permintaan dispensasi GA saat check-in belum ada
	let needDispensation = $state(false);
	let dispReason = $state('');
	let dispSending = $state(false);
	let dispSent = $state(false);
	let dispWaTerkirim = $state(true); // false → WA ke GA tidak terkirim: peminjam diberi jalan menghubungi GA langsung
	let dispError = $state('');
	async function kirimPermintaanDispensasi() {
		if (dispReason.trim().length < 10) {
			dispError = 'Jelaskan singkat kenapa check-in tidak dilakukan (min. 10 karakter).';
			return;
		}
		dispSending = true;
		dispError = '';
		try {
			const r = await requestCheckinDispensation(bookingId, dispReason.trim());
			dispWaTerkirim = r?.wa_terkirim !== false;
			dispSent = true;
		} catch (e: any) {
			dispError = e?.message || 'Gagal mengirim permintaan dispensasi.';
		} finally {
			dispSending = false;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 md:p-6 pb-24">
	<button
		class="flex items-center gap-1 text-xs font-semibold mb-4"
		style="color: var(--sys-label3)"
		onclick={() => goto('/ess/kendaraan')}
	>
		<IconArrowLeft size={14} /> Kembali
	</button>

	{#if loading}
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat checklist kendaraan..." />
	{:else if loadError || !booking}
		<!-- Peminjaman 08 §3.6 — jangan render form tanpa data peminjaman -->
		<div class="text-center py-12 px-4">
			<IconAlertTriangle size={48} class="mx-auto mb-3 text-amber-500" />
			<h2 class="text-base font-bold" style="color: var(--sys-label)">Data peminjaman belum bisa dimuat</h2>
			<p class="text-xs mt-2 max-w-sm mx-auto" style="color: var(--sys-label3)">
				{loadError || 'Sinyal lemah atau server sibuk.'} Periksa sinyal lalu coba lagi.
			</p>
			<div class="mt-5 flex flex-col sm:flex-row items-center justify-center gap-2">
				<button class="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600" onclick={loadPage}>Coba Lagi</button>
				{#if gaWa}
					<a
						href="https://wa.me/{gaWa}"
						target="_blank"
						rel="noreferrer"
						class="px-5 py-2.5 rounded-xl text-xs font-bold border border-green-300 text-green-700 flex items-center gap-1.5"
					>
						<IconBrandWhatsapp size={15} /> Chat GA
					</a>
				{/if}
			</div>
		</div>
	{:else if resultQueued}
		<div class="text-center py-12 px-4">
			{#if queuedTidakLaik}
				<IconAlertTriangle size={56} class="mx-auto mb-4 text-rose-500" />
				<h2 class="text-lg font-bold text-rose-600">JANGAN pakai kendaraan ini. Hubungi GA.</h2>
				<p class="text-xs mt-2 max-w-sm mx-auto" style="color: var(--sys-label3)">
					Ada item kritis bermasalah. P2H tersimpan di HP dan akan terkirim otomatis saat ada sinyal — GA baru diberi tahu setelah terkirim, jadi hubungi GA langsung sekarang.
				</p>
				{#if gaWa}
					<div class="mt-4 flex flex-col items-center gap-2">
						<a href="tel:+{gaWa}" class="px-5 py-3 rounded-xl text-sm font-bold text-white bg-rose-600">Telepon GA</a>
						<a href="https://wa.me/{gaWa}" target="_blank" rel="noreferrer" class="px-5 py-3 rounded-xl text-sm font-bold text-white bg-green-600 flex items-center gap-2"><IconBrandWhatsapp size={18} /> Chat GA</a>
					</div>
				{/if}
			{:else}
				<IconCircleCheck size={56} class="mx-auto mb-4 text-emerald-500" />
				<h2 class="text-lg font-bold" style="color: var(--sys-label)">Tersimpan di HP</h2>
				<p class="text-xs mt-2 max-w-sm mx-auto" style="color: var(--sys-label3)">
					Akan terkirim otomatis saat ada sinyal. Anda boleh {tahap === 'setelah' ? 'pulang' : 'berangkat'}.
				</p>
			{/if}
			<button class="mt-6 px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-700" onclick={() => goto('/ess/kendaraan')}>Kembali ke Peminjaman Saya</button>
		</div>
	{:else if resultSuccess}
		<div class="text-center py-16">
			<IconCircleCheck size={56} class="mx-auto mb-4 text-emerald-500" />
			<h2 class="text-lg font-bold" style="color: var(--sys-label)">
				{tahap === 'sebelum' ? 'Kendaraan siap dipakai' : tahap === 'setelah' ? 'Pengembalian tercatat' : 'Checklist tersimpan'}
			</h2>
			{#if resultAlready}
				<p class="text-xs mt-1 text-emerald-700">Sudah tercatat sebelumnya — tidak perlu diisi ulang.</p>
			{/if}
			<p class="text-xs mt-1" style="color: var(--sys-label3)">Mengalihkan ke halaman peminjaman…</p>
		</div>
	{:else if resultBlocked}
		<div class="text-center py-12 px-4">
			<IconAlertTriangle size={56} class="mx-auto mb-4 text-rose-500" />
			<h2 class="text-lg font-bold text-rose-600">Kendaraan tidak laik jalan</h2>
			<p class="text-sm font-semibold mt-2" style="color: var(--sys-label)">Jangan pakai kendaraan ini. GA sudah diberi tahu.</p>
			<p class="text-xs mt-2 max-w-sm mx-auto" style="color: var(--sys-label3)">
				{resultWorkOrderId ? 'Tiket perbaikan otomatis sudah dibuat. ' : ''}Minta unit pengganti ke GA sebelum melanjutkan perjalanan.
			</p>
			<div class="mt-5 flex flex-col items-center gap-2">
				{#if gaWa}
					<a
						href="https://wa.me/{gaWa}?text={encodeURIComponent(`Unit ${booking?.vehicle?.name || ''} (${booking?.vehicle?.nomor_polisi || ''}) tidak laik di P2H ${booking?.kode_booking || ''}. Mohon unit pengganti.`)}"
						target="_blank"
						rel="noreferrer"
						class="px-5 py-3 rounded-xl text-sm font-bold text-white bg-green-600 flex items-center gap-2"
					>
						<IconBrandWhatsapp size={18} /> Chat GA — minta unit pengganti
					</a>
				{/if}
				<button class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-slate-700" onclick={() => goto('/ess/kendaraan')}>
					Kembali ke Peminjaman Saya
				</button>
			</div>
		</div>
	{:else}
		{#if usingCache}
			<div class="mb-3 p-2.5 rounded-xl text-[11px] font-medium bg-amber-50 border border-amber-200 text-amber-800">
				Sinyal lemah — memakai data peminjaman yang tersimpan di HP. Checklist tetap bisa diisi.
				<button class="font-bold underline ml-1" onclick={loadPage}>Coba Muat Ulang</button>
			</div>
		{/if}
		<div class="mb-5">
			<h1 class="text-lg font-bold" style="color: var(--sys-label)">Checklist Kendaraan</h1>
			<p class="text-xs" style="color: var(--sys-label3)">
				{booking?.kode_booking} — {booking?.vehicle?.name} ({booking?.vehicle?.nomor_polisi})
			</p>
			<div class="flex items-center gap-1.5 mt-3">
				{#each LANGKAH as l, i}
					<div class="flex-1 h-1.5 rounded-full {langkahAktif > i + 1 ? 'bg-blue-600' : langkahAktif === i + 1 ? 'bg-blue-500' : 'bg-slate-200 dark:bg-slate-700'}"></div>
				{/each}
			</div>
			<p class="text-[11px] font-bold mt-1.5" style="color: var(--sys-label2)">
				{LANGKAH.map((l, i) => `${['①', '②'][i]} ${l.label}`).join(' → ')} · sekarang: {TAHAP_LABEL[tahap]}
			</p>
			<FieldHint text={h('checklist.kenapa').fieldHint} />
		</div>

		{#if lupaSebelum}
			<div class="mb-4 p-3 rounded-xl text-[11px] bg-amber-50 border border-amber-200 text-amber-800">
				Anda menandai <strong>sudah berangkat tanpa P2H sebelum pakai</strong>. Tidak apa-apa — isi kondisi kendaraan dan KM di dashboard
				<strong>sekarang</strong>. Pengembalian tetap dicatat (ditandai untuk GA).
			</div>
		{/if}

		<P2HChecklistForm
			{template}
			bind:itemStatus
			bind:kmSaatCek
			bind:temuan
			bind:fotoFile
			bind:fotoDashboardFile
			pemilihanEksplisit={true}
			kmLabel="Angka Odometer (KM)"
			{kmHint}
			disabled={submitting}
		/>
		<FieldHint text={h('checklist.foto_odometer').fieldHint} />

		{#if perluAlasanKm}
			<div class="mb-4 p-3.5 rounded-xl bg-amber-50 border border-amber-200">
				<p class="text-xs font-bold text-amber-800 mb-1.5">KM lebih kecil dari KM awal</p>
				<p class="text-[11px] text-amber-700 mb-2">Periksa lagi angka yang Anda ketik. Bila memang benar (odometer rusak/diganti), jelaskan di sini lalu kirim ulang.</p>
				<textarea
					bind:value={kmKoreksiAlasan}
					rows={2}
					placeholder="Jelaskan (odometer rusak/diganti)…"
					class="w-full px-3 py-2 rounded-lg text-xs bg-white border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
				></textarea>
			</div>
		{/if}

		{#if networkPending}
			<div class="mb-3 p-3 rounded-xl text-xs font-medium bg-amber-50 border border-amber-200 text-amber-800">
				Belum pasti terkirim karena sinyal. <strong>Jangan isi ulang.</strong> Tekan <strong>Kirim Lagi</strong> — sistem mencegah data dobel.
			</div>
		{/if}

		{#if submitError}
			<p class="text-xs text-rose-600 font-semibold mb-3">{submitError}</p>
		{/if}

		{#if needDispensation}
			<div class="mb-4 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40">
				{#if dispSent}
					<p class="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
						<IconCircleCheck size={15} />
						{dispWaTerkirim
							? 'Permintaan dispensasi terkirim ke GA. Tunggu GA memberi dispensasi di ERP, lalu ulangi pengembalian.'
							: 'Permintaan tercatat, tetapi WA ke GA tidak terkirim. Hubungi GA langsung agar dispensasi segera diberikan.'}
					</p>
					{#if !dispWaTerkirim && gaWa}
						<a href="https://wa.me/{gaWa}" target="_blank" rel="noreferrer" class="mt-2 inline-flex px-4 py-2 rounded-lg text-xs font-bold text-white bg-green-600 items-center gap-1.5"><IconBrandWhatsapp size={14} /> Chat GA</a>
					{/if}
				{:else}
					<p class="text-xs font-bold text-amber-800 dark:text-amber-300 mb-1.5">Check-in gagal / terlewat?</p>
					<p class="text-[11px] text-amber-700 dark:text-amber-400 mb-2">
						Minta dispensasi ke GA. Jelaskan singkat alasannya (mis. sinyal/kamera bermasalah, lupa). GA akan diberi tahu lewat WhatsApp.
					</p>
					<textarea
						bind:value={dispReason}
						rows={2}
						placeholder="Alasan check-in tidak dilakukan…"
						class="w-full px-3 py-2 rounded-lg text-xs bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 mb-2"
					></textarea>
					{#if dispError}<p class="text-[11px] text-rose-600 font-semibold mb-2">{dispError}</p>{/if}
					<button
						class="w-full py-2 rounded-lg text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
						disabled={dispSending}
						onclick={kirimPermintaanDispensasi}
					>
						{#if dispSending}<IconLoader2 size={14} class="animate-spin" />{/if}
						Minta Dispensasi GA
					</button>
				{/if}
			</div>
		{/if}

		<button
			class="w-full py-3 rounded-xl text-sm font-bold text-white bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
			disabled={submitting || !!blokirAlasan}
			onclick={handleSubmit}
		>
			{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
			{#if networkPending}
				Kirim Lagi
			{:else}
				{tahap === 'sebelum' ? 'Kendaraan Siap, Mulai Pakai' : tahap === 'setelah' ? 'Selesai, Kembalikan Kendaraan' : 'Simpan Checklist'}
			{/if}
		</button>
		{#if blokirAlasan}
			<p class="text-[11px] mt-2 text-center font-medium text-amber-700">{blokirAlasan}</p>
		{/if}
	{/if}
</div>
