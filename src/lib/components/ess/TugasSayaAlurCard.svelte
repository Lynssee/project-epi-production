<!-- src/lib/components/ess/TugasSayaAlurCard.svelte -->
<!-- "Tugas Saya di Alur Kerja" (Kinerja ESS, dashboard Leader, dan BERANDA semua karyawan lewat mode `ringkas`): langkah alur bisnis yang
     menjadi tanggung jawab jabatan Anda + target waktu + gate yang harus lolos. Ringan: satu panggilan ber-cache (memo 5 menit, dipakai bersama);
     fail-soft (tidak ada data = kartu tak tampil). Mode `ringkas` (beranda): maks. 3 baris, tanpa panggilan status training, dan bila jabatan belum
     terhubung ke master jabatan tampil petunjuk singkat (bukan menghilang diam-diam) agar karyawan tahu harus menghubungi HRD. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { loadMyTasks, type MineResult } from '$lib/services/processGuidanceMineApi';
	import { loadTrainingStatus, type TrainingStatus } from '$lib/services/processGuidanceTrainingApi';
	import { getGateKpiSaya, type GateKpiSayaDokumen } from '$lib/services/ess/gateKpiSaya';
	import PdfFetchSheet from '$lib/components/shared/PdfFetchSheet.svelte';
	import { simpanSalinanBukuSaku, bacaSalinanBukuSaku, type SalinanBukuSaku } from '$lib/utils/bukuSakuOfflineCache';
	import { IconRoute } from '@tabler/icons-svelte';

	// cacheOwner = id karyawan pemilik perangkat; bila diisi, Buku Saku Jabatan otomatis disimpan di IndexedDB untuk dibuka tanpa sinyal.
	let { ringkas = false, cacheOwner = null }: { ringkas?: boolean; cacheOwner?: number | string | null } = $props();

	const MAX_SHOWN = $derived(ringkas ? 3 : 4);
	let data = $state<MineResult | null>(null);

	// Dokumen SAYA yang sedang tertahan di gate (sumber sama dengan kartu "Dampak Gate ke KPI Saya": /api/ess/gate-kpi-saya, memo 2 menit
	// dibagi bersama). Dipanggil HANYA bila ada langkah yang memegang gate. Gagal/tak tersedia = tidak ada peringatan (fail-soft).
	let tertahan = $state<GateKpiSayaDokumen[]>([]);

	// Buku Saku Jabatan (PDF server-side; bisa disimpan/dibagikan agar terbuka tanpa sinyal).
	let bukuOpen = $state(false);
	let bukuOffline = $state(false);
	// Salinan offline (IndexedDB): terisi otomatis setiap PDF berhasil diunduh; dipakai bila sinyal tak ada.
	let salinan = $state<SalinanBukuSaku | null>(null);
	let pakaiSalinan = $state(false);
	function bukaBuku() {
		const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
		bukuOffline = offline && !salinan;
		pakaiSalinan = offline && !!salinan;
		if (!bukuOffline) bukuOpen = true;
	}
	function bukaSalinan() {
		bukuOffline = false;
		pakaiSalinan = true;
		bukuOpen = true;
	}
	async function simpanSalinan(blob: Blob) {
		if (cacheOwner == null || !data?.posisi) return;
		if (await simpanSalinanBukuSaku(cacheOwner, data.posisi.id, blob, data.posisi.nama)) salinan = { blob, cachedAt: new Date().toISOString() };
	}
	const fmtWaktu = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

	// Status training untuk program yang ditautkan ke langkah saya (SATU panggilan, maks. 20 program). Gagal = baris training tidak tampil.
	let training = $state<TrainingStatus[]>([]);

	onMount(async () => {
		data = await loadMyTasks();
		if (cacheOwner != null && data?.posisi) salinan = await bacaSalinanBukuSaku(cacheOwner, data.posisi.id);
		if ((data?.tasks ?? []).some((t) => (t.gate_keys ?? []).length > 0)) {
			const g = await getGateKpiSaya();
			if (g?.available) tertahan = g.tertahan ?? [];
		}
		if (ringkas) return; // beranda: hemat panggilan — status training hanya di Kinerja / Leader
		const ids = [...new Set((data?.tasks ?? []).flatMap((t) => (t.training ?? []).map((x) => x.program_id)))];
		if (ids.length > 0) {
			const r = await loadTrainingStatus(ids);
			if (r.ok) training = r.items;
		}
	});

	// Hanya program TERBIT yang bisa diikuti, jadi hanya itu yang dihitung.
	let trainingTerbit = $derived(training.filter((p) => p.terbit));
	let trainingBelum = $derived(trainingTerbit.filter((p) => p.status_saya !== 'lulus').length);

	let tasks = $derived(data?.tasks ?? []);
	let flowCount = $derived(new Set(tasks.map((t) => t.flow_id)).size);
	// Langkah ber-SLA dulu (paling terukur), lalu urutan alur.
	let shown = $derived([...tasks].sort((a, b) => Number(!!b.sla_hours) - Number(!!a.sla_hours)).slice(0, MAX_SHOWN));
	// Total gate unik yang dipegang jabatan ini (informasi; mode gate diatur Super Admin di dashboard admin).
	let gateCount = $derived(new Set(tasks.flatMap((t) => t.gate_keys ?? [])).size);
	// Dokumen saya yang tertahan di gate yang dipegang langkah jabatan saya (irisan kunci gate), paling mendesak (sisa waktu terkecil) dulu.
	let gateSaya = $derived(new Set(tasks.flatMap((t) => t.gate_keys ?? [])));
	let tertahanSaya = $derived(
		tertahan.filter((d) => (d.gate_keys ?? []).some((k) => gateSaya.has(k))).sort((a, b) => (a.sisa_jam ?? 0) - (b.sisa_jam ?? 0))
	);
	const tertahanDi = (keys: string[] = []) => tertahanSaya.filter((d) => (d.gate_keys ?? []).some((k) => keys.includes(k))).length;
	// Hanya mode ringkas: jabatan belum terhubung → petunjuk (kartu penuh tetap diam agar halaman lama tidak berubah).
	let belumTerhubung = $derived(ringkas && !!data && !data.posisi && data.source === 'directus' && !!data.reason);
	let withSla = $derived(tasks.filter((t) => t.sla_hours).length);
	let tampil = $derived(Boolean(data?.posisi && tasks.length > 0));
</script>

{#if belumTerhubung}
	<div class="mb-4 rounded-xl px-3 py-2 text-[11px] bg-amber-50 text-amber-800" data-testid="tugas-saya-alur-unlinked">
		🧭 {data?.reason}
	</div>
{:else if tampil && data?.posisi}
	<div class="{ringkas ? 'mb-4' : 'mb-8'} glass-panel rounded-2xl p-5" data-testid="tugas-saya-alur">
		<div class="flex items-start justify-between gap-3">
			<div>
				<h2 class="text-lg font-bold flex items-center gap-2" style="color: var(--sys-label)">
					<IconRoute size={20} style="color: var(--p, var(--g))" /> Tugas Saya di Alur Kerja
				</h2>
				<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
					Langkah alur bisnis yang menjadi tanggung jawab jabatan <strong>{data.posisi.nama}</strong>{gateCount > 0 ? ` · memegang ${gateCount} gate` : ''}.
					{#if data.source === 'cached'}(salinan terakhir di perangkat){/if}
				</p>
			</div>
			<div class="text-right shrink-0">
				<p class="text-2xl font-extrabold" style="color: var(--sys-label)">{tasks.length}</p>
				<p class="text-[10px]" style="color: var(--sys-label3)">langkah · {flowCount} alur</p>
			</div>
		</div>

		<ul class="mt-3 space-y-1.5">
			{#each shown as t (`${t.flow_id}:${t.node_id}`)}
				<li>
					<a
						href="/panduan/alur?alur={encodeURIComponent(t.flow_id)}&fokus={encodeURIComponent(t.node_id)}"
						class="block rounded-xl px-3 py-2 bg-slate-50 active:scale-[0.99] transition-transform"
					>
						<span class="block text-xs font-semibold" style="color: var(--sys-label)">{t.label}</span>
						<span class="block text-[10px]" style="color: var(--sys-label3)">
							{t.flow_title}{t.sla_hours ? ` · target ${t.sla_hours} jam` : ''}{(t.gate_keys ?? []).length ? ` · 🛡 ${t.gate_keys.length} gate` : ''}{#if tertahanDi(t.gate_keys) > 0}<strong class="text-red-600" data-testid="langkah-tertahan"> · ⛔ {tertahanDi(t.gate_keys)} dokumen tertahan</strong>{/if}
						</span>
					</a>
				</li>
			{/each}
		</ul>

		{#if tertahanSaya.length > 0}
			<div class="mt-3 rounded-xl px-3 py-2 text-[11px] bg-red-50 text-red-700 border border-red-100" data-testid="gate-tertahan">
				<p class="font-bold">⛔ {tertahanSaya.length} dokumen Anda tertahan di gate pada langkah ini</p>
				<ul class="mt-1 space-y-0.5">
					{#each tertahanSaya.slice(0, ringkas ? 2 : 3) as d (d.id)}
						<li>
							{#if d.link}<a href={d.link} class="underline">{d.nomor}</a>{:else}{d.nomor}{/if}
							<span class="opacity-80">· {d.gate_keys.join(', ')} · {d.sisa_jam > 0 ? `sisa ${d.sisa_jam} jam sebelum berpengaruh ke skor` : 'sudah melewati batas'}</span>
						</li>
					{/each}
				</ul>
				{#if tertahanSaya.length > (ringkas ? 2 : 3)}<p class="mt-0.5 opacity-80">+{tertahanSaya.length - (ringkas ? 2 : 3)} lainnya — lihat kartu Dampak Gate ke KPI di halaman Kinerja.</p>{/if}
			</div>
		{/if}

		{#if trainingTerbit.length > 0}
			<a href="/ess/pelatihan" class="mt-3 block rounded-xl px-3 py-2 text-[11px] {trainingBelum > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}" data-testid="tugas-training">
				{#if trainingBelum > 0}
					🎓 <strong>{trainingBelum}</strong> dari {trainingTerbit.length} training untuk langkah Anda belum selesai — buka Pelatihan →
				{:else}
					🎓 Semua {trainingTerbit.length} training untuk langkah Anda sudah lulus ✅
				{/if}
			</a>
		{/if}

		<div class="mt-3 flex items-center justify-between text-[11px]">
			<span style="color: var(--sys-label3)">{withSla > 0 ? `${withSla} langkah punya target waktu` : 'Belum ada target waktu pada langkah Anda'}</span>
			<a href="/panduan/alur" class="font-bold underline" style="color: var(--p, var(--g))">Lihat semua →</a>
		</div>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<button
				type="button"
				onclick={bukaBuku}
				class="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-600 text-white active:scale-95 transition"
				title="PDF berisi semua langkah, checklist, dan gate milik jabatan Anda. Simpan/bagikan supaya bisa dibuka tanpa sinyal di lokasi proyek."
				data-testid="btn-buku-saku-jabatan"
			>
				📘 Buku Saku Jabatan (PDF)
			</button>
			{#if salinan}
				<button type="button" onclick={bukaSalinan} class="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-100 text-slate-700 active:scale-95 transition" data-testid="btn-salinan-offline" title="Buka PDF yang tersimpan di perangkat ini (tanpa unduh, tanpa sinyal)">
					📴 Buka salinan offline
				</button>
				<span class="text-[10px]" style="color: var(--sys-label3)" data-testid="salinan-info">tersimpan {fmtWaktu(salinan.cachedAt)}</span>
			{:else}
				<span class="text-[10px]" style="color: var(--sys-label3)">{cacheOwner != null ? 'Setelah dibuka sekali, PDF otomatis tersimpan di perangkat untuk dibuka tanpa sinyal.' : 'Simpan/bagikan PDF-nya agar bisa dibuka tanpa sinyal.'}</span>
			{/if}
		</div>
		{#if bukuOffline}
			<p class="mt-1 text-[11px] text-amber-700" role="alert" data-testid="buku-offline">Anda sedang offline dan belum ada salinan tersimpan. Buka Buku Saku sekali saat ada sinyal — setelah itu tersimpan di perangkat.</p>
		{/if}
	</div>
	<PdfFetchSheet
		open={bukuOpen}
		url="/api/panduan/buku-saku-pdf?jabatan=1"
		title={`Buku Saku Jabatan — ${data.posisi.nama}`}
		filename={`Buku Saku Jabatan - ${data.posisi.nama}`}
		initialBlob={pakaiSalinan ? salinan?.blob : null}
		onLoaded={(b) => void simpanSalinan(b)}
		onClose={() => { bukuOpen = false; pakaiSalinan = false; }}
	/>
{/if}
