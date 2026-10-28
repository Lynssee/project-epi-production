<!-- src/lib/components/procurement/UkbRingkas.svelte -->
<!-- Uji Kebutuhan Beli — Fase 4 (5 Sep 2026). Kartu ringkas mobile untuk
     (app)/procurement/ajukan: satu baris vonis + satu baris sumber teratas per
     item bermasalah. Memanggil proxy lokal /api/procurement-necessity (yang
     meneruskan ke admin erp-epi /api/procurement/necessity — SATU sumber
     vonis, sama dengan KartuUjiKebutuhanBeli.svelte di admin).

     Ruang lingkup data proyek lain (K4): PM lapangan BOLEH melihat nama
     proyek + qty + status proyek asal, TIDAK melihat detail transaksi/harga
     proyek lain — endpoint necessity di admin memang tidak pernah mengirim
     itu. Tombol aksi transfer BELUM dibangun di sini (perlu alur
     permintaan+approval PM asal yang belum ada) -- hanya info lokasi +
     instruksi koordinasi manual, supaya tidak ada tombol yang berpura-pura
     bekerja (Aturan #6). -->
<script lang="ts">
	import { getIdToken } from '$lib/services/secureDirectus';

	type NecessityItem = {
		nama_barang: string;
		verdict: 'PERLU_BELI' | 'CUKUP_DARI_DALAM' | 'CUKUP_SEBAGIAN' | 'DUPLIKAT' | 'TUNDA' | 'DATA_KURANG';
		qty_diminta: number;
		qty_tertutup_internal: number;
		qty_perlu_beli: number;
		hint: string;
		kanal: Array<{ kode: string; label: string; qty: number; lokasi?: string; aksi?: string; ref_id?: number | string }>;
	};

	let {
		items = [],
		kategoriKode = null,
		department = null,
		projectId = null
	}: {
		items: Array<{ identitas_barang_id?: number | null; nama_barang: string; quantity: number; harga?: number }>;
		kategoriKode?: string | null;
		department?: string | null;
		projectId?: number | string | null;
	} = $props();

	let loading = $state(false);
	let hasil = $state<NecessityItem[] | null>(null);
	let lastKey = $state('');
	let timer: ReturnType<typeof setTimeout>;

	const VERDICT_META: Record<string, { icon: string; label: string; cls: string }> = {
		CUKUP_DARI_DALAM: { icon: '🔴', label: 'Sudah ada di dalam', cls: 'bg-red-50 text-red-700 border-red-200' },
		CUKUP_SEBAGIAN: { icon: '🟠', label: 'Sebagian sudah ada', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
		DUPLIKAT: { icon: '🔴', label: 'Kemungkinan duplikat', cls: 'bg-red-50 text-red-700 border-red-200' }
	};

	$effect(() => {
		const relevant = items.filter((it) => (it.nama_barang || '').trim() && Number(it.quantity) > 0);
		const key = JSON.stringify({
			kategoriKode,
			department,
			projectId,
			items: relevant.map((it) => ({ id: it.identitas_barang_id ?? null, q: it.quantity, h: it.harga, n: it.nama_barang }))
		});
		if (key === lastKey) return;
		lastKey = key;
		clearTimeout(timer);
		if (relevant.length === 0) {
			hasil = null;
			return;
		}
		timer = setTimeout(() => runCheck(relevant), 800);
	});

	async function runCheck(relevant: typeof items) {
		loading = true;
		try {
			const token = await getIdToken();
			const res = await fetch('/api/procurement-necessity', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					items: relevant.map((it) => ({
						nama_barang: it.nama_barang,
						identitas_barang_id: it.identitas_barang_id || null,
						quantity: it.quantity,
						harga: it.harga
					})),
					kategoriKode,
					projectId
				})
			});
			const json = await res.json();
			hasil = json?.available && json?.items ? json.items : null;
		} catch (e) {
			console.warn('[UkbRingkas] gagal memuat (diabaikan):', e);
			hasil = null;
		} finally {
			loading = false;
		}
	}

	let bermasalah = $derived((hasil || []).filter((it) => ['CUKUP_DARI_DALAM', 'CUKUP_SEBAGIAN', 'DUPLIKAT'].includes(it.verdict)));
</script>

{#if loading}
	<div class="rounded-xl p-3 bg-slate-50 border border-slate-200 text-xs flex items-center gap-2" style="color: var(--sys-label4)">
		<span class="animate-pulse">🔎</span> Memeriksa apakah barang sudah tersedia di dalam...
	</div>
{:else if bermasalah.length > 0}
	<div class="rounded-xl border border-amber-200 bg-amber-50/70 overflow-hidden">
		<div class="px-3 py-2 border-b border-amber-200 bg-amber-100/60">
			<span class="text-xs font-bold text-amber-800">🔎 Uji Kebutuhan Beli</span>
			<span class="text-[10px] text-amber-700 block mt-0.5">Cek dulu sebelum kirim — mungkin tidak perlu beli semua</span>
		</div>
		<div class="divide-y divide-amber-200/70">
			{#each bermasalah as it}
				{@const meta = VERDICT_META[it.verdict]}
				{@const sumber = it.kanal.find((k) => k.qty > 0 || k.lokasi)}
				<div class="px-3 py-2.5">
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs font-semibold text-slate-800 truncate">{it.nama_barang}</span>
						<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border {meta?.cls} whitespace-nowrap">{meta?.icon} {meta?.label}</span>
					</div>
					{#if sumber}
						<p class="text-[11px] mt-1" style="color: var(--sys-label4)">
							📍 {sumber.lokasi || sumber.label}{sumber.qty ? ` — ${sumber.qty} unit` : ''}
						</p>
					{/if}
					{#if it.verdict !== 'DUPLIKAT' && it.qty_perlu_beli < it.qty_diminta}
						<p class="text-[11px] mt-0.5 text-emerald-700 font-medium">Cukup ajukan {it.qty_perlu_beli} unit saja</p>
					{/if}
					{#if it.kanal.some((k) => k.aksi === 'transfer_internal')}
						<p class="text-[10px] mt-1 italic" style="color: var(--sys-label4)">
							Koordinasikan dengan PM proyek asal secara manual untuk transfer — alur permintaan otomatis belum tersedia.
						</p>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
