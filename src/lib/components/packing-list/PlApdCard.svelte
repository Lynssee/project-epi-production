<!-- Kartu "APD Tim" (Rencana Keyakinan Permintaan PL, Fase 3 — lapangan). Membandingkan jumlah APD yang diminta/sudah ada dengan kebutuhan
     jumlah pekerja AKTIF di proyek (penugasan manpower × aturan per jabatan). Bahan diambil SEKALI per proyek dari /api/packing-list/apd-basics
     lalu dinilai di browser (engine salinan identik erp-epi). Hanya PETUNJUK jumlah — bukan catatan APD per orang. Tidak ada pekerja aktif /
     gagal muat => kartu tidak tampil. -->
<script lang="ts">
	import { getIdToken } from '$lib/services/secureDirectus';
	import { evaluateApd } from '$lib/shared/plApd';

	interface Props {
		projectId: number | null;
		/** item pada form: RAB terpilih + barang baru */
		items: { nama_barang: string; qty_required: number; unit: string }[];
	}
	let { projectId, items }: Props = $props();

	let basics = $state<any>(null);
	let open = $state(true);
	let loadedFor: number | null = null;

	async function load(pid: number | null) {
		loadedFor = pid;
		basics = null;
		if (!pid) return;
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/packing-list/apd-basics?project_id=${pid}`, { headers: { Authorization: `Bearer ${token}` } });
			const j = res.ok ? await res.json() : null;
			if (loadedFor === pid && j?.success) basics = j;
		} catch (e) {
			console.warn('[PlApdCard] gagal memuat kebutuhan APD (kartu disembunyikan):', e);
		}
	}
	$effect(() => {
		if (projectId !== loadedFor) load(projectId);
	});

	const result = $derived(
		basics?.persons > 0
			? evaluateApd(
					{ persons: basics.persons, items: basics.need },
					{ request: items.map((i) => ({ nama_barang: i.nama_barang, qty: i.qty_required, unit: i.unit })), committed: basics.committed, siteReceived: basics.siteReceived },
					{ min_coverage_pct: basics.min_coverage_pct }
				)
			: null
	);
	const shortMandatory = $derived(result?.short_mandatory?.length ?? 0);
	const fmt = (n: number) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 1 });
</script>

{#if projectId && result && result.items.length > 0}
	<div class="rounded-xl border p-3 mb-3 text-[12px] {shortMandatory > 0 ? 'border-amber-300 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/60'}" data-testid="pl-apd-card">
		<button type="button" class="w-full flex items-center justify-between gap-2 text-left" onclick={() => (open = !open)} aria-expanded={open}>
			<span class="font-semibold text-slate-900">
				🦺 APD Tim ({result.persons} pekerja aktif)
				{#if shortMandatory > 0}
					<span class="ml-1.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">{shortMandatory} APD wajib kurang</span>
				{:else}
					<span class="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">Cukup</span>
				{/if}
			</span>
			<span class="text-[11px] text-slate-600">{open ? 'Sembunyikan' : 'Tampilkan'}</span>
		</button>
		{#if open}
			<div class="mt-2 space-y-2">
				<p class="text-[11px] text-slate-600 leading-relaxed">
					Kebutuhan dihitung dari <b>jumlah pekerja aktif di proyek</b> × aturan APD per jabatan. "Ada" = sudah diminta di Packing List lain, sudah diterima di site, atau ada di daftar ini.
					Ini hanya petunjuk jumlah, bukan catatan APD per orang.
				</p>
				<div class="flex flex-wrap gap-1">
					{#each result.items as i (i.label)}
						<span
							class="px-1.5 py-0.5 rounded text-[11px] {i.status === 'short' ? (i.mandatory ? 'bg-red-100 text-red-800 font-bold' : 'bg-amber-100 text-amber-800') : i.status === 'unknown' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700'}"
							title={i.status === 'unknown' ? 'Satuan barang tidak dikenal (mis. Pack), jumlah tidak dapat dihitung' : `Kebutuhan ${fmt(i.needed)}, ada/diminta ${fmt(i.have)}${i.short > 0 ? `, kurang ${fmt(i.short)}` : ''}`}
						>{i.label}: {fmt(i.have)}/{fmt(i.needed)}{i.mandatory ? '' : ' (saran)'}</span>
					{/each}
				</div>
				{#if shortMandatory > 0}
					<p class="text-[11px] text-amber-900">Tambahkan APD yang kurang lewat <b>Barang Baru</b> (mis. "Helm Safety" sejumlah kekurangan), atau abaikan bila pekerja sudah membawa APD sendiri.</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}
