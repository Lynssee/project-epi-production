<!-- Kartu Kit Standar (Rencana Keyakinan Permintaan PL, Fase 2 — lapangan). Menampilkan butir WAJIB kit jenis pekerjaan proyek yang
     belum ada di daftar ini / PL lain proyek / stok site, supaya alat inspeksi tidak tertinggal. Bahan diambil SEKALI per proyek dari
     /api/packing-list/kit-basics lalu dinilai di browser (engine salinan identik erp-epi). Hanya PETUNJUK; penegakan resmi oleh gate
     (mode diatur Superadmin). Tidak ada kit berlaku / gagal muat => kartu tidak tampil. -->
<script lang="ts">
	import { fetchPlBasics } from '$lib/services/plBasicsClient';
	import { evaluateKit, KIT_CLASS_LABEL } from '$lib/shared/plKit';

	interface Props {
		projectId: number | null;
		/** nama barang pada daftar di form (RAB terpilih + barang baru) */
		itemNames: string[];
	}
	let { projectId, itemNames }: Props = $props();

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

	// Kit dari server sudah disaring sesuai jenis pekerjaan proyek; di sini hanya dinilai terhadap isi form.
	const results = $derived(
		(basics?.kits || []).map((k: any) => evaluateKit(k, { request: itemNames, committed: basics.committed, site: basics.site }))
	);
	const missingMandatory = $derived(results.reduce((n: number, r: any) => n + r.missing_mandatory.length, 0));
	const hasMandatory = $derived(results.some((r: any) => r.mandatory_total > 0));
</script>

{#if projectId && results.length > 0 && hasMandatory}
	<div class="rounded-xl border p-3 mb-3 text-[12px] {missingMandatory > 0 ? 'border-amber-300 bg-amber-50/70' : 'border-emerald-200 bg-emerald-50/60'}" data-testid="pl-kit-card">
		<button type="button" class="w-full flex items-center justify-between gap-2 text-left" onclick={() => (open = !open)} aria-expanded={open}>
			<span class="font-semibold text-slate-900">
				🧰 Kit Standar Pekerjaan
				{#if missingMandatory > 0}
					<span class="ml-1.5 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-bold">{missingMandatory} alat wajib belum ada</span>
				{:else}
					<span class="ml-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold">Lengkap</span>
				{/if}
			</span>
			<span class="text-[11px] text-slate-600">{open ? 'Sembunyikan' : 'Tampilkan'}</span>
		</button>
		{#if open}
			<div class="mt-2 space-y-2">
				<p class="text-[11px] text-slate-600 leading-relaxed">
					Daftar minimum yang harus dibawa untuk jenis pekerjaan proyek ini, terutama <b>alat inspeksi</b> agar tidak tertinggal di gudang.
					Butir dianggap ada bila sudah ada di daftar ini, di Packing List lain proyek, atau sudah di site. Ini hanya petunjuk.
				</p>
				{#each results as r (r.kit_key)}
					<div>
						<div class="text-[11px] font-semibold text-slate-800 mb-1">{r.kit_label}</div>
						<div class="flex flex-wrap gap-1">
							{#each r.items as i}
								<span
									class="px-1.5 py-0.5 rounded text-[11px] {i.status === 'missing' ? (i.mandatory ? 'bg-red-100 text-red-800 font-bold' : 'bg-amber-100 text-amber-800') : 'bg-emerald-100 text-emerald-700'}"
									title={i.status === 'missing' ? (i.mandatory ? 'Wajib dibawa — belum ada. Tambahkan lewat "Barang Baru".' : 'Disarankan — belum ada.') : i.status === 'in_request' ? 'Sudah ada di daftar ini' : i.status === 'committed' ? 'Sudah diminta di Packing List lain proyek ini' : 'Sudah ada di site'}
								>{i.status === 'missing' ? (i.mandatory ? '✗ ' : '○ ') : '✓ '}{i.label} <span class="opacity-60">· {(KIT_CLASS_LABEL as Record<string, string>)[i.item_class] || i.item_class}</span></span>
							{/each}
						</div>
					</div>
				{/each}
				{#if missingMandatory > 0}
					<p class="text-[11px] text-amber-900">Tambahkan alat yang kurang lewat <b>Barang Baru</b> (tulis nama alat, mis. "DFT Elcometer"), atau abaikan bila alat sudah dipastikan tersedia di lokasi.</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}
