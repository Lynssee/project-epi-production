<script lang="ts">
	// GSP-08 §4.1 / GSP-09 — form pemeriksaan SJ di gerbang, SATU komponen untuk app HP (mode 'app') dan
	// kiosk (mode 'kiosk'). Semua aturan datang dari server (detail.can_pass / blockers / pesan);
	// komponen ini hanya mengumpulkan cek fisik. TIDAK ada pra-centang dan TIDAK ada "centang semua".
	import { onMount } from 'svelte';
	import { IconCheck, IconX, IconLoader2, IconPhoto, IconMinus, IconPlus, IconAlertTriangle } from '@tabler/icons-svelte';
	import type { GerbangApi, GDetail, GHasil } from '$lib/services/gerbangSjApi';
	import { GerbangApiError } from '$lib/services/gerbangSjApi';
	import { KATEGORI_TAHAN_LABEL, TEKS, kurangText, menitText } from '$lib/data/gerbangSjTeks';
	import { secureAssetSrc } from '$lib/actions/secureAsset';

	interface Props {
		detail: GDetail;
		api: GerbangApi;
		mode?: 'app' | 'kiosk';
		onDone: (r: GHasil) => void;
		onClose: () => void;
		/** SJH-13: kirim pemberitahuan in-app ke pihak yang harus bertindak (kiosk). Tanpa prop ini tombol tidak tampil. */
		onBeritahu?: (siapa: string) => void;
		notifying?: string;
	}
	let { detail, api, mode = 'app', onDone, onClose, onBeritahu, notifying = '' }: Props = $props();

	const big = $derived(mode === 'kiosk');
	const sj = $derived(detail.sj);
	const acuan = $derived(sj.koli_acuan);
	const isPrePrint = $derived(sj.draft_status === 'menunggu_verifikasi' || (sj.status === 'needs_security_check' && (sj.print_count ?? 0) === 0));

	// client_event_id dibuat SEKALI per form yang dibuka (anti klik ganda / ulang kirim).
	const clientEventId = `gerbang-${crypto.randomUUID()}`;

	let platOk = $state(false);
	let driverOk = $state(false);
	let koliDihitung = $state<number | null>(null);
	let itemState = $state<Record<number, 'ok' | 'bad' | undefined>>({});
	let itemNote = $state<Record<number, string>>({});
	let catatan = $state('');
	let fotoId = $state<string | null>(null);
	let fotoPreview = $state<string | null>(null);
	let fotoUploading = $state(false);
	let gps = $state<{ lat: number; lng: number; accuracy: number } | null>(null);
	let tahanOpen = $state(false);
	let kategori = $state<string | null>(null);
	let alasan = $state('');
	let confirmOpen = $state(false);
	let busy = $state(false);
	let errorMsg = $state('');
	let fotoInput: HTMLInputElement;

	onMount(async () => {
		// GPS opsional, timeout 4 dtk — gagal tidak menghalangi pengiriman.
		try {
			const { getCurrentPosition } = await import('$lib/utils/geoClient');
			gps = await getCurrentPosition({ timeout: 4000, enableHighAccuracy: true });
		} catch {
			gps = null;
		}
	});

	const koliOk = $derived(acuan == null ? koliDihitung != null : koliDihitung === acuan);
	const dicek = $derived(detail.items.filter((i) => itemState[i.id]).length);
	const adaBad = $derived(detail.items.some((i) => itemState[i.id] === 'bad'));
	const belumItem = $derived(detail.items.length - dicek);
	const kurang = $derived(kurangText({ plat: !platOk, driver: !driverOk, koli: !koliOk, barang: belumItem }));
	const fotoOk = $derived(!!fotoId);
	const bisaLoloskan = $derived(detail.can_pass && !detail.already_passed && !kurang && !adaBad && !busy && fotoOk);

	// Kategori tahan otomatis terpilih bila ada cek yang gagal.
	const kategoriSaran = $derived(
		adaBad ? 'item' : koliDihitung != null && acuan != null && koliDihitung !== acuan ? 'koli' : null
	);
	$effect(() => {
		if (tahanOpen && !kategori && kategoriSaran) kategori = kategoriSaran;
	});

	function setKoli(n: number) {
		koliDihitung = Math.max(0, Math.min(9999, n));
	}

	async function pilihFoto(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		fotoUploading = true;
		errorMsg = '';
		try {
			const { compressPhoto } = await import('$lib/utils/photoCompress');
			const file = f.type.startsWith('image/') ? await compressPhoto(f) : f;
			fotoPreview = URL.createObjectURL(file);
			fotoId = await api.foto(sj.id, file);
		} catch (err) {
			fotoPreview = null;
			fotoId = null;
			errorMsg = err instanceof Error ? err.message : 'Gagal mengunggah foto.';
		}
		fotoUploading = false;
		if (fotoInput) fotoInput.value = '';
	}

	function itemsPayload() {
		return detail.items
			.filter((i) => itemState[i.id])
			.map((i) => ({ sj_item_id: i.id, ok: itemState[i.id] === 'ok', catatan: itemNote[i.id]?.trim() || null }));
	}

	async function kirim(fn: () => Promise<GHasil>) {
		busy = true;
		errorMsg = '';
		try {
			onDone(await fn());
		} catch (err) {
			errorMsg = err instanceof GerbangApiError || err instanceof Error ? err.message : 'Gagal menyimpan.';
			confirmOpen = false;
		}
		busy = false;
	}

	function loloskan() {
		kirim(() =>
			api.loloskan(sj.id, {
				client_event_id: clientEventId,
				checklist: { jumlah_ok: koliOk, plat_ok: platOk, driver_ok: driverOk },
				koli_dihitung: koliDihitung,
				items: itemsPayload(),
				foto_file_id: fotoId,
				gps,
				catatan: catatan.trim() || null
			})
		);
	}

	function simpanTahan() {
		errorMsg = '';
		if (!kategori) { errorMsg = 'Pilih kategori masalahnya.'; return; }
		if (alasan.trim().length < 5) { errorMsg = 'Tulis alasan menahan (minimal 5 huruf).'; return; }
		if (detail.items.some((i) => itemState[i.id] === 'bad' && !itemNote[i.id]?.trim())) {
			errorMsg = TEKS.catatanSelisihWajib + '.';
			return;
		}
		kirim(() =>
			api.tahan(sj.id, {
				client_event_id: clientEventId,
				alasan: alasan.trim(),
				kategori,
				checklist: { jumlah_ok: koliDihitung == null ? null : koliOk, plat_ok: platOk, driver_ok: driverOk },
				koli_dihitung: koliDihitung,
				items: itemsPayload(),
				foto_file_id: fotoId,
				gps
			})
		);
	}

	const btn = $derived(big ? 'py-4 text-[16px]' : 'py-2.5 text-[13px]');
	const tog = (on: boolean) => `background:${on ? '#16a34a' : 'white'};color:${on ? 'white' : '#334155'};border:1px solid ${on ? '#16a34a' : '#cbd5e1'}`;
</script>

<div class="rounded-xl p-4 mb-4 shadow-sm" style="background: var(--gl); border: 2px solid var(--g)">
	<!-- 1. Kepala SJ -->
	<div class="flex items-start justify-between mb-2 pb-2 border-b" style="border-color: var(--sys-sep)">
		<div class="min-w-0">
			{#if isPrePrint}
				<div class="flex items-center gap-1.5 flex-wrap">
					<span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">Cek Fisik Lapangan (Pre-Cetak)</span>
					{#if sj.admin_verif_oleh}
						<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">✓ Admin: Sesuai</span>
					{:else}
						<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">⏳ Admin: Menunggu</span>
					{/if}
				</div>
			{:else}
				<span class="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-700">Periksa di Gerbang</span>
			{/if}
			<h3 class="{big ? 'text-[22px]' : 'text-[15px]'} font-bold text-gray-900 mt-1 break-all">{sj.nomor_sj}</h3>
			{#if sj.tujuan}<p class="text-[12px] text-gray-600">{sj.tujuan}</p>{/if}
			<p class="text-[11px] text-gray-500">{menitText(sj.menunggu_menit)}</p>
		</div>
		<button class="text-xs text-gray-500 font-semibold shrink-0 ml-2" onclick={onClose} disabled={busy}>Tutup</button>
	</div>

	<!-- Hint Verifikasi Pre-Cetak -->
	{#if isPrePrint}
		<div class="rounded-lg p-2.5 mb-3 text-[12px] bg-amber-50/90 border border-amber-300 text-amber-900 flex items-start gap-2 shadow-xs">
			<IconAlertTriangle size={16} class="shrink-0 mt-0.5 text-amber-600" />
			<div>
				<span class="font-bold">Verifikasi Fisik Pra-Cetak:</span> Periksa kuantitas & kondisi barang riil di lapangan/kendaraan sebelum Surat Jalan Resmi dicetak.
				<span class="block text-[11px] text-amber-800 mt-0.5">Jika ada selisih, tekan <b>Ada Selisih / Revisi</b>. Jika seluruhnya cocok, ambil foto muatan dan tekan <b>Verifikasi Sesuai</b>.</span>
			</div>
		</div>
	{/if}

	<!-- 2. Blok status dari server -->
	{#if detail.already_passed}
		<div class="rounded-lg p-2.5 mb-3 text-[12px]" style="background:#dcfce7;border:1px solid #86efac;color:#166534">
			Sudah lolos oleh {sj.security_verified_by || 'petugas lain'}. Tidak perlu tindakan.
		</div>
	{:else}
		{#if detail.blockers.length > 0}
			<div class="rounded-lg p-2.5 mb-3 text-[12px]" style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b">
				{#each detail.blockers as b}
					<p class="flex gap-1.5"><IconAlertTriangle size={14} class="shrink-0 mt-0.5" /><span>{b.pesan}{b.siapa ? ` Hubungi: ${b.siapa}.` : ''}
						{#if onBeritahu && b.siapa}<button class="ml-1 px-2 py-0.5 rounded border border-red-700 bg-white text-red-700 text-[11px] font-bold disabled:opacity-50" disabled={!!notifying} title="Kirim notifikasi ke {b.siapa}. Maksimal sekali per 15 menit per SJ." onclick={() => onBeritahu?.(b.siapa ?? '')}>{notifying === b.siapa ? 'Mengirim…' : 'Kirim pemberitahuan'}</button>{/if}</span></p>
				{/each}
				<p class="mt-1 text-[11px]">Loloskan disembunyikan. Anda tetap bisa menekan Tahan untuk mencatat.</p>
			</div>
		{/if}
		{#if detail.ditahan && detail.checklist}
			<div class="rounded-lg p-2.5 mb-3 text-[12px]" style="background:#ffedd5;border:1px solid #fdba74;color:#9a3412">
				Pernah DITAHAN oleh {detail.checklist.oleh_nama || '-'}{detail.checklist.alasan ? `: ${detail.checklist.alasan}` : ''}. Periksa ulang; bila sudah beres, Loloskan.
			</div>
		{/if}
		{#each detail.warnings.filter((w) => w.kode !== 'PERNAH_DITAHAN') as w}
			<div class="rounded-lg p-2 mb-2 text-[11px]" style="background:#fef9c3;border:1px solid #fde047;color:#854d0e">{w.pesan}</div>
		{/each}

		<!-- 3. Plat & driver -->
		<div class="grid grid-cols-2 gap-2 mb-3 p-2 rounded bg-white/70 text-[12px]">
			<div><span class="text-gray-500">Plat di SJ:</span> <b>{sj.plat || '-'}</b></div>
			<div><span class="text-gray-500">Driver di SJ:</span> <b>{sj.driver || '-'}</b></div>
			<button class="rounded-lg font-semibold {btn}" style={tog(platOk)} onclick={() => (platOk = !platOk)}>
				{#if platOk}<IconCheck size={14} class="inline" />{/if} {TEKS.platSesuai}
			</button>
			<button class="rounded-lg font-semibold {btn}" style={tog(driverOk)} onclick={() => (driverOk = !driverOk)}>
				{#if driverOk}<IconCheck size={14} class="inline" />{/if} {TEKS.driverSesuai}
			</button>
		</div>

		<!-- 4. Koli -->
		<div class="mb-3 p-2 rounded bg-white/70">
			<p class="text-[12px] mb-1.5">
				<span class="text-gray-500">Koli di SJ:</span>
				<b>{acuan ?? 'tidak tercatat — hitung sendiri'}</b>
				{#if sj.koli_sumber}<span class="text-[10px] text-gray-400">({sj.koli_sumber === 'fleet' ? 'dari Fleet' : 'dari item'})</span>{/if}
			</p>
			<div class="flex items-center gap-2">
				<span class="text-[11px] text-gray-600">Koli dihitung</span>
				<button class="w-9 h-9 rounded-lg border flex items-center justify-center bg-white" onclick={() => setKoli((koliDihitung ?? 0) - 1)} aria-label="kurangi"><IconMinus size={16} /></button>
				<input class="w-16 text-center rounded-lg border py-1.5 text-[14px] bg-white" type="number" inputmode="numeric" min="0" value={koliDihitung ?? ''} oninput={(e) => { const v = (e.target as HTMLInputElement).value; koliDihitung = v === '' ? null : Number(v); }} />
				<button class="w-9 h-9 rounded-lg border flex items-center justify-center bg-white" onclick={() => setKoli((koliDihitung ?? 0) + 1)} aria-label="tambah"><IconPlus size={16} /></button>
			</div>
			<p class="text-[11px] mt-1.5 {koliDihitung == null ? 'text-gray-400' : koliOk ? 'text-green-700' : 'text-red-600'}">
				{#if koliDihitung == null}Hitung koli di kendaraan lalu isi angkanya.{:else if koliOk}<IconCheck size={12} class="inline" /> {TEKS.koliSesuai}.{:else}Beda dari SJ ({acuan}). Tekan Tahan bila memang kurang/lebih.{/if}
			</p>
		</div>

		<!-- 5. Barang: tanpa pra-centang -->
		<div class="mb-3">
			<p class="text-[12px] font-bold text-gray-800 mb-1.5">Barang ({dicek} dari {detail.items.length} dicek)</p>
			<div class="space-y-2">
				{#each detail.items as it (it.id)}
					<div class="p-2 rounded-lg border bg-white text-[12px]" style="border-color:{itemState[it.id] === 'bad' ? '#fca5a5' : '#cbd5e1'}">
						<div class="flex justify-between gap-2 font-semibold text-gray-900">
							<span>{it.nama_barang}</span>
							<span class="font-mono text-[11px] text-gray-700 shrink-0">{it.qty} {it.unit || ''}{it.koli != null ? ` · ${it.koli} koli` : ''}</span>
						</div>
						<div class="grid grid-cols-2 gap-2 mt-1.5">
							<button class="rounded-lg font-semibold py-1.5" style={tog(itemState[it.id] === 'ok')} onclick={() => (itemState[it.id] = 'ok')}>✓ {TEKS.barangAda}</button>
							<button class="rounded-lg font-semibold py-1.5" style="background:{itemState[it.id] === 'bad' ? '#dc2626' : 'white'};color:{itemState[it.id] === 'bad' ? 'white' : '#334155'};border:1px solid {itemState[it.id] === 'bad' ? '#dc2626' : '#cbd5e1'}" onclick={() => (itemState[it.id] = 'bad')}>✗ {TEKS.barangTidakSesuai}</button>
						</div>
						{#if itemState[it.id] === 'bad'}
							<input class="mt-1.5 w-full text-[11px] px-2.5 py-1.5 rounded border border-red-300 bg-red-50/50" placeholder={TEKS.catatanSelisihWajib} bind:value={itemNote[it.id]} />
						{/if}
					</div>
				{/each}
				{#if detail.items.length === 0}<p class="text-[11px] text-gray-400 italic">SJ ini belum punya rincian barang.</p>{/if}
			</div>
		</div>

		<!-- 5a. Foto Acuan Gudang (Multi-Crosscheck) -->
		{#if sj.foto_gudang_id}
			<div class="mb-3 p-2.5 rounded-lg border border-blue-200 bg-blue-50/70 text-[12px]">
				<p class="font-bold text-blue-900 mb-1.5 flex items-center gap-1.5">
					<span>📸</span>
					<span>Foto Acuan Gudang (Saat Disiapkan/Packing):</span>
				</p>
				<div class="flex items-center gap-3">
					<a href={'/assets/' + sj.foto_gudang_id} target="_blank" rel="noopener noreferrer" class="block w-16 h-16 rounded-lg overflow-hidden border border-blue-300 bg-white shrink-0 shadow-xs" title="Buka foto packing gudang">
						<img use:secureAssetSrc={sj.foto_gudang_id} alt="Foto Gudang" class="w-full h-full object-cover" />
					</a>
					<div class="text-[11px] text-gray-700 leading-tight">
						Disiapkan oleh: <b>{sj.gudang_disiapkan_oleh || 'Staf Gudang'}</b><br/>
						{#if sj.admin_verif_oleh}<span class="text-emerald-700 font-semibold">✓ Diverifikasi Admin: {sj.admin_verif_oleh}</span><br/>{/if}
						Periksa muatan fisik di kendaraan sesuai dengan foto packing gudang ini.
					</div>
				</div>
			</div>
		{/if}

		<!-- 6-7. Foto Gerbang (Wajib) & catatan -->
		<div class="p-2.5 rounded-lg border {fotoOk ? 'border-emerald-300 bg-emerald-50/50' : 'border-amber-300 bg-amber-50/60'} mb-3">
			<div class="flex items-center gap-3">
				<button class="w-16 h-16 rounded-lg border-2 {fotoOk ? 'border-emerald-500' : 'border-dashed border-amber-500'} flex items-center justify-center overflow-hidden bg-white shrink-0" onclick={() => fotoInput?.click()} disabled={fotoUploading || busy}>
					{#if fotoUploading}
						<IconLoader2 size={20} class="animate-spin text-amber-600" />
					{:else if fotoPreview}
						<img src={fotoPreview} alt="Foto muatan di gerbang" class="w-full h-full object-cover" />
					{:else}
						<div class="text-center text-amber-600">
							<IconPhoto size={24} class="mx-auto" />
							<span class="text-[9px] font-bold block">AMBIL FOTO</span>
						</div>
					{/if}
				</button>
				<input bind:this={fotoInput} type="file" accept="image/*" capture="environment" class="hidden" onchange={pilihFoto} />
				<div class="text-[12px]">
					<span class="font-bold {fotoOk ? 'text-emerald-800' : 'text-amber-900'} block">
						{fotoOk ? (isPrePrint ? '✓ Foto Muatan Lapangan Tersimpan' : '✓ Foto Muatan Gerbang Tersimpan') : (isPrePrint ? 'Foto Muatan Fisik Lapangan (Wajib) *' : 'Foto Gerbang (Wajib Ambil Foto Muatan / Plat) *')}
					</span>
					<span class="text-[11px] text-gray-600 block mt-0.5">
						{fotoOk ? (isPrePrint ? 'Foto tersimpan dan siap diverifikasi.' : 'Foto tersimpan dan siap diloloskan.') : (isPrePrint ? 'Ambil foto muatan fisik riil di kendaraan / lapangan.' : 'Ambil foto kendaraan dan muatan sebelum meloloskan keluar.')}
					</span>
				</div>
			</div>
		</div>
		<textarea class="w-full rounded-lg px-3 py-2 text-[12px] mb-3 bg-white border border-gray-300" rows="2" placeholder={isPrePrint ? "Catatan pemeriksaan fisik lapangan (opsional)" : "Catatan pemeriksaan gerbang (opsional)"} bind:value={catatan}></textarea>

		{#if errorMsg}<div class="rounded-lg p-2.5 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}

		<!-- 8. Aksi -->
		{#if tahanOpen}
			<div class="rounded-lg p-2.5 mb-3 border" style="background:#fff;border-color:#fca5a5">
				<p class="text-[12px] font-bold text-red-700 mb-1.5">{isPrePrint ? 'Catat Selisih / Revisi Fisik' : 'Tahan SJ — pilih masalahnya'}</p>
				<div class="flex flex-wrap gap-1.5 mb-2">
					{#each Object.entries(KATEGORI_TAHAN_LABEL) as [k, label]}
						<button class="rounded-lg px-3 py-1.5 text-[12px] font-semibold" style={tog(kategori === k).replace('#16a34a', '#dc2626')} onclick={() => (kategori = k)}>{label}</button>
					{/each}
				</div>
				<textarea class="w-full rounded-lg px-3 py-2 text-[12px] mb-2 bg-white border border-gray-300" rows="2" placeholder={isPrePrint ? "Tulis rincian selisih fisik (wajib, misal: fisik solar hanya 390 LTR dari permohonan 400 LTR)" : "Alasan (wajib, mis. Plat beda: B 1234 XY vs B 9876 ZZ)"} bind:value={alasan}></textarea>
				<div class="flex gap-2">
					<button class="flex-1 rounded-lg {btn} font-semibold bg-gray-200 text-gray-700" onclick={() => (tahanOpen = false)} disabled={busy}>Batal</button>
					<button class="flex-1 rounded-lg {btn} font-semibold text-white disabled:opacity-50" style="background:#dc2626" disabled={busy} onclick={simpanTahan}>{busy ? 'Menyimpan…' : (isPrePrint ? 'Kirim Catatan Revisi' : 'Simpan Tahan')}</button>
				</div>
				<p class="text-[10px] text-gray-500 mt-1">{isPrePrint ? 'Status draft akan diubah menjadi Perlu Revisi sehingga Admin dapat menyesuaikan item.' : 'Gudang otomatis diberi tahu. SJ tetap di antrian sampai diperiksa ulang.'}</p>
			</div>
		{:else if confirmOpen}
			<div class="rounded-lg p-3 mb-3 text-center" style="background:#dcfce7;border:1px solid #86efac">
				<p class="text-[13px] font-semibold text-green-900 mb-2">{isPrePrint ? `Apakah seluruh fisik muatan untuk SJ ${sj.nomor_sj} sudah sesuai dan lolos verifikasi lapangan?` : TEKS.konfirmasiLoloskan(sj.nomor_sj)}</p>
				<div class="flex gap-2">
					<button class="flex-1 rounded-lg {btn} font-semibold bg-gray-200 text-gray-700" onclick={() => (confirmOpen = false)} disabled={busy}>Batal</button>
					<button class="flex-1 rounded-lg {btn} font-semibold text-white disabled:opacity-50" style="background:#16a34a" disabled={busy} onclick={loloskan}>{busy ? 'Menyimpan…' : (isPrePrint ? 'Ya, Verifikasi Sesuai' : 'Ya, Loloskan')}</button>
				</div>
			</div>
		{:else}
			<div class="flex gap-2">
				<button class="flex-1 rounded-lg {btn} font-semibold text-white flex items-center justify-center gap-1" style="background:#dc2626" onclick={() => { tahanOpen = true; errorMsg = ''; }}><IconX size={16} /> {isPrePrint ? 'Ada Selisih / Revisi' : 'Tahan'}</button>
				{#if detail.can_pass}
					<button class="flex-1 rounded-lg {btn} font-semibold text-white flex items-center justify-center gap-1 disabled:opacity-40" style="background:#16a34a" disabled={!bisaLoloskan} onclick={() => (confirmOpen = true)}><IconCheck size={16} /> {isPrePrint ? '✓ Verifikasi Lapangan Sesuai' : 'Loloskan Keluar'}</button>
				{/if}
			</div>
			{#if detail.can_pass && kurang}<p class="text-[11px] text-gray-500 mt-1.5">{kurang}</p>{/if}
			{#if adaBad}<p class="text-[11px] text-red-600 mt-1.5">Ada barang tidak sesuai — tidak bisa disetujui. Tekan {isPrePrint ? 'Ada Selisih / Revisi' : 'Tahan'}.</p>{/if}
			{#if detail.can_pass && !fotoOk && !kurang && !adaBad}
				<p class="text-[11px] text-amber-700 font-semibold mt-1.5 flex items-center gap-1">
					<IconAlertTriangle size={14} /> Wajib ambil foto muatan {isPrePrint ? 'lapangan' : 'gerbang'} sebelum tombol Verifikasi aktif.
				</p>
			{/if}
		{/if}
	{/if}

	<!-- 10. Riwayat gerbang -->
	{#if detail.riwayat_gerbang.length > 0}
		<details class="mt-3 text-[11px] text-gray-600">
			<summary class="cursor-pointer font-semibold">Riwayat gerbang ({detail.riwayat_gerbang.length})</summary>
			<ul class="mt-1 space-y-0.5">
				{#each detail.riwayat_gerbang as r}
					<li>{new Date(r.waktu).toLocaleString('id-ID')} — {r.catatan || r.tahap || '-'}</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>
