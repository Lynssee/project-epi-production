<!-- src/lib/components/workshop/LaporanKehadiranMaterial.svelte
     WSK-13 §4a — langkah Kehadiran + Alokasi PO + Material + Foto di form Laporan Harian HP.
     Dipakai /workshop. Semua state dimiliki halaman (bindable) supaya ikut draf & antrian offline. -->
<script lang="ts">
	import { STATUS_OPTIONS, attendanceStats, unallocatedHadir, type AttendanceRow, type StatusHadir, type MaterialRow } from '$lib/utils/laporanAbsensi';
	import type { MaterialSuggestion } from '$lib/services/workshopOpsApi';
	import { IconPlus, IconX, IconCamera } from '@tabler/icons-svelte';

	let {
		rows = $bindable<AttendanceRow[]>([]),
		materials = $bindable<MaterialRow[]>([]),
		tidakAdaMaterial = $bindable(false),
		fotoMasuk = $bindable<File | null>(null),
		fotoPulang = $bindable<File | null>(null),
		poFotos = $bindable<Record<number, File[]>>({}),
		reportedPos = [],
		suggestions = []
	}: {
		rows: AttendanceRow[];
		materials: MaterialRow[];
		tidakAdaMaterial: boolean;
		fotoMasuk: File | null;
		fotoPulang: File | null;
		poFotos: Record<number, File[]>;
		/** PO yang sudah ada isian pekerjaannya hari ini */
		reportedPos: Array<{ id: number; label: string }>;
		suggestions: MaterialSuggestion[];
	} = $props();

	let stats = $derived(attendanceStats(rows));
	let belumAlokasi = $derived(unallocatedHadir(rows));

	const STATUS_CLS: Record<StatusHadir, string> = {
		hadir: 'bg-emerald-600 text-white border-emerald-600',
		ijin: 'bg-sky-600 text-white border-sky-600',
		sakit: 'bg-amber-500 text-white border-amber-500',
		absen: 'bg-rose-600 text-white border-rose-600'
	};

	function setStatus(r: AttendanceRow, s: StatusHadir) {
		r.status_hadir = s;
		if (s !== 'hadir') r.alokasi = 'none';
	}
	function semuaHadir() {
		for (const r of rows) { r.status_hadir = 'hadir'; r.keterangan = ''; }
	}
	function alokasiValue(r: AttendanceRow): string {
		return r.alokasi === 'none' ? 'none' : r.alokasi === 'split' ? 'split' : String(r.alokasi);
	}
	function setAlokasi(r: AttendanceRow, v: string) {
		r.alokasi = v === 'none' ? 'none' : v === 'split' ? 'split' : Number(v);
	}

	function addMaterial() {
		tidakAdaMaterial = false;
		materials = [...materials, { kategori: 'consumable', nama_material: '', qty: 0, satuan: '', keterangan: '' }];
	}
	function removeMaterial(i: number) { materials = materials.filter((_, idx) => idx !== i); }
	function onMaterialName(m: MaterialRow) {
		const hit = suggestions.find((s) => s.nama.toLowerCase() === m.nama_material.trim().toLowerCase());
		if (hit) { if (!m.satuan) m.satuan = hit.satuan; m.kategori = hit.kategori || m.kategori; }
	}

	function setPoFoto(poId: number, files: File[]) { poFotos = { ...poFotos, [poId]: files }; }
</script>

<!-- ─── ② Kehadiran & Alokasi ─────────────────────────────────────────── -->
<div class="mb-3 p-3 rounded-xl border bg-white space-y-2" style="border-color: var(--sys-sep)">
	<div class="flex items-center justify-between gap-2">
		<label class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label2)">Kehadiran Tim</label>
		<button type="button" class="text-[10px] font-bold px-2 py-1 rounded-lg border" style="border-color: var(--sys-sep)" onclick={semuaHadir} title="Tandai semua orang di daftar sebagai Hadir">✓ Semua Hadir</button>
	</div>
	<p class="text-[10px]" style="color: var(--sys-label4)">
		Tandai yang <b>tidak</b> hadir saja — default semua Hadir. Hadir = <b>{stats.hadir}</b> dari {stats.total}
		{#if stats.ijin + stats.sakit > 0}· Izin/Sakit {stats.ijin + stats.sakit}{/if}
		{#if stats.absen > 0}· <span class="text-rose-600 font-bold">Alpha {stats.absen}</span>{/if}.
		Jumlah Tenaga dihitung otomatis dari yang Hadir.
	</p>

	{#each rows as r (r.tipe + ':' + r.rosterId)}
		<div class="rounded-lg border p-2 {r.status_hadir === 'hadir' ? '' : 'bg-slate-50'}" style="border-color: var(--sys-sep)">
			<div class="flex items-center justify-between gap-2">
				<div class="min-w-0">
					<div class="text-[12px] font-bold truncate">{r.nama}</div>
					<div class="text-[10px] truncate" style="color: var(--sys-label3)">{r.tipe === 'leader' ? '👷 Leader' : r.jabatan || 'Manpower'}</div>
				</div>
				<div class="flex gap-1 shrink-0" role="group" aria-label="Status kehadiran {r.nama}">
					{#each STATUS_OPTIONS as o}
						<button
							type="button"
							class="w-8 h-8 rounded-lg border text-[11px] font-black {r.status_hadir === o.value ? STATUS_CLS[o.value] : 'bg-white text-slate-500'}"
							style={r.status_hadir === o.value ? '' : 'border-color: var(--sys-sep)'}
							title={o.label}
							aria-pressed={r.status_hadir === o.value}
							onclick={() => setStatus(r, o.value)}>{o.short}</button>
					{/each}
				</div>
			</div>
			{#if r.status_hadir === 'hadir'}
				<div class="mt-1.5 flex items-center gap-1.5">
					<span class="text-[10px] shrink-0" style="color: var(--sys-label3)">Mengerjakan:</span>
					<select class="flex-1 min-w-0 px-1.5 py-1 border rounded-lg text-[11px] bg-white" style="border-color: var(--sys-sep)" value={alokasiValue(r)} onchange={(e: any) => setAlokasi(r, e.target.value)} title="PO yang dikerjakan orang ini hari ini. 'Bagi rata' = dibagi sama ke semua PO yang dilaporkan.">
						<option value="none">— belum dialokasikan —</option>
						{#if reportedPos.length > 1}<option value="split">Bagi rata semua PO</option>{/if}
						{#each reportedPos as po}<option value={String(po.id)}>{po.label}</option>{/each}
					</select>
				</div>
			{:else}
				<input type="text" class="mt-1.5 w-full px-2 py-1 border rounded-lg text-[11px]" style="border-color: var(--sys-sep)" placeholder={r.status_hadir === 'absen' ? 'Alasan tidak hadir (wajib dicatat)…' : 'Keterangan (opsional)…'} bind:value={r.keterangan} />
			{/if}
		</div>
	{/each}

	{#if belumAlokasi.length > 0 && reportedPos.length > 0}
		<p class="text-[10px] text-amber-700">⚠️ {belumAlokasi.length} orang Hadir belum dialokasikan ke PO ({belumAlokasi.slice(0, 3).map((r) => r.nama).join(', ')}{belumAlokasi.length > 3 ? '…' : ''}). Boleh disimpan, tetapi alokasi membantu hitung biaya per PO.</p>
	{/if}
	{#if reportedPos.length === 0}
		<p class="text-[10px]" style="color: var(--sys-label4)">Isi pekerjaan di PO dulu (di atas) supaya alokasi PO bisa dipilih.</p>
	{/if}
</div>

<!-- ─── ③ Material terpakai ───────────────────────────────────────────── -->
<div class="mb-3 p-3 rounded-xl border bg-white space-y-2" style="border-color: var(--sys-sep)">
	<div class="flex items-center justify-between gap-2">
		<label class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label2)">Material Terpakai Hari Ini</label>
		<button type="button" class="text-[10px] font-bold px-2 py-1 rounded-lg border flex items-center gap-1" style="border-color: var(--sys-sep)" onclick={addMaterial}><IconPlus size={12} /> Tambah</button>
	</div>
	<datalist id="dl-material-suggest">
		{#each suggestions as s}<option value={s.nama}>{s.satuan}</option>{/each}
	</datalist>
	{#each materials as m, i}
		<div class="rounded-lg border p-2 space-y-1.5" style="border-color: var(--sys-sep)">
			<div class="flex items-center gap-1.5">
				<input type="text" list="dl-material-suggest" class="flex-1 min-w-0 px-2 py-1.5 border rounded-lg text-[12px]" style="border-color: var(--sys-sep)" placeholder="Nama material (ketik untuk cari)…" bind:value={m.nama_material} onchange={() => onMaterialName(m)} />
				<button type="button" aria-label="Hapus material" class="p-1" onclick={() => removeMaterial(i)}><IconX size={16} /></button>
			</div>
			<div class="grid grid-cols-3 gap-1.5">
				<input type="number" min="0" step="any" class="px-2 py-1.5 border rounded-lg text-[12px]" style="border-color: var(--sys-sep)" placeholder="Qty" bind:value={m.qty} />
				<input type="text" class="px-2 py-1.5 border rounded-lg text-[12px]" style="border-color: var(--sys-sep)" placeholder="Satuan" bind:value={m.satuan} />
				<select class="px-1 py-1.5 border rounded-lg text-[11px] bg-white" style="border-color: var(--sys-sep)" bind:value={m.kategori}>
					<option value="consumable">Consumable</option>
					<option value="pasir">Pasir</option>
					<option value="cat">Cat</option>
					<option value="finishgood">Finish good</option>
					<option value="lainnya">Lainnya</option>
				</select>
			</div>
		</div>
	{/each}
	<label class="flex items-center gap-2 text-[11px]">
		<input type="checkbox" bind:checked={tidakAdaMaterial} onchange={() => { if (tidakAdaMaterial) materials = []; }} />
		Tidak ada pemakaian material hari ini
	</label>
	{#if materials.length === 0 && !tidakAdaMaterial}
		<p class="text-[10px] text-amber-700">Isi minimal 1 material, atau centang “Tidak ada pemakaian material” — supaya rekonsiliasi material admin tidak kosong.</p>
	{/if}
</div>

<!-- ─── ④ Foto absensi & foto progres PO ──────────────────────────────── -->
<div class="mb-3 p-3 rounded-xl border bg-white space-y-2" style="border-color: var(--sys-sep)">
	<label class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label2)">Foto Absensi Tim</label>
	<div class="grid grid-cols-2 gap-2">
		<div>
			<span class="text-[10px] font-bold block mb-0.5" style="color: var(--sys-label3)"><IconCamera size={11} class="inline" /> Grup Masuk (disarankan)</span>
			<input type="file" accept="image/*" capture="environment" class="text-[11px] w-full" onchange={(e: any) => (fotoMasuk = e.target.files?.[0] || null)} />
		</div>
		<div>
			<span class="text-[10px] font-bold block mb-0.5" style="color: var(--sys-label3)"><IconCamera size={11} class="inline" /> Grup Pulang (opsional)</span>
			<input type="file" accept="image/*" capture="environment" class="text-[11px] w-full" onchange={(e: any) => (fotoPulang = e.target.files?.[0] || null)} />
		</div>
	</div>
	{#if !fotoMasuk}<p class="text-[10px] text-amber-700">Tanpa foto grup masuk, gate “Foto absensi laporan harian” di ERP akan menandai laporan ini belum lengkap.</p>{/if}

	{#if reportedPos.length > 0}
		<label class="text-[11px] font-bold uppercase tracking-wider block pt-1" style="color: var(--sys-label2)">Foto Progres per PO</label>
		{#each reportedPos as po}
			<div>
				<span class="text-[10px] font-bold block mb-0.5 truncate" style="color: var(--sys-label3)">{po.label}{poFotos[po.id]?.length ? ` · ${poFotos[po.id].length} foto` : ''}</span>
				<input type="file" accept="image/*" capture="environment" multiple class="text-[11px] w-full" onchange={(e: any) => setPoFoto(po.id, Array.from(e.target.files || []))} />
			</div>
		{/each}
	{/if}
</div>
