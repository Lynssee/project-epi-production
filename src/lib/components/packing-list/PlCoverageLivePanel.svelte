<!-- Kalkulator Kewajaran Qty LIVE (Rencana Gate Rasionalitas Packing List, Fase 4 — lapangan).
     Bahan hitung diambil SEKALI per proyek dari /api/packing-list/coverage-basics, lalu qty dinilai di browser memakai engine
     salinan identik erp-epi ($lib/shared/materialCoverageEngine) — tanpa panggilan API per ketukan. Ini PETUNJUK untuk leader;
     penegakan resmi oleh gate saat Ajukan (mode diatur Superadmin di /settings/gates). -->
<script lang="ts">
	import { getIdToken } from '$lib/services/secureDirectus';
	import { evaluateCoverage, evaluateRunRate, resolveRateStandard } from '$lib/shared/materialCoverageEngine';
	import { computeConfidence, CONFIDENCE_META, validateAlasan, parseReasonOptions } from '$lib/shared/plConfidence';
	import { planStagedDelivery } from '$lib/shared/plStaged';

	export interface CoverageItem {
		key: string; // penanda baris di form pemanggil (mis. "e:123" / "n:0")
		item_id?: number | null;
		nama_barang: string;
		qty_required: number;
		unit: string;
	}
	interface Props {
		projectId: number | null;
		items: CoverageItem[];
		onApply?: (key: string, qty: number) => void;
		/** Alasan terstruktur (kategori + catatan) bila sah; null bila tak perlu/belum lengkap. Dikirim ke server saat Ajukan. */
		alasan?: { kategori: string; catatan: string } | null;
	}
	let { projectId, items, onApply, alasan = $bindable(null) }: Props = $props();

	let basics = $state<any>(null);
	let loading = $state(false);
	let loadError = $state('');
	let open = $state(true);
	// Alasan permintaan (Skor Kuning/Merah). Opsional untuk skor lain lewat tombol tambah.
	let kategori = $state('');
	let catatan = $state('');
	let addReason = $state(false);
	let loadedFor: number | null = null;

	async function loadBasics(pid: number | null) {
		loadedFor = pid;
		basics = null;
		kategori = '';
		catatan = '';
		addReason = false;
		loadError = '';
		if (!pid) return;
		loading = true;
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/packing-list/coverage-basics?project_id=${pid}`, { headers: { Authorization: `Bearer ${token}` } });
			const j = res.ok ? await res.json() : null;
			if (loadedFor !== pid) return; // proyek diganti saat menunggu
			if (j?.success) basics = j;
			else loadError = 'Kalkulator kewajaran qty tidak tersedia untuk proyek ini.';
		} catch (e) {
			console.warn('[PlCoverageLivePanel] gagal memuat bahan hitung:', e);
			if (loadedFor === pid) loadError = 'Kalkulator kewajaran qty tidak dapat dimuat (form tetap bisa dipakai).';
		} finally {
			if (loadedFor === pid) loading = false;
		}
	}
	$effect(() => {
		if (projectId !== loadedFor) loadBasics(projectId);
	});

	const normItems = $derived(items.map((it) => ({ key: it.key, item_id: it.item_id ?? null, nama_barang: it.nama_barang, qty_required: it.qty_required, unit: it.unit })));
	const cov = $derived(
		basics?.area
			? evaluateCoverage({ areaM2: basics.area.areaM2, items: normItems, rates: basics.rates, priorByRateId: basics.priorByRateId, settings: basics.settings })
			: null
	);
	const rr = $derived(
		basics?.area && basics?.dailyRate
			? evaluateRunRate({ areaM2: basics.area.areaM2, dailyRate: basics.dailyRate, items: normItems, rates: basics.rates, siteStockByRateId: basics.siteStockByRateId, settings: basics.settings })
			: null
	);
	const rows = $derived.by(() => {
		const out: any[] = [];
		for (const r of cov?.items || []) if (r.status === 'over' || r.status === 'ok') out.push({ ...r, kind: 'luas m²' });
		for (const r of rr?.items || []) {
			if (r.status !== 'over' && r.status !== 'ok') continue;
			const i = out.findIndex((x) => x.key === r.key);
			if (i === -1) out.push({ ...r, kind: 'kebutuhan harian' });
			else if (r.status === 'over' && out[i].status !== 'over') out[i] = { ...r, kind: 'kebutuhan harian' };
		}
		return out;
	});
	// Skor Keyakinan SEMENTARA di sisi leader: hanya dari kewajaran m² & jadwal (RAB/stok site dinilai gudang). Hanya petunjuk —
	// skor resmi dihitung server saat dikaji Inventory Manager. "Belum dinilai" ≠ aman (luasan kosong dsb.).
	const conf = $derived(basics ? computeConfidence({ area: basics.area, cov, rr }, basics.settings) : null);
	const confMeta = $derived(conf ? (CONFIDENCE_META as Record<string, (typeof CONFIDENCE_META)[keyof typeof CONFIDENCE_META]>)[conf.level] : null);
	const CONF_CLS: Record<string, string> = {
		green: 'bg-emerald-100 text-emerald-700',
		yellow: 'bg-amber-100 text-amber-800',
		red: 'bg-red-100 text-red-700',
		unrated: 'bg-slate-100 text-slate-600'
	};
	const reasonOptions = $derived(parseReasonOptions(basics?.settings?.confidence_reason_options));
	const reasonMinLen = $derived(Number(basics?.settings?.confidence_reason_min_len) || 20);
	const showReason = $derived(!!conf?.needsReason || addReason);
	const reasonCheck = $derived(validateAlasan({ kategori, catatan }, { minLen: reasonMinLen, options: reasonOptions }));
	// Kirim alasan ke pemanggil hanya bila bagian alasan tampil DAN sah; selain itu null (tidak ada alasan setengah jadi di payload).
	$effect(() => {
		const next = showReason && reasonCheck.ok ? { kategori: kategori.trim(), catatan: catatan.trim() } : null;
		if (JSON.stringify(next) !== JSON.stringify(alasan)) alasan = next;
	});
	// Usulan kirim bertahap (hanya baris run-rate yang over & datanya lengkap): tahap 1 hari ini, berikutnya per window kebutuhan harian.
	const stagedBy = $derived.by(() => {
		const m = new Map<string, any>();
		const today = new Date().toISOString().slice(0, 10);
		for (const r of rr?.items || []) {
			const p = planStagedDelivery(r, { bufferDays: basics?.settings?.max_buffer_days, today });
			if (p) m.set(String(r.key), p);
		}
		return m;
	});
	// Sisa di site (saldo BUKU) untuk produk yang ada di daftar ini — agar leader melihat sisa sebelum meminta. Fisik hanya ada bila Opname pernah dilakukan
	// (belum ada di data ini), jadi yang ditampilkan jujur: buku + ajakan hitung fisik.
	const siteRows = $derived.by(() => {
		const out: any[] = [];
		const seen = new Set<string>();
		for (const r of (cov?.items || []) as any[]) {
			if (!r.rateId || seen.has(r.rateId)) continue;
			seen.add(r.rateId);
			const s = basics?.siteStockByRateId?.[r.rateId];
			if (!s) continue;
			const rate = (basics?.rates || []).find((x: any) => String(x.id ?? x.code) === r.rateId);
			const std = rate ? resolveRateStandard(rate, basics.settings) : null;
			out.push({ code: r.rateCode || rate?.code || '', unit: std?.unit || '', sisa: Number(s.onHandStd) || 0, diterima: Number(s.receivedStd) || 0, dipakai: Number(s.usedStd) || 0 });
		}
		return out;
	});
	const overRows = $derived(rows.filter((r) => r.status === 'over'));
	const okCount = $derived(rows.length - overRows.length);
	const fmt = (n: any) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '-');
</script>

{#if projectId && items.length > 0}
	<div class="rounded-xl border border-sky-200 bg-sky-50/70 p-3 mb-3 text-[12px]" data-testid="pl-coverage-live">
		<button type="button" class="w-full flex items-center justify-between gap-2 text-left" onclick={() => (open = !open)} aria-expanded={open}>
			<span class="font-semibold text-sky-900">
				🧮 Cek Kewajaran Jumlah
				{#if overRows.length > 0}
					<span class="ml-1.5 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold">{overRows.length} item terlalu banyak</span>
				{:else if rows.length > 0}
					<span class="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">{okCount} item wajar</span>
				{/if}
				{#if confMeta && conf}
					<span class="ml-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold {CONF_CLS[conf.level]}" data-testid="pl-confidence-chip" data-level={conf.level}
						title={`Skor keyakinan sementara: ${confMeta.label}. ${confMeta.desc}`}>{confMeta.icon} {confMeta.short}</span>
				{/if}
			</span>
			<span class="text-[11px] text-sky-700">{open ? 'Sembunyikan' : 'Tampilkan'}</span>
		</button>

		{#if open}
			<div class="mt-2 space-y-2">
				<p class="text-[11px] text-slate-600 leading-relaxed">
					Membandingkan jumlah yang diminta dengan kebutuhan wajar: <b>luas proyek (m²) × daya sebar material + loss</b> dan kebutuhan beberapa hari kerja ke depan.
					Ini hanya petunjuk — pemeriksaan resmi dilakukan saat Anda menekan Ajukan.
				</p>
				{#if conf && !loading && !loadError}
					<p class="text-[11px] leading-relaxed rounded-lg p-2 {CONF_CLS[conf.level]}" data-testid="pl-confidence-hint">
						<b>Skor sementara: {confMeta?.label}.</b>
						{#if conf.level === 'green'}Jumlah sesuai kebutuhan wajar untuk luas proyek. Tetap dikaji Inventory Manager.
						{:else if conf.level === 'yellow'}Ada item di atas kebutuhan wajar. Turunkan jumlah ke saran maksimal, atau siapkan alasan (mis. luasan bertambah) karena Inventory Manager akan meninjau.
						{:else if conf.level === 'red'}Jumlah jauh di atas kebutuhan wajar. Koreksi dulu — permintaan seperti ini kemungkinan tertahan.
						{:else}Belum bisa dinilai. {conf.reasons.find((r) => r.severity === 'info')?.text || ''} Ini bukan berarti permintaan aman.
						{/if}
					</p>
				{/if}

				{#if conf && !loading && !loadError}
					{#if showReason}
						<div class="rounded-lg border border-amber-200 bg-white p-2 space-y-1.5" data-testid="pl-alasan">
							<div class="text-[11px] font-semibold text-slate-800">📝 Alasan permintaan{conf.needsReason ? ' (diminta karena skor ' + confMeta?.label + ')' : ' (opsional)'}</div>
							<p class="text-[10px] text-slate-500 leading-snug">Pilih kategori lalu jelaskan singkat. Alasan ini ikut terkirim bersama pengajuan dan dibaca Inventory Manager. {conf.level === 'red' ? 'Untuk skor Merah, koreksi jumlah tetap diperlukan — alasan saja tidak cukup.' : ''}</p>
							<select class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px] bg-white" bind:value={kategori} aria-label="Kategori alasan">
								<option value="">— Pilih kategori alasan —</option>
								{#each reasonOptions as opt (opt)}<option value={opt}>{opt}</option>{/each}
							</select>
							<textarea class="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-[12px]" rows="2" maxlength="500" placeholder="Jelaskan singkat (mis. area tambahan di gudang B belum masuk charter)" bind:value={catatan} aria-label="Catatan alasan"></textarea>
							<div class="text-[10px] {reasonCheck.ok ? 'text-emerald-700' : 'text-amber-700'}">{reasonCheck.ok ? '✓ Alasan lengkap, akan ikut terkirim.' : reasonCheck.error + ' (' + catatan.trim().length + '/' + reasonMinLen + ')'}</div>
						</div>
					{:else}
						<button type="button" class="text-[11px] text-sky-700 underline" onclick={() => (addReason = true)}>+ Tambahkan alasan permintaan (opsional)</button>
					{/if}
				{/if}

				{#if loading}
					<p class="text-[11px] text-slate-500 italic">Memuat luas proyek & standar daya sebar…</p>
				{:else if loadError}
					<p class="text-[11px] text-amber-700">{loadError}</p>
				{:else if basics && !basics.area}
					<p class="text-[11px] text-amber-800 bg-amber-50 rounded-lg p-2">
						⚠️ Luas proyek (m²) belum terisi atau belum valid, jadi pengecekan belum aktif. Minta Admin mengisi <b>Luasan</b> di Charter proyek (minimal {basics.settings?.min_trusted_area_m2 ?? 5} m²).
					</p>
				{:else if basics}
					<p class="text-[11px] text-slate-700">
						Luas acuan <b>{fmt(basics.area.areaM2)} m²</b>
						{#if basics.dailyRate}• laju kerja <b>{fmt(basics.dailyRate.rate)} m²/hari</b>{/if}
					</p>
					{#if siteRows.length > 0}
						<div class="text-[11px] text-slate-700 bg-white/70 rounded-lg p-2" data-testid="pl-site-sisa">
							<b>Sisa di site (saldo buku):</b>
							{#each siteRows as s, i}{i ? '; ' : ' '}{s.code} <b>{fmt(s.sisa)} {s.unit}</b> <span class="text-slate-500">(diterima {fmt(s.diterima)}, dipakai {fmt(s.dipakai)})</span>{/each}.
							Ini catatan sistem, belum tentu sama dengan fisik. <a class="underline text-sky-700" href="/inventory-proyek/opname">Hitung fisik (Opname)</a> bila ragu sebelum meminta tambahan.
						</div>
					{/if}
					{#if rows.length === 0}
						<p class="text-[11px] text-slate-500 italic">Belum ada cat/coating dalam daftar ini yang bisa dinilai. Barang lain tidak terpengaruh.</p>
					{/if}
					{#each overRows as r (r.key)}
						<div class="rounded-lg border border-red-200 bg-red-50 p-2">
							<div class="flex items-start justify-between gap-2 flex-wrap">
								<div class="min-w-0">
									<div class="font-semibold text-red-800 text-[12px] truncate" title={r.nama_barang}>❌ {r.nama_barang}</div>
									<div class="text-[11px] text-red-700 leading-snug">
										Diminta {fmt(r.qty)} {r.unit} (+{r.overPct}% di atas batas {r.kind}). Jumlah wajar: <b>maks {fmt(r.suggestedQty)} {r.unit}</b>.{#if stagedBy.get(String(r.key))} <b>Bisa dikirim bertahap:</b> {#each stagedBy.get(String(r.key)).stages as s, i}{i ? ' → ' : ' '}{s.dayOffset === 0 ? 'hari ini' : `+${s.dayOffset} hari`} {fmt(s.qty)} {stagedBy.get(String(r.key)).unit}{/each}{stagedBy.get(String(r.key)).truncated ? ' …' : ''}.{/if}
									</div>
								</div>
								{#if onApply}
									<button
										type="button"
										class="shrink-0 px-2.5 py-1 rounded-lg bg-sky-600 text-white text-[11px] font-bold disabled:opacity-50"
										disabled={!(r.suggestedQty > 0)}
										onclick={() => onApply?.(r.key, r.suggestedQty)}
									>Pakai {fmt(r.suggestedQty)} {r.unit}</button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
{/if}
