<!--
  P2HChecklistForm.svelte — layar P2H bersama (ESS Redesign).
  Dipakai identik oleh peminjam Sales/Leader (/ess/kendaraan/checklist/[id]) dan driver
  (/driver/check). Presentational: parent yang memegang submit + endpoint.

  Prinsip PRD: P2H terikat FISIK kendaraan + ID perjalanan, bukan jabatan pengemudi.

  Peminjaman 08 — mode `pemilihanEksplisit` (opt-in; halaman driver TIDAK memakainya, perilakunya tetap):
   - item TIDAK terisi "OK" otomatis; user wajib memilih tiap item (atau ketuk "✓ Semua Baik")
   - item kritis (rem/ban/lampu) di paling atas, tombol besar (≥44px)
   - foto dashboard (angka KM) terpisah dari foto kerusakan
-->
<script lang="ts">
	import { IconCamera, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-svelte';
	import type { P2HTemplateItem } from '$lib/data/p2hChecklist';

	type Status = 'ok' | 'rusak' | 'tidak_ada';

	let {
		template = [],
		itemStatus = $bindable({} as Record<string, Status>),
		kmSaatCek = $bindable(0 as any), // number | null: input kosong menghasilkan null (mode eksplisit); any agar binding di halaman driver (number) tetap valid
		temuan = $bindable(''),
		fotoFile = $bindable(null as File | null),
		fotoDashboardFile = $bindable(null as File | null),
		showKm = true,
		kmLabel = 'Angka Odometer (KM)',
		kmHint = '',
		pemilihanEksplisit = false,
		disabled = false
	}: {
		template: P2HTemplateItem[];
		itemStatus?: Record<string, Status>;
		kmSaatCek?: any;
		temuan?: string;
		fotoFile?: File | null;
		fotoDashboardFile?: File | null;
		showKm?: boolean;
		kmLabel?: string;
		kmHint?: string;
		pemilihanEksplisit?: boolean;
		disabled?: boolean;
	} = $props();

	const STATUS_OPTIONS: Array<{ value: Status; label: string; activeClass: string }> = [
		{ value: 'ok', label: 'OK', activeClass: 'bg-emerald-600 text-white border-emerald-600' },
		{ value: 'rusak', label: 'Rusak', activeClass: 'bg-rose-600 text-white border-rose-600' },
		{ value: 'tidak_ada', label: 'Tidak Ada', activeClass: 'bg-amber-600 text-white border-amber-600' }
	];

	// Mode lama (driver): setiap item punya nilai awal 'ok'. Mode eksplisit: dibiarkan kosong sampai dipilih.
	$effect(() => {
		if (pemilihanEksplisit) return;
		for (const it of template) if (!itemStatus[it.key]) itemStatus[it.key] = 'ok';
	});

	// Kritis di atas (mode eksplisit); urutan asli dipertahankan di dalam tiap kelompok.
	let itemsTampil = $derived(
		pemilihanEksplisit ? [...template.filter((t) => t.kritis), ...template.filter((t) => !t.kritis)] : template
	);

	function semuaBaik() {
		for (const it of template) itemStatus[it.key] = 'ok';
	}

	function previewOf(file: File | null): string {
		return file ? URL.createObjectURL(file) : '';
	}
	let fotoPreview = $state('');
	$effect(() => {
		if (!fotoFile) {
			fotoPreview = '';
			return;
		}
		const url = previewOf(fotoFile);
		fotoPreview = url;
		return () => URL.revokeObjectURL(url);
	});
	let dashPreview = $state('');
	$effect(() => {
		if (!fotoDashboardFile) {
			dashPreview = '';
			return;
		}
		const url = previewOf(fotoDashboardFile);
		dashPreview = url;
		return () => URL.revokeObjectURL(url);
	});

	function onFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		fotoFile = input.files?.[0] || null;
	}
	function onDashChange(e: Event) {
		const input = e.target as HTMLInputElement;
		fotoDashboardFile = input.files?.[0] || null;
	}

	export function adaKritisBermasalah(): boolean {
		return template.some((t) => t.kritis && itemStatus[t.key] && itemStatus[t.key] !== 'ok');
	}
	export function adaBermasalah(): boolean {
		return template.some((t) => itemStatus[t.key] && itemStatus[t.key] !== 'ok');
	}
	/** Mode eksplisit: apakah SEMUA item sudah dipilih. */
	export function semuaTerpilih(): boolean {
		return template.every((t) => !!itemStatus[t.key]);
	}
	let belumDipilih = $derived(pemilihanEksplisit ? template.filter((t) => !itemStatus[t.key]).length : 0);
	let wajibFotoItem = $derived(template.find((t) => t.wajib_foto));
	let adaKritisRusak = $derived(
		template.some((t) => t.kritis && itemStatus[t.key] && itemStatus[t.key] !== 'ok')
	);
	let adaRusak = $derived(template.some((t) => itemStatus[t.key] && itemStatus[t.key] !== 'ok'));
	let btnSize = $derived(pemilihanEksplisit ? 'min-h-[44px] min-w-[52px] px-3 text-xs' : 'px-2 py-1 text-[10px]');
</script>

{#if pemilihanEksplisit}
	<div class="flex items-center justify-between gap-2 mb-2">
		<p class="text-[11px] font-semibold" style="color: var(--sys-label2, #334155)">
			{belumDipilih > 0 ? `${belumDipilih} item belum dipilih` : 'Semua item sudah dipilih'}
		</p>
		<button
			type="button"
			{disabled}
			class="min-h-[44px] px-4 rounded-xl text-xs font-bold text-white bg-emerald-600 disabled:opacity-50 flex items-center gap-1.5"
			onclick={semuaBaik}
		>
			<IconCircleCheck size={16} /> Semua Baik
		</button>
	</div>
{/if}

<div class="space-y-2 mb-5">
	{#each itemsTampil as item (item.key)}
		<div
			class="p-3 rounded-xl border {pemilihanEksplisit && !itemStatus[item.key] ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/10' : ''}"
			style={pemilihanEksplisit && !itemStatus[item.key] ? '' : 'border-color: var(--sys-sep, #e2e8f0)'}
		>
			<div class="flex items-center justify-between gap-2">
				<span class="text-xs font-semibold" style="color: var(--sys-label, #0f172a)">
					{item.label}
					{#if item.kritis}<span class="text-rose-500 font-bold">*</span>{/if}
				</span>
				<div class="flex gap-1 shrink-0">
					{#each STATUS_OPTIONS as opt}
						<button
							type="button"
							{disabled}
							class="{btnSize} rounded-lg font-bold border {itemStatus[item.key] === opt.value
								? opt.activeClass
								: 'bg-transparent text-slate-500 border-slate-300 dark:border-slate-600'}"
							onclick={() => (itemStatus[item.key] = opt.value)}
						>
							{opt.label}
						</button>
					{/each}
				</div>
			</div>
			{#if item.wajib_foto && !pemilihanEksplisit}
				<p class="text-[10px] mt-1" style="color: var(--sys-label3, #64748b)">
					Item ini butuh foto bukti (unggah di bawah).
				</p>
			{/if}
		</div>
	{/each}
</div>

{#if adaKritisRusak}
	<div
		class="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 text-[11px] text-rose-700 dark:text-rose-300 mb-4 flex items-start gap-2"
	>
		<IconAlertTriangle size={15} class="shrink-0 mt-0.5" />
		<span>Ada item KRITIS (rem/ban/lampu) bermasalah. Perjalanan akan diblokir & tiket perbaikan dibuat otomatis.</span>
	</div>
{/if}

{#if showKm}
	<div class="mb-4">
		<label class="block text-xs font-bold mb-1" style="color: var(--sys-label, #0f172a)">
			{kmLabel}{#if pemilihanEksplisit} <span class="text-rose-500">*</span>{/if}
		</label>
		<input
			type="number"
			min="0"
			inputmode="numeric"
			{disabled}
			placeholder={pemilihanEksplisit ? 'Ketik angka KM di dashboard' : ''}
			bind:value={kmSaatCek}
			class="w-full px-3 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
		/>
		{#if kmHint}
			<p class="text-[11px] mt-1" style="color: var(--sys-label3, #64748b)">{kmHint}</p>
		{/if}
	</div>
{/if}

{#if pemilihanEksplisit}
	<div class="mb-4">
		<label class="block text-xs font-bold mb-1" style="color: var(--sys-label, #0f172a)">
			Foto Dashboard (angka KM &amp; jarum bensin terlihat)
		</label>
		<label
			class="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer"
			style="border-color: var(--sys-sep, #e2e8f0)"
		>
			<input type="file" accept="image/*" capture="environment" class="hidden" {disabled} onchange={onDashChange} />
			{#if dashPreview}
				<img src={dashPreview} alt="Foto dashboard" class="h-20 rounded-lg object-cover" />
			{:else}
				<IconCamera size={20} style="color: var(--sys-label3, #64748b)" />
				<span class="text-xs" style="color: var(--sys-label3, #64748b)">Foto Dashboard (kamera)</span>
			{/if}
		</label>
	</div>
{/if}

{#if !pemilihanEksplisit || adaRusak}
	<div class="mb-4">
		<label class="block text-xs font-bold mb-1" style="color: var(--sys-label, #0f172a)">
			{pemilihanEksplisit ? 'Foto Kerusakan' : 'Foto Kendaraan / Dashboard'}
			{#if wajibFotoItem || adaRusak}<span class="text-rose-500">*</span>{/if}
		</label>
		<label
			class="flex items-center justify-center gap-2 p-4 rounded-xl border-2 border-dashed cursor-pointer"
			style="border-color: var(--sys-sep, #e2e8f0)"
		>
			<input type="file" accept="image/*" capture="environment" class="hidden" {disabled} onchange={onFotoChange} />
			{#if fotoPreview}
				<img src={fotoPreview} alt="Preview" class="h-20 rounded-lg object-cover" />
			{:else}
				<IconCamera size={20} style="color: var(--sys-label3, #64748b)" />
				<span class="text-xs" style="color: var(--sys-label3, #64748b)">Ambil Foto (kamera)</span>
			{/if}
		</label>
	</div>
{/if}

<div class="mb-2">
	<label class="block text-xs font-bold mb-1" style="color: var(--sys-label, #0f172a)">Catatan Temuan (Opsional)</label>
	<textarea
		bind:value={temuan}
		rows={2}
		{disabled}
		placeholder="Jelaskan kondisi yang ditemukan bila ada"
		class="w-full px-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
	></textarea>
</div>
