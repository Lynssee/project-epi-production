<script lang="ts">
	// Penilaian OJT lapangan oleh atasan/mentor: pilih bawahan + pelatihan → nilai tiap kompetensi langsung di HP.
	// Hasil final dibaca admin (HRD) di modal Evaluasi Peserta dan menjadi Nilai Praktik.
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getOjtTargets, getOjtForm, saveOjt, type OjtTarget, type OjtForm, type OjtItem } from '$lib/services/ess/ojt';
	import { OJT_RATINGS, OJT_TINDAK_LANJUT, scoreChecklist, suggestTindakLanjut } from '$lib/utils/ojtAssessment.js';
	import { IconChevronLeft, IconAlertTriangle, IconClipboardCheck } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let targets = $state<OjtTarget[]>([]);
	let cari = $state('');

	let form = $state<OjtForm | null>(null);
	let items = $state<OjtItem[]>([]);
	let kekuatan = $state('');
	let kekurangan = $state('');
	let tindak = $state<string>('none');
	let tindakManual = $state(false);
	let formLoading = $state(false);
	let saving = $state(false);
	let pesan = $state('');

	const final = $derived(form?.status === 'final');
	const score = $derived(scoreChecklist(items));
	const saran = $derived(suggestTindakLanjut(score, form?.passingScore ?? 70));
	const tindakAktif = $derived(tindakManual ? tindak : saran);
	const tampil = $derived(
		targets.filter((t) => !cari.trim() || `${t.nama} ${t.programJudul}`.toLowerCase().includes(cari.trim().toLowerCase()))
	);
	const WARNA: Record<number, string> = { 0: '#DC2626', 1: '#D97706', 2: '#059669' };

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			targets = (await getOjtTargets()).targets;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat daftar bawahan.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function buka(t: OjtTarget) {
		formLoading = true;
		pesan = '';
		try {
			const f = await getOjtForm(t.enrollmentId);
			form = f;
			items = f.items;
			kekuatan = f.kekuatan;
			kekurangan = f.kekurangan;
			tindak = f.tindakLanjut || 'none';
			tindakManual = !!f.tindakLanjut;
		} catch (e: any) {
			pesan = e?.message || 'Gagal memuat form.';
		} finally {
			formLoading = false;
		}
	}

	function nilai(idx: number, v: number) {
		if (final) return;
		items = items.map((it, i) => (i === idx ? { ...it, rating: it.rating === v ? null : v } : it));
	}

	async function simpan(finalize: boolean) {
		if (!form) return;
		if (finalize && !score.lengkap) {
			pesan = `Lengkapi semua butir dulu (${score.terisi}/${score.total} terisi).`;
			return;
		}
		saving = true;
		pesan = '';
		try {
			const r = await saveOjt({ enrollmentId: form.enrollmentId, items, kekuatan, kekurangan, tindakLanjut: tindakAktif, finalize });
			pesan = finalize ? `Penilaian difinalkan (skor ${r.skorPersen ?? '-'}%). HRD akan memakainya sebagai Nilai Praktik.` : 'Draft tersimpan.';
			if (finalize) form = { ...form, status: 'final' };
			else form = { ...form, status: 'draft' };
			load();
		} catch (e: any) {
			pesan = e?.message || 'Gagal menyimpan.';
		} finally {
			saving = false;
		}
	}

	function tutupForm() {
		form = null;
		pesan = '';
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<button
		class="flex items-center gap-1 text-xs font-bold mb-4"
		style="color: var(--sys-label3)"
		onclick={() => (form ? tutupForm() : goto('/ess/pelatihan'))}
	>
		<IconChevronLeft size={16} /> {form ? 'Kembali ke daftar' : 'Kembali ke Pelatihan'}
	</button>

	<div class="mb-5 flex items-center gap-3">
		<IconClipboardCheck size={28} style="color: var(--p, var(--g))" />
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Penilaian OJT</h1>
			<p class="text-sm mt-1 font-medium" style="color: var(--sys-label3)">Nilai praktik bawahan langsung di lapangan</p>
		</div>
	</div>

	{#if pesan}
		<p class="text-xs font-semibold mb-3" style="color: var(--sys-label2)" role="status">{pesan}</p>
	{/if}

	{#if form}
		<div class="glass-panel rounded-2xl p-4 mb-3">
			<p class="text-sm font-bold" style="color: var(--sys-label)">{form.nama}</p>
			<p class="text-xs" style="color: var(--sys-label3)">{form.programJudul}</p>
			<p class="text-[11px] mt-2" style="color: var(--sys-label4)">
				Untuk tiap kompetensi, pilih <b>Belum bisa</b>, <b>Dengan arahan</b> (mampu bila dipandu), atau <b>Mandiri</b>. Ketuk lagi untuk membatalkan pilihan.
				Simpan draft kapan saja; <b>Finalkan</b> bila semua butir sudah dinilai.
			</p>
		</div>

		<div class="space-y-2">
			{#each items as it, idx (it.key)}
				<div class="glass-panel rounded-2xl p-3">
					<p class="text-sm font-semibold mb-2" style="color: var(--sys-label)">{it.label}</p>
					<div class="flex gap-1.5">
						{#each OJT_RATINGS as r}
							<button
								disabled={final}
								title={r.hint}
								onclick={() => nilai(idx, r.value)}
								class="flex-1 py-2 rounded-xl text-xs font-bold border disabled:opacity-60"
								style={it.rating === r.value
									? `background:${WARNA[r.value]};color:#fff;border-color:${WARNA[r.value]}`
									: 'color: var(--sys-label3); border-color: var(--sys-sep, rgba(0,0,0,0.12))'}>{r.label}</button>
						{/each}
					</div>
					{#if it.rating !== null}
						<input
							type="text"
							disabled={final}
							bind:value={it.catatan}
							placeholder="Catatan (opsional)"
							class="mt-2 w-full px-3 py-2 text-xs rounded-xl border"
							style="border-color: var(--sys-sep, rgba(0,0,0,0.12))"
						/>
					{/if}
				</div>
			{/each}
		</div>

		<div class="glass-panel rounded-2xl p-4 mt-3 space-y-2">
			<textarea bind:value={kekuatan} disabled={final} rows="2" placeholder="Kekuatan peserta" class="w-full px-3 py-2 text-xs rounded-xl border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12))"></textarea>
			<textarea bind:value={kekurangan} disabled={final} rows="2" placeholder="Hal yang perlu diperbaiki" class="w-full px-3 py-2 text-xs rounded-xl border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12))"></textarea>
			<label class="block text-[11px] font-bold uppercase" style="color: var(--sys-label3)" for="ojt-tl">Tindak lanjut</label>
			<select
				id="ojt-tl"
				disabled={final}
				value={tindakAktif}
				onchange={(e) => { tindak = e.currentTarget.value; tindakManual = true; }}
				class="w-full px-3 py-2 text-xs rounded-xl border"
				style="border-color: var(--sys-sep, rgba(0,0,0,0.12))"
			>
				{#each OJT_TINDAK_LANJUT as t}<option value={t.value}>{t.label}</option>{/each}
			</select>
			<p class="text-[11px]" style="color: var(--sys-label4)">Disarankan otomatis dari skor (di bawah {form.passingScore}% → Remedial). Boleh diubah.</p>
		</div>

		<div class="sticky bottom-2 mt-3 glass-panel rounded-2xl p-3 flex items-center justify-between gap-2">
			<span class="text-sm font-extrabold" style="color: {score.persen != null && score.persen >= form.passingScore ? '#059669' : '#D97706'}">
				Skor: {score.persen ?? '-'}{score.persen != null ? '%' : ''} <span class="text-[11px] font-semibold" style="color: var(--sys-label4)">({score.terisi}/{score.total})</span>
			</span>
			{#if final}
				<span class="text-xs font-semibold" style="color: var(--sys-label4)">Sudah final</span>
			{:else}
				<div class="flex gap-2">
					<button class="px-3 py-2 rounded-xl text-xs font-bold glass-panel disabled:opacity-40" disabled={saving || score.terisi === 0} onclick={() => simpan(false)}>Simpan draft</button>
					<button class="px-3 py-2 rounded-xl text-xs font-bold text-white gradient-bg disabled:opacity-40" disabled={saving || !score.lengkap} onclick={() => simpan(true)}>Finalkan</button>
				</div>
			{/if}
		</div>
	{:else if loading || formLoading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<IconAlertTriangle size={32} class="mx-auto mb-3" style="color: #DC2626" />
			<p class="text-sm text-red-500 mb-4">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg" onclick={load}>Coba Lagi</button>
		</div>
	{:else if targets.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada pelatihan bawahan yang sedang berjalan untuk dinilai.</p>
			<p class="text-xs mt-1" style="color: var(--sys-label4)">Pelatihan muncul di sini setelah HRD mendaftarkan bawahan Anda ke program (mis. Troubleshoot Kompresor).</p>
		</div>
	{:else}
		<input type="search" bind:value={cari} placeholder="Cari nama / pelatihan…" class="w-full px-3 py-2 text-sm rounded-xl border mb-3" style="border-color: var(--sys-sep, rgba(0,0,0,0.12))" />
		<div class="space-y-2">
			{#each tampil as t (t.enrollmentId)}
				<button class="w-full text-left glass-panel rounded-2xl p-3 flex items-center justify-between gap-3" onclick={() => buka(t)}>
					<span class="min-w-0">
						<span class="block text-sm font-bold truncate" style="color: var(--sys-label)">{t.nama}</span>
						<span class="block text-xs truncate" style="color: var(--sys-label3)">{t.programJudul} · modul {t.progressPersen}%</span>
					</span>
					<span class="text-[11px] font-bold px-2 py-1 rounded-lg shrink-0"
						style={t.statusOjt === 'final' ? 'background:#D1FAE5;color:#047857' : t.statusOjt === 'draft' ? 'background:#FEF3C7;color:#B45309' : 'background:rgba(0,0,0,0.06);color:var(--sys-label3)'}>
						{t.statusOjt === 'final' ? `Final ${t.skorPersen ?? ''}%` : t.statusOjt === 'draft' ? 'Draft' : 'Belum dinilai'}
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
