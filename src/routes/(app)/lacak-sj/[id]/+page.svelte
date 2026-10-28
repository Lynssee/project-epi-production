<script lang="ts">
	// src/routes/(app)/lacak-sj/[id]/+page.svelte
	// Timeline tahap Surat Jalan + aksi sesuai peran (driver / penerima / leader).
	// Tracking SJ v2 Fase 4.
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		IconArrowLeft, IconLoader2, IconAlertTriangle, IconCheck, IconMapPin,
		IconCamera, IconTruckDelivery, IconPackageImport, IconMessage2, IconClipboardCheck
	} from '@tabler/icons-svelte';
	import { submitProofOfDeliveryBlobs } from '$lib/services/proofOfDelivery';
	import { submitScanSjFisik } from '$lib/services/sjTunggakan';
	import { compressPhoto } from '$lib/utils/photoCompress';

	const id = page.params.id;
	let loading = $state(true);
	let err = $state('');
	let info = $state('');
	let data = $state<any>(null);
	let busy = $state('');

	function newCid(p: string) { return `lacak-${p}-${crypto.randomUUID()}`; }

	async function load() {
		loading = true; err = '';
		try {
			const res = await fetch(`/api/lacak-sj/${id}`);
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal memuat.');
			data = d;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function getGps(): Promise<any> {
		return new Promise((resolve) => {
			if (!navigator.geolocation) return resolve(null);
			navigator.geolocation.getCurrentPosition(
				(p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
				() => resolve(null), { timeout: 4000, maximumAge: 60000 }
			);
		});
	}

	async function markStage(stageTo: string) {
		busy = stageTo; err = ''; info = '';
		try {
			const gps = await getGps();
			const res = await fetch(`/api/lacak-sj/${id}/stage`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ stage_to: stageTo, gps, client_event_id: newCid(stageTo) })
			});
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal.');
			info = stageTo === 'dalam_perjalanan' ? 'Ditandai: dalam perjalanan.' : 'Ditandai: tiba di lokasi.';
			await load();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			busy = '';
		}
	}

	// Gate Ketat Surat Jalan v3 — Fase 5 (20 Sep 2026). Sebelum driver berangkat,
	// konfirmasi lembar wajib_kembali (Putih=finance, Pink=admin_peminjam) sudah
	// diserahkan bertanda tangan basah + stempel. N/A murni kalau kategori SJ ini
	// tidak punya lembar wajib_kembali (endpoint mengembalikan pending=[]).
	let pendingRangkap = $state<{ id: number; lembar_nama: string; warna_hex: string | null }[] | null>(null);
	let confirmingBerangkat = $state(false);

	async function startBerangkat() {
		busy = 'dalam_perjalanan'; err = '';
		try {
			const res = await fetch(`/api/lacak-sj/${id}/rangkap`);
			const d = await res.json().catch(() => ({ pending: [] }));
			if (d.pending && d.pending.length > 0) {
				pendingRangkap = d.pending;
				busy = '';
				return;
			}
			await markStage('dalam_perjalanan');
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal memeriksa rangkap dokumen.';
			busy = '';
		}
	}

	async function confirmRangkapDiserahkan() {
		confirmingBerangkat = true;
		try {
			await fetch(`/api/lacak-sj/${id}/rangkap`, { method: 'POST' });
			pendingRangkap = null;
			await markStage('dalam_perjalanan');
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal mencatat penyerahan lembar.';
		} finally {
			confirmingBerangkat = false;
		}
	}

	// POD ringan (foto wajib)
	let podFoto = $state<File | null>(null);
	let podPreview = $state<string | null>(null);
	let showPod = $state(false);
	function pickPod(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		if (podPreview) URL.revokeObjectURL(podPreview);
		podFoto = f; podPreview = URL.createObjectURL(f);
	}
	async function submitPod() {
		if (!podFoto) { err = 'Foto bukti serah-terima wajib.'; return; }
		busy = 'pod'; err = '';
		try {
			const gps = await getGps();
			// Pakai service yang sudah ada: unggah foto ke Directus lalu POST /api/scan/proof-of-delivery.
			await submitProofOfDeliveryBlobs({
				suratJalanId: Number(id),
				gps,
				photoBlob: podFoto
			});
			info = 'Proof of Delivery terkirim.';
			showPod = false;
			await load();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			busy = '';
		}
	}

	// Penajaman Gate SJ Fase 3 — Foto SJ fisik bertanda tangan lengkap (panduan bingkai A4 + checklist).
	let showScan = $state(false);
	let scanFoto = $state<File | null>(null);
	let scanPreview = $state<string | null>(null);
	let scanChecks = $state({ gudang: false, driver: false, penerima: false, stempel: false });
	const scanLengkap = $derived(Object.values(scanChecks).every(Boolean));
	function pickScan(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0];
		if (!f) return;
		if (scanPreview) URL.revokeObjectURL(scanPreview);
		scanFoto = f; scanPreview = URL.createObjectURL(f);
	}
	async function submitScan() {
		if (!scanFoto) { err = 'Foto SJ fisik wajib diambil.'; return; }
		if (!scanLengkap) { err = 'Centang dulu: semua tanda tangan dan stempel terlihat jelas.'; return; }
		busy = 'scan'; err = '';
		try {
			let blob: Blob = scanFoto;
			try { blob = await compressPhoto(scanFoto); } catch { /* kirim apa adanya */ }
			const r = await submitScanSjFisik(id as string, blob, data?.sj?.nomor_sj ?? null);
			info = r.queued
				? 'Sinyal lemah — foto tersimpan di HP dan akan terkirim otomatis begitu online. Jangan hapus aplikasi.'
				: 'Foto SJ fisik terkirim. Terima kasih!';
			showScan = false; scanFoto = null; scanPreview = null;
			scanChecks = { gudang: false, driver: false, penerima: false, stempel: false };
			await load();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal mengirim foto.';
		} finally {
			busy = '';
		}
	}

	function fmt(ts: string) {
		try { return new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
		catch { return ts; }
	}
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/lacak-sj')}><IconArrowLeft size={18} /> Daftar SJ</button>

	{#if loading}
		<div class="center"><IconLoader2 size={28} class="spin" /></div>
	{:else if err && !data}
		<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>
	{:else if data}
		<h1>{data.sj.nomor_sj}</h1>
		<div class="meta">
			<span class="stage">{data.sj.stage_label}</span>
			<span>{data.sj.tujuan || 'Tujuan —'}</span>
			{#if data.sj.evidence_pct != null}<span class="pct">Bukti {data.sj.evidence_pct}%</span>{/if}
		</div>

		{#if data.sj.mode_kirim === 'ekspedisi' && data.sj.ekspedisi}
			<div class="banner" style="background:#eef2ff;border-color:#c7d2fe;color:#3730a3;">
				<strong>Ekspedisi: {data.sj.ekspedisi.nama}</strong>
				{#if data.sj.ekspedisi.no_resi}
					<div>Resi: <code>{data.sj.ekspedisi.no_resi}</code>
						<button type="button" onclick={() => navigator.clipboard?.writeText(data.sj.ekspedisi.no_resi)} style="margin-left:6px;text-decoration:underline;background:none;border:none;color:inherit;cursor:pointer;">salin</button>
					</div>
				{/if}
				{#if data.sj.ekspedisi.eta_tiba}<div>Estimasi tiba: {data.sj.ekspedisi.eta_tiba}</div>{/if}
				{#if data.sj.ekspedisi.url_tracking}
					<a href={data.sj.ekspedisi.url_tracking} target="_blank" rel="noopener" style="text-decoration:underline;">Lacak di situs ekspedisi</a>
				{/if}
			</div>
		{/if}

		{#if err}<div class="banner err"><IconAlertTriangle size={16} /> {err}</div>{/if}
		{#if info}<div class="banner ok"><IconCheck size={16} /> {info}</div>{/if}

		{#if data.steps?.length}
			<div class="steps" title="Langkah kesiapan SJ sebelum Anda boleh berangkat">
				{#each data.steps as st}<span class="st" class:done={st.done}>{st.done ? '✓' : '○'} {st.label}</span>{/each}
			</div>
			{#if data.next_hint}<p class="nexthint"><b>{data.next_hint}</b></p>{/if}
		{/if}
		{#if data.hint}<div class="banner warn"><IconAlertTriangle size={16} /> {data.hint}</div>{/if}

		{#if data.verifikasi?.done}
			<div class="banner ok">
				<IconCheck size={16} />
				<span>✓ Barang dicek oleh {data.verifikasi.by || '—'} • {data.verifikasi.at ? new Date(data.verifikasi.at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : ''} — {data.verifikasi.sesuai}/{data.verifikasi.total} sesuai{data.verifikasi.source === 'admin' ? ' (via ERP)' : ' (via HP)'}</span>
			</div>
		{:else if data.verifikasi && !data.verifikasi.boleh_ubah && data.verifikasi.alasan_tidak_boleh && data.role?.can_verify}
			<p class="muted sm">{data.verifikasi.alasan_tidak_boleh}</p>
		{/if}

		<div class="actions">
			{#if data.actions.includes('dalam_perjalanan')}
				<button class="act" disabled={!!busy} onclick={startBerangkat}>
					<IconTruckDelivery size={20} /> Berangkat (dalam perjalanan)
				</button>
			{/if}
			{#if data.actions.includes('tiba_lokasi')}
				<button class="act" disabled={!!busy} onclick={() => markStage('tiba_lokasi')}>
					<IconMapPin size={20} /> Tiba di lokasi
				</button>
			{/if}
			{#if data.actions.includes('proof_of_delivery')}
				<button class="act" onclick={() => (showPod = !showPod)}>
					<IconCamera size={20} /> Proof of Delivery
				</button>
			{/if}
			{#if data.actions.includes('scan_fisik')}
				<button class="act" class:primary={!data.sj.has_scan} onclick={() => (showScan = !showScan)}
					title="Foto lembar SJ fisik yang sudah ditandatangani lengkap. Wajib agar penagihan tidak tertahan.">
					<IconCamera size={20} /> {data.sj.has_scan ? 'Ganti Foto SJ Fisik' : 'Foto SJ Fisik Bertanda Tangan'}
				</button>
				{#if !data.sj.has_scan}<p class="muted sm">Setelah barang diterima, foto lembar SJ yang sudah lengkap tanda tangan + stempel.</p>{/if}
			{/if}
			{#if data.actions.includes('verifikasi_fisik')}
				<button class="act primary" onclick={() => goto(`/lacak-sj/${id}/verifikasi`)}
					title="Cocokkan barang yang benar-benar ada di gudang dengan daftar SJ. Wajib sebelum SJ dicetak.">
					<IconClipboardCheck size={20} /> {data.verifikasi?.done ? 'Lihat / Ubah Hasil Cek' : 'Cek Barang Sebelum Kirim'}
				</button>
				{#if !data.verifikasi?.done}<p class="muted sm">Cocokkan barang di gudang dengan SJ ini. Wajib sebelum SJ dicetak.</p>{/if}
			{/if}
			{#if data.actions.includes('terima_barang')}
				<button class="act primary" onclick={() => goto(`/lacak-sj/${id}/terima`)}>
					<IconPackageImport size={20} /> Terima Barang
				</button>
			{/if}
			{#if data.actions.includes('lapor_komplain')}
				<button class="act" onclick={() => goto('/stock-lapangan/komplain')}>
					<IconMessage2 size={20} /> Lapor Komplain
				</button>
			{/if}
		</div>

		{#if pendingRangkap}
			<div class="modal-backdrop">
				<div class="modal-card">
					<p class="modal-title">Konfirmasi Sebelum Berangkat</p>
					<p class="modal-body">
						Sudah serahkan lembar berikut bertanda tangan basah + stempel ke supir?
					</p>
					<ul class="modal-lembar">
						{#each pendingRangkap as l}
							<li><span class="dot2" style="background:{l.warna_hex || '#94a3b8'}"></span> {l.lembar_nama}</li>
						{/each}
					</ul>
					<div class="modal-actions">
						<button class="act" disabled={confirmingBerangkat} onclick={() => (pendingRangkap = null)}>Belum, batal dulu</button>
						<button class="act primary" disabled={confirmingBerangkat} onclick={confirmRangkapDiserahkan}>
							{confirmingBerangkat ? 'Menyimpan...' : 'Ya, sudah diserahkan'}
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if showScan}
			<div class="pod">
				<p class="modal-title">Foto Surat Jalan Fisik</p>
				<div class="frame" class:has={!!scanPreview}>
					{#if scanPreview}
						<img class="prev tall" src={scanPreview} alt="Foto SJ fisik" />
					{:else}
						<span class="frame-hint">Posisikan kertas SJ penuh di dalam bingkai (A4), tegak lurus, cahaya cukup, tanpa bayangan.</span>
					{/if}
				</div>
				<label class="foto-btn" class:has={!!scanPreview}>
					<IconCamera size={18} /> {scanPreview ? 'Foto tersimpan — ambil ulang?' : 'Ambil foto SJ'}
					<input type="file" accept="image/*" capture="environment" onchange={pickScan} hidden />
				</label>
				<div class="checks" title="Pastikan semuanya terlihat jelas sebelum mengirim">
					<label><input type="checkbox" bind:checked={scanChecks.gudang} /> TTD Gudang terlihat</label>
					<label><input type="checkbox" bind:checked={scanChecks.driver} /> TTD Driver terlihat</label>
					<label><input type="checkbox" bind:checked={scanChecks.penerima} /> TTD Penerima terlihat</label>
					<label><input type="checkbox" bind:checked={scanChecks.stempel} /> Stempel customer terlihat</label>
				</div>
				<button class="act primary" disabled={busy === 'scan' || !scanFoto || !scanLengkap} onclick={submitScan}>
					{#if busy === 'scan'}<IconLoader2 size={18} class="spin" />{/if} Kirim Foto SJ
				</button>
				{#if scanFoto && !scanLengkap}<p class="muted sm">Centang keempat item di atas setelah memeriksa foto. Foto buram? Ambil ulang.</p>{/if}
			</div>
		{/if}

		{#if showPod}
			<div class="pod">
				<label class="foto-btn" class:has={!!podPreview}>
					<IconCamera size={18} /> {podPreview ? 'Foto tersimpan — ganti?' : 'Foto bukti serah-terima (wajib)'}
					<input type="file" accept="image/*" capture="environment" onchange={pickPod} hidden />
				</label>
				{#if podPreview}<img class="prev" src={podPreview} alt="POD" />{/if}
				<button class="act primary" disabled={busy === 'pod'} onclick={submitPod}>
					{#if busy === 'pod'}<IconLoader2 size={18} class="spin" />{/if} Kirim POD
				</button>
			</div>
		{/if}

		<h2>Riwayat Tahap</h2>
		{#if data.events.length === 0}
			<p class="muted">Belum ada event.</p>
		{:else}
			<ol class="timeline">
				{#each data.events as ev}
					<li>
						<span class="dot" class:bf={ev.is_backfill}></span>
						<div>
							<div class="tline">
								<b>{ev.stage_from ? (ev.stage_from + ' → ') : ''}{ev.stage_label || '(catatan)'}</b>
								<span class="t">{fmt(ev.at)}</span>
							</div>
							<div class="tsub">
								{ev.actor || 'sistem'}{#if ev.source} · {ev.source}{/if}
								{#if ev.has_gps} · 📍{/if}{#if ev.has_foto} · 📷{/if}{#if ev.has_ttd} · ✍️{/if}
							</div>
							{#if ev.is_backfill}<div class="bfnote">Migrasi (tak tercatat) — bukan bukti nyata</div>
							{:else if ev.notes}<div class="tnote">{ev.notes}</div>{/if}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	{/if}
</div>

<style>
	.wrap { max-width: 640px; margin: 0 auto; padding: 1rem; }
	.back { display: inline-flex; align-items: center; gap: 0.35rem; background: none; border: none; color: #475569; font-size: 0.9rem; margin-bottom: 0.5rem; }
	h1 { font-size: 1.35rem; margin: 0 0 0.25rem; }
	h2 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
	.center { display: flex; justify-content: center; padding: 2rem; }
	.meta { display: flex; flex-wrap: wrap; gap: 0.5rem 0.75rem; font-size: 0.85rem; color: #475569; margin-bottom: 0.75rem; }
	.meta .stage { font-weight: 700; color: #1d4ed8; }
	.meta .pct { color: #64748b; }
	.banner { display: flex; align-items: center; gap: 0.5rem; padding: 0.55rem 0.7rem; border-radius: 0.6rem; font-size: 0.82rem; margin-bottom: 0.5rem; }
	.banner.err { background: #fef2f2; color: #b91c1c; }
	.steps { display: flex; flex-wrap: wrap; gap: 0.4rem 0.8rem; font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.4rem; }
	.st.done { color: #16a34a; }
	.nexthint { font-size: 0.85rem; color: #334155; margin: 0 0 0.5rem; }
	.banner.warn { background: #fffbeb; color: #b45309; }
	.banner.ok { background: #f0fdf4; color: #15803d; }
	.actions { display: flex; flex-direction: column; gap: 0.5rem; }
	.act { display: flex; align-items: center; gap: 0.5rem; padding: 0.85rem; border: 1px solid #cbd5e1; border-radius: 0.75rem; background: #fff; font-size: 0.95rem; font-weight: 600; color: #334155; }
	.act.primary { background: #16a34a; border-color: #16a34a; color: #fff; }
	.act:disabled { opacity: 0.5; }
	.pod { margin-top: 0.75rem; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
	.foto-btn { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem; border: 2px dashed #cbd5e1; border-radius: 0.6rem; font-size: 0.85rem; color: #475569; }
	.foto-btn.has { border-color: #16a34a; border-style: solid; color: #16a34a; }
	.prev { width: 100%; max-height: 170px; object-fit: cover; border-radius: 0.5rem; }
	.prev.tall { max-height: 340px; object-fit: contain; background: #f8fafc; }
	.frame { aspect-ratio: 1 / 1.414; max-height: 340px; margin: 0 auto; width: 100%; max-width: 240px; border: 2px dashed #94a3b8; border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; padding: 0.5rem; text-align: center; }
	.frame.has { border-style: solid; border-color: #16a34a; padding: 0; max-width: 100%; aspect-ratio: auto; }
	.frame-hint { font-size: 0.75rem; color: #64748b; }
	.checks { display: grid; grid-template-columns: 1fr 1fr; gap: 0.35rem 0.6rem; font-size: 0.8rem; color: #334155; }
	.checks label { display: flex; align-items: center; gap: 0.35rem; }
	.muted { color: #94a3b8; }
	.muted.sm { font-size: 0.78rem; margin: 0.15rem 0 0.5rem; }
	.timeline { list-style: none; padding: 0; margin: 0; border-left: 2px solid #e2e8f0; }
	.timeline li { position: relative; padding: 0 0 0.9rem 1rem; }
	.dot { position: absolute; left: -7px; top: 4px; width: 12px; height: 12px; border-radius: 50%; background: #2563eb; border: 2px solid #fff; }
	.dot.bf { background: #cbd5e1; }
	.tline { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; }
	.tline .t { font-size: 0.75rem; color: #94a3b8; }
	.tsub { font-size: 0.78rem; color: #64748b; }
	.tnote { font-size: 0.75rem; color: #94a3b8; }
	.bfnote { font-size: 0.72rem; font-style: italic; color: #94a3b8; }
	.modal-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); display: flex; align-items: center; justify-content: center; padding: 1rem; z-index: 50; }
	.modal-card { background: #fff; border-radius: 0.85rem; padding: 1.1rem; max-width: 360px; width: 100%; }
	.modal-title { font-weight: 700; font-size: 0.95rem; margin-bottom: 0.4rem; }
	.modal-body { font-size: 0.85rem; color: #475569; margin-bottom: 0.5rem; }
	.modal-lembar { list-style: none; padding: 0; margin: 0 0 0.9rem; font-size: 0.85rem; font-weight: 600; color: #1e293b; }
	.modal-lembar li { display: flex; align-items: center; gap: 0.4rem; padding: 0.15rem 0; }
	.dot2 { width: 10px; height: 10px; border-radius: 50%; border: 1px solid #cbd5e1; display: inline-block; }
	.modal-actions { display: flex; gap: 0.5rem; }
	.modal-actions .act { flex: 1; justify-content: center; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
