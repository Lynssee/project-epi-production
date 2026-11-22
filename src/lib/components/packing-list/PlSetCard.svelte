<!-- Kartu Set Produk & Set Equipment (Rencana Product Pairing, Fase 3 — lapangan). Saat Leader memilih cat / alat, kartu ini menampilkan
     PASANGANNYA (thinner/hardener atau aksesoris alat) yang belum ada di daftar ini / PL lain proyek / stok site, lengkap dengan saran qty
     dari rasio, dan tombol +1 klik untuk memasukkannya ke daftar. Bahan diambil SEKALI per proyek (klien bersama dengan Kartu Kit) lalu dinilai
     di browser (engine salinan identik erp-epi). Hanya PETUNJUK; penegakan resmi oleh gate G_PKL_PRODUCT_SET / G_PKL_EQUIP_SET (mode diatur Superadmin).
     Tidak ada cat/alat bermatriks atau gagal muat => kartu tidak tampil. -->
<script lang="ts">
	import { fetchPlBasics } from '$lib/services/plBasicsClient';
	import { evaluateProductSets, evaluateEquipmentSets, nameMatches, computeThinnerQty, PAIR_ROLE_LABEL } from '$lib/shared/plSet';

	type AddRow = { name: string; qty: number; unit: string; kind: 'thinner' | 'aksesoris' };
	interface Props {
		projectId: number | null;
		/** barang pada daftar di form (RAB terpilih + barang baru) */
		items: Array<{ nama_barang: string; qty_required: number; unit: string }>;
		/** menambahkan baris ke daftar barang baru; qty & satuan hanya saran (Leader bisa mengubah) */
		onAdd: (rows: AddRow[]) => void;
	}
	let { projectId, items, onAdd }: Props = $props();

	let basics = $state<any>(null);
	let open = $state(true);
	let loadedFor: number | null = null;

	async function load(pid: number | null) {
		loadedFor = pid;
		basics = null;
		if (!pid) return;
		const j = await fetchPlBasics(pid);
		if (loadedFor === pid && j) basics = j;
	}
	$effect(() => {
		if (projectId !== loadedFor) load(projectId);
	});

	// Bobot default per kemasan (kg) — perkiraan saat nama barang tak menyebut ukuran; Leader tetap bisa mengubah qty. Sama dengan bawaan gate rasionalitas.
	const PACK_KG: Record<string, number> = { pail: 20, kaleng: 4, galon: 4, can: 4, drum: 200 };
	function toBaseQty(qty: number, unit: string, name: string): number {
		const u = String(unit || '').trim().toLowerCase();
		const q = Number(qty) || 0;
		if (['kg', 'ltr', 'l', 'liter', 'litre'].includes(u)) return q;
		const m = String(name || '').match(/(\d+(?:[.,]\d+)?)\s*(?:KG|LTR|L)\b/i);
		if (m) return q * Number(m[1].replace(',', '.'));
		return q * (PACK_KG[u] ?? 0);
	}

	const src = $derived({ request: items.map((i) => i.nama_barang), committed: basics?.committed || [], site: basics?.site || [] });
	const prod = $derived(basics?.set_rules ? evaluateProductSets(basics.set_rules.product, src) : null);
	const equip = $derived(basics?.set_rules ? evaluateEquipmentSets(basics.set_rules.equipment, src) : null);

	const ruleOf = (list: any[], key: string) => (list || []).find((r) => r.key === key);
	const sumQty = (rule: any, mode: 'base' | 'raw') =>
		items
			.filter((i) => nameMatches(rule?.match?.keywords, i.nama_barang) && !nameMatches(rule?.match?.exclude, i.nama_barang))
			.reduce((n, i) => n + (mode === 'base' ? toBaseQty(i.qty_required, i.unit, i.nama_barang) : Number(i.qty_required) || 0), 0);

	/** Pair produk + saran qty dari rasio (qty cat dalam kg/ltr × rasio %). */
	const productRows = $derived(
		(prod?.rules || []).map((r: any) => {
			const rule = ruleOf(basics?.set_rules?.product, r.rule_key);
			const catBase = sumQty(rule, 'base');
			return {
				...r,
				pairs: r.pairs.map((p: any) => ({
					...p,
					suggest: p.ratio_pct && catBase > 0 ? Math.max(1, Math.ceil(computeThinnerQty(catBase, p.ratio_pct))) : 1
				}))
			};
		})
	);
	const equipRows = $derived(
		(equip?.rules || []).map((r: any) => {
			const rule = ruleOf(basics?.set_rules?.equipment, r.rule_key);
			return { ...r, units: Math.max(1, sumQty(rule, 'raw')) };
		})
	);

	const mismatches = $derived(prod?.mismatches || []);
	const gapCount = $derived((prod?.missing_mandatory?.length || 0) + (equip?.missing_mandatory?.length || 0));
	const missingCount = $derived(gapCount + mismatches.length);
	const show = $derived(!!projectId && (productRows.length > 0 || equipRows.length > 0));
	const where: Record<string, string> = { in_request: 'di daftar ini', committed: 'di PL lain proyek', on_site: 'sudah di site' };

	function addAllMandatory() {
		const rows: AddRow[] = [];
		for (const r of productRows) {
			for (const p of r.pairs) {
				if (p.requirement === 'wajib' && !p.satisfied && p.options[0]) rows.push({ name: p.options[0].keywords?.[0] || p.options[0].label, qty: p.suggest, unit: 'Ltr', kind: 'thinner' });
			}
		}
		for (const r of equipRows) {
			for (const c of r.components) {
				if (c.mandatory_out && !c.consumable && !c.found) rows.push({ name: c.keywords?.[0] || c.label, qty: (c.qty_per_unit || 1) * r.units, unit: 'Pcs', kind: 'aksesoris' });
			}
		}
		if (rows.length) onAdd(rows);
	}
</script>

{#if show}
	<div class="rounded-xl border p-3 mb-3 text-[12px] {missingCount > 0 ? 'border-sky-300 bg-sky-50/70' : 'border-emerald-200 bg-emerald-50/60'}" data-testid="pl-set-card">
		<button type="button" class="w-full flex items-center justify-between gap-2 text-left" onclick={() => (open = !open)} aria-expanded={open}>
			<span class="font-semibold text-slate-900">
				💡 Pasangan Cat &amp; Kelengkapan Alat
				{#if missingCount > 0}
					<span class="ml-1.5 px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[11px] font-bold">{missingCount} pasangan wajib belum sesuai</span>
				{:else}
					<span class="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">Lengkap</span>
				{/if}
			</span>
			<span class="text-[11px] text-slate-600">{open ? 'Sembunyikan' : 'Tampilkan'}</span>
		</button>
		{#if open}
			<div class="mt-2 space-y-3">
				<p class="text-[11px] text-slate-600 leading-relaxed">
					Cat dan alat yang Anda pilih punya pasangan standar (thinner/hardener, atau aksesoris seperti belalai). Tekan <b>+ Tambah</b> untuk memasukkannya ke daftar; jumlah hanya saran dari rasio, silakan sesuaikan.
					Pasangan yang sudah ada di daftar ini, PL lain proyek, atau di site tidak perlu diminta lagi. Ini hanya petunjuk.
				</p>

				{#each productRows as r (r.rule_key)}
					<div>
						<div class="text-[11px] font-semibold text-slate-800 mb-1">🎨 {r.rule_label}</div>
						<div class="space-y-1">
							{#each r.pairs as p (p.key)}
								<div class="flex flex-wrap items-center gap-1.5">
									<span class="text-[11px] text-slate-600 w-44 shrink-0">{PAIR_ROLE_LABEL[p.role as keyof typeof PAIR_ROLE_LABEL] || p.role} · <b class={p.requirement === 'wajib' ? 'text-red-700' : 'text-slate-500'}>{p.requirement === 'wajib' ? 'Wajib' : 'Opsional'}</b></span>
									{#each p.options as o (o.label)}
										{#if o.found}
											<span class="px-1.5 py-0.5 rounded text-[11px] bg-emerald-100 text-emerald-800">✓ {o.label} ({where[o.found]})</span>
										{:else}
											<button
												type="button"
												class="px-2 py-0.5 rounded text-[11px] border border-sky-400 bg-white text-sky-800 font-semibold hover:bg-sky-100"
												title={o.note || 'Tambahkan ke daftar barang'}
												onclick={() => onAdd([{ name: o.keywords?.[0] || o.label, qty: p.suggest, unit: 'Ltr', kind: 'thinner' }])}
											>
												+ Tambah {o.label}{p.ratio_pct ? ` (saran ${p.suggest} Ltr)` : ''}
											</button>
										{/if}
									{/each}
								</div>
								{#if p.note && !p.satisfied}<div class="text-[11px] text-slate-500 ml-1">ℹ️ {p.note}</div>{/if}
							{/each}
						</div>
					</div>
				{/each}

				{#each mismatches as m}
					<div class="text-[11px] rounded bg-amber-100 text-amber-900 px-2 py-1">⚠️ "{m.nama_barang}" bukan pasangan resmi cat di daftar ini (seharusnya {m.expected.join(' / ')}).</div>
				{/each}

				{#each equipRows as r (r.rule_key)}
					<div>
						<div class="text-[11px] font-semibold text-slate-800 mb-1">🧰 {r.rule_label}</div>
						<div class="flex flex-wrap items-center gap-1.5">
							{#each r.components as c (c.label)}
								{#if c.found}
									<span class="px-1.5 py-0.5 rounded text-[11px] bg-emerald-100 text-emerald-800">✓ {c.label} ({where[c.found]})</span>
								{:else}
									<button
										type="button"
										class="px-2 py-0.5 rounded text-[11px] border bg-white font-semibold hover:bg-sky-100 {c.mandatory_out ? 'border-red-400 text-red-800' : 'border-sky-400 text-sky-800'}"
										title={c.mandatory_out ? 'Wajib ikut keluar' : c.consumable ? 'Habis pakai — opsional' : 'Saran'}
										onclick={() => onAdd([{ name: c.keywords?.[0] || c.label, qty: (c.qty_per_unit || 1) * r.units, unit: 'Pcs', kind: 'aksesoris' }])}
									>
										+ Tambah {c.label}{c.mandatory_out ? ' (wajib)' : ''}
									</button>
								{/if}
							{/each}
						</div>
					</div>
				{/each}

				{#if gapCount > 0}
					<button type="button" class="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold" onclick={addAllMandatory}>+ Tambahkan semua pasangan wajib</button>
				{/if}
			</div>
		{/if}
	</div>
{/if}
