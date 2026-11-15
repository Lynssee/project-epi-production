<script lang="ts">
	// src/routes/(app)/lacak-sj/+page.svelte
	// Lacak Surat Jalan — daftar SJ yang berkaitan dengan saya (proyek saya / saya driver).
	// Tracking SJ v2 Fase 4.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { IconLoader2, IconChevronRight, IconTruck, IconAlertTriangle, IconQrcode } from '@tabler/icons-svelte';
	import { parseLacakLink, lacakBridgePath } from '$lib/utils/lacakLink';
	import { groupSjByLane } from '$lib/utils/sjBoardLanes';

	let loading = $state(true);
	let err = $state('');
	let items = $state<any[]>([]);
	let stageFilter = $state(page.url.searchParams.get('stage') || '');
	// SJ-06: jumlah SJ yang perlu dicek muat (chip "Perlu Verifikasi") + apakah akun berhak memverifikasi
	let perluCount = $state(0);
	let bisaVerifikasi = $state(false);
	// SJH-17 §4.3: akun berhak memakai fitur driver tapi belum tertaut ke master driver Fleet -> SJ yang
	// dibawa tidak akan muncul. Banner hanya untuk akun berizin 'access_driver' (Project Leader biasa tak
	// perlu ditakut-takuti). API mengirim driver_linked.
	let driverLinked = $state(true);
	const perluTautDriver = $derived(
		!driverLinked && !!$authStore.roleId && hasPermission($authStore.roleId, 'access_driver', $rolesStore)
	);

	const STAGES = [
		['', 'Semua'], ['perlu_verifikasi', 'Perlu Verifikasi'], ['disiapkan', 'Disiapkan'], ['dimuat', 'Dimuat'],
		['menunggu_gerbang', 'Menunggu Gerbang'], ['lolos_gerbang', 'Lolos Gerbang'],
		['dalam_perjalanan', 'Dalam Perjalanan'], ['tiba_lokasi', 'Tiba Lokasi'],
		['diterima', 'Diterima'], ['selisih', 'Selisih']
	];

	async function load() {
		loading = true; err = '';
		try {
			const url = stageFilter ? `/api/lacak-sj?stage=${stageFilter}` : '/api/lacak-sj';
			const res = await fetch(url);
			const d = await res.json().catch(() => null);
			if (!res.ok) throw new Error(d?.message || 'Gagal memuat.');
			items = d.items || [];
			driverLinked = d.driver_linked !== false;
			perluCount = Number(d.perlu_verifikasi_count) || 0;
			bisaVerifikasi = !!d.bisa_verifikasi;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	// Pelacakan lintas dokumen (SJ/Packing List/Mutasi): tempel tautan dari WhatsApp ATAU pindai QR di dokumen.
	// Tautan /lacak/... dibuka lewat jembatan (aksi sesuai peran); kode EPI:... langsung ke /scan.
	let tautan = $state('');
	let tautanErr = $state('');
	let showScanner = $state(false);
	let QrScannerModal = $state<any>(null);
	async function bukaScanner() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
		showScanner = true;
	}
	function bukaTautan(teks: string) {
		tautanErr = '';
		const t = (teks || '').trim();
		const p = parseLacakLink(t);
		if (p) return goto(lacakBridgePath(p));
		if (/^EPI:[A-Z-]+:/.test(t)) return goto(`/scan/${encodeURIComponent(t)}`);
		tautanErr = 'Tautan/QR tidak dikenali. Tempel tautan "Lacak status" dari WhatsApp atau pindai QR di surat jalan / packing list.';
	}
	function onScanDetect(v: string) {
		showScanner = false;
		bukaTautan(v);
	}

	// Papan "Barang Dalam Perjalanan": SJ aktif dikelompokkan per lajur supaya mandor tak perlu mencari satu per satu.
	// Sumber sama dengan daftar (track_stage). SJ yang sudah diterima/dokumen kembali/tutup tidak ditampilkan di papan.
	let view = $state<'daftar' | 'papan'>('daftar');
	const lanes = $derived(groupSjByLane(items));
	const papanKosong = $derived(lanes.every((l) => l.rows.length === 0));
	function gantiView(v: 'daftar' | 'papan') {
		view = v;
		// Papan butuh semua tahap: hapus filter tahap lalu muat ulang bila perlu.
		if (v === 'papan' && stageFilter) {
			stageFilter = '';
			load();
		}
	}

	function ageText(m: number | null) {
		if (m == null) return '';
		if (m >= 1440) return Math.floor(m / 1440) + ' hari';
		if (m >= 60) return Math.floor(m / 60) + ' jam';
		return m + ' mnt';
	}
</script>

<div class="wrap">
	<h1><IconTruck size={22} /> Lacak Surat Jalan</h1>
	<p class="hint">Yang tampil: SJ proyek Anda dan SJ yang Anda drivernya. <b>"Perlu cek muat"</b> = barang belum Anda cocokkan dengan SJ sebelum SJ dicetak — buka SJ-nya lalu tekan <b>Cek Barang Sebelum Kirim</b>.</p>

	<div class="cari">
		<label for="tautan-lacak" class="cari-lbl">Punya tautan atau QR dokumen?</label>
		<div class="cari-row">
			<input id="tautan-lacak" type="text" inputmode="url" placeholder="Tempel tautan lacak dari WhatsApp…" bind:value={tautan} onkeydown={(e) => e.key === 'Enter' && bukaTautan(tautan)} />
			<button class="btn-buka" onclick={() => bukaTautan(tautan)} disabled={!tautan.trim()} title="Buka dokumen dari tautan yang ditempel">Buka</button>
			<button class="btn-scan" onclick={bukaScanner} aria-label="Pindai QR dokumen" title="Pindai QR di Surat Jalan / Packing List / e-SJ Mutasi"><IconQrcode size={18} /></button>
		</div>
		{#if tautanErr}<div class="cari-err" role="alert">{tautanErr}</div>{/if}
		<div class="cari-hint">Berlaku untuk Surat Jalan, Packing List, dan Mutasi. Anda diarahkan ke layar dengan aksi sesuai peran Anda (mis. terima barang, cek gerbang).</div>
	</div>

	<div class="view-toggle" role="tablist" aria-label="Tampilan">
		<button role="tab" aria-selected={view === 'daftar'} class:on={view === 'daftar'} onclick={() => gantiView('daftar')} title="Daftar SJ dengan filter tahap">Daftar</button>
		<button role="tab" aria-selected={view === 'papan'} class:on={view === 'papan'} onclick={() => gantiView('papan')} title="Papan: SJ dikelompokkan per lajur — dari disiapkan sampai tiba di lokasi">Papan perjalanan</button>
	</div>

	{#if view === 'daftar'}
	<div class="chips">
		{#each STAGES as [val, lbl]}
			{#if val !== 'perlu_verifikasi' || bisaVerifikasi || stageFilter === 'perlu_verifikasi'}
				<button class="chip" class:on={stageFilter === val} onclick={() => { stageFilter = val; load(); }}>{lbl}{#if val === 'perlu_verifikasi' && perluCount > 0} ({perluCount}){/if}</button>
			{/if}
		{/each}
	</div>
	{/if}

	{#if perluTautDriver}
		<div class="banner warn" role="alert">
			<IconAlertTriangle size={18} />
			<span>Akun Anda belum tertaut ke data driver Fleet, jadi SJ yang Anda bawa tidak akan muncul di sini. Hubungi admin Fleet untuk menautkan akun Anda.</span>
		</div>
	{/if}

	{#if loading}
		<div class="center"><IconLoader2 size={28} class="spin" /></div>
	{:else if err}
		<div class="banner err"><IconAlertTriangle size={18} /> {err}</div>
	{:else if view === 'papan'}
		{#if papanKosong}
			<p class="muted">Tidak ada Surat Jalan yang sedang berjalan.</p>
		{:else}
			<p class="hint">Geser ke samping untuk melihat lajur lain. Ketuk kartu untuk detail dan aksi.</p>
			<div class="board">
				{#each lanes as lane (lane.key)}
					<section class="lane" class:warn={lane.key === 'selisih'}>
						<header title={lane.hint}><span>{lane.label}</span><b>{lane.rows.length}</b></header>
						{#each lane.rows as sj (sj.id)}
							<button class="card" onclick={() => goto(`/lacak-sj/${sj.id}`)}>
								<div class="no">{sj.nomor_sj}</div>
								<div class="sub">{sj.tujuan || 'Tujuan —'}</div>
								<div class="meta"><span>{sj.stage_label}</span>{#if sj.age_min != null}<span>{ageText(sj.age_min)}</span>{/if}</div>
							</button>
						{:else}
							<p class="empty">—</p>
						{/each}
					</section>
				{/each}
			</div>
		{/if}
	{:else if items.length === 0}
		<p class="muted">Tidak ada Surat Jalan.</p>
	{:else}
		<ul>
			{#each items as sj}
				<li>
					<button class="row" onclick={() => goto(`/lacak-sj/${sj.id}`)}>
						<div class="main">
							<div class="no">{sj.nomor_sj} {#if sj.is_driver}<span class="tag">driver</span>{/if}
								{#if sj.perlu_verifikasi}<span class="tag warn">Perlu cek muat</span>{:else if sj.terverifikasi}<span class="tag ok">✓ Dicek</span>{/if}</div>
							<div class="sub">{sj.tujuan || 'Tujuan —'}</div>
						</div>
						<div class="right">
							<span class="stage">{sj.stage_label}</span>
							{#if sj.age_min != null}<span class="age">{ageText(sj.age_min)}</span>{/if}
						</div>
						<IconChevronRight size={18} />
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

{#if showScanner && QrScannerModal}
	<QrScannerModal onDetect={onScanDetect} onClose={() => (showScanner = false)} />
{/if}

<style>
	.view-toggle { display: flex; gap: 0.25rem; background: #f1f5f9; border-radius: 0.6rem; padding: 0.2rem; margin-bottom: 0.6rem; }
	.view-toggle button { flex: 1; padding: 0.4rem 0.5rem; border-radius: 0.45rem; font-size: 0.8rem; font-weight: 600; color: #475569; }
	.view-toggle button.on { background: #fff; color: #1d4ed8; box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
	.board { display: flex; gap: 0.6rem; overflow-x: auto; padding-bottom: 0.5rem; scroll-snap-type: x proximity; }
	.lane { flex: 0 0 78%; max-width: 280px; scroll-snap-align: start; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; }
	.lane.warn { background: #fef2f2; border-color: #fecaca; }
	.lane header { display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; font-weight: 700; color: #334155; }
	.lane header b { background: #e2e8f0; border-radius: 999px; padding: 0 0.5rem; font-size: 0.72rem; }
	.card { text-align: left; background: #fff; border: 1px solid #e2e8f0; border-radius: 0.6rem; padding: 0.55rem 0.65rem; }
	.card .no { font-weight: 600; font-size: 0.85rem; word-break: break-all; }
	.card .sub { color: #64748b; font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.card .meta { display: flex; justify-content: space-between; margin-top: 0.25rem; font-size: 0.7rem; color: #94a3b8; }
	.empty { text-align: center; color: #cbd5e1; font-size: 0.8rem; margin: 0.4rem 0; }
	@media (min-width: 900px) { .lane { flex: 1 1 0; max-width: none; } }
	.cari { border: 1px solid #e2e8f0; background: #fff; border-radius: 0.75rem; padding: 0.7rem 0.8rem; margin-bottom: 0.75rem; }
	.cari-lbl { display: block; font-size: 0.8rem; font-weight: 600; color: #334155; margin-bottom: 0.35rem; }
	.cari-row { display: flex; gap: 0.4rem; }
	.cari-row input { flex: 1; min-width: 0; border: 1px solid #cbd5e1; border-radius: 0.5rem; padding: 0.45rem 0.6rem; font-size: 0.85rem; }
	.btn-buka { padding: 0 0.8rem; border-radius: 0.5rem; background: #1d4ed8; color: #fff; font-size: 0.85rem; font-weight: 600; }
	.btn-buka:disabled { opacity: 0.5; }
	.btn-scan { padding: 0 0.6rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; background: #fff; color: #334155; }
	.cari-err { margin-top: 0.4rem; font-size: 0.78rem; color: #b91c1c; }
	.cari-hint { margin-top: 0.4rem; font-size: 0.72rem; color: #94a3b8; line-height: 1.4; }
	.wrap { max-width: 640px; margin: 0 auto; padding: 1rem; }
	h1 { display: flex; align-items: center; gap: 0.5rem; font-size: 1.4rem; margin: 0 0 0.25rem; }
	.hint { font-size: 0.85rem; color: #64748b; margin: 0 0 0.75rem; }
	.chips { display: flex; gap: 0.4rem; overflow-x: auto; padding-bottom: 0.5rem; margin-bottom: 0.5rem; }
	.chip { flex: 0 0 auto; padding: 0.35rem 0.7rem; border: 1px solid #cbd5e1; border-radius: 999px; background: #fff; font-size: 0.8rem; color: #475569; }
	.chip.on { background: #1d4ed8; border-color: #1d4ed8; color: #fff; }
	.center { display: flex; justify-content: center; padding: 2rem; }
	.banner { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; border-radius: 0.6rem; font-size: 0.85rem; }
	.banner.warn { background: #fffbeb; color: #b45309; }
	.banner.err { background: #fef2f2; color: #b91c1c; }
	.muted { color: #94a3b8; }
	ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
	.row { width: 100%; display: flex; align-items: center; gap: 0.75rem; padding: 0.8rem 0.9rem; border: 1px solid #e2e8f0; border-radius: 0.75rem; background: #fff; text-align: left; }
	.main { flex: 1; min-width: 0; }
	.no { font-weight: 600; font-size: 0.95rem; }
	.tag { font-size: 0.65rem; background: #dbeafe; color: #1d4ed8; padding: 0 0.35rem; border-radius: 4px; vertical-align: middle; }
	.tag.warn { background: #ffedd5; color: #c2410c; }
	.tag.ok { background: #dcfce7; color: #15803d; }
	.sub { color: #64748b; font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.right { display: flex; flex-direction: column; align-items: flex-end; }
	.stage { font-size: 0.8rem; font-weight: 600; color: #334155; }
	.age { font-size: 0.72rem; color: #94a3b8; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
