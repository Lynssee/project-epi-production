<!-- Kalkulator Kewajaran Qty LIVE (Rencana Gate Rasionalitas Packing List, Fase 4 — lapangan).
     Bahan hitung diambil SEKALI per proyek dari /api/packing-list/coverage-basics, lalu qty dinilai di browser memakai engine
     salinan identik erp-epi ($lib/shared/materialCoverageEngine) — tanpa panggilan API per ketukan. Ini PETUNJUK untuk leader;
     penegakan resmi oleh gate saat Ajukan (mode diatur Superadmin di /settings/gates). -->
<script lang="ts">
	import { getIdToken } from '$lib/services/secureDirectus';
	import { evaluateCoverage, evaluateRunRate } from '$lib/shared/materialCoverageEngine';

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
	}
	let { projectId, items, onApply }: Props = $props();

	let basics = $state<any>(null);
	let loading = $state(false);
	let loadError = $state('');
	let open = $state(true);
	let loadedFor: number | null = null;

	async function loadBasics(pid: number | null) {
		loadedFor = pid;
		basics = null;
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
			</span>
			<span class="text-[11px] text-sky-700">{open ? 'Sembunyikan' : 'Tampilkan'}</span>
		</button>

		{#if open}
			<div class="mt-2 space-y-2">
				<p class="text-[11px] text-slate-600 leading-relaxed">
					Membandingkan jumlah yang diminta dengan kebutuhan wajar: <b>luas proyek (m²) × daya sebar material + loss</b> dan kebutuhan beberapa hari kerja ke depan.
					Ini hanya petunjuk — pemeriksaan resmi dilakukan saat Anda menekan Ajukan.
				</p>

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
					{#if rows.length === 0}
						<p class="text-[11px] text-slate-500 italic">Belum ada cat/coating dalam daftar ini yang bisa dinilai. Barang lain tidak terpengaruh.</p>
					{/if}
					{#each overRows as r (r.key)}
						<div class="rounded-lg border border-red-200 bg-red-50 p-2">
							<div class="flex items-start justify-between gap-2 flex-wrap">
								<div class="min-w-0">
									<div class="font-semibold text-red-800 text-[12px] truncate" title={r.nama_barang}>❌ {r.nama_barang}</div>
									<div class="text-[11px] text-red-700 leading-snug">
										Diminta {fmt(r.qty)} {r.unit} (+{r.overPct}% di atas batas {r.kind}). Jumlah wajar: <b>maks {fmt(r.suggestedQty)} {r.unit}</b>.
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
