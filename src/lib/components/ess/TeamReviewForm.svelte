<script lang="ts">
	// Form review singkat atasan/mentor atas hasil training satu bawahan (mobile-first, satu layar).
	// Otorisasi tim dicek server; review final tidak bisa diubah lagi (koreksi lewat HRD).
	import { getReviewable, submitReview, type ReviewableResponse, type ReviewableEnrollment } from '$lib/services/ess/trainingOutcome';

	let { memberId, nama }: { memberId: number; nama: string } = $props();

	let open = $state(false);
	let loading = $state(false);
	let saving = $state(false);
	let pesan = $state('');
	let data = $state<ReviewableResponse | null>(null);
	let enrollmentId = $state<number | null>(null);
	let kekuatan = $state('');
	let kekurangan = $state('');
	let rekomendasi = $state('');
	let tindakLanjut = $state('none');
	let gaps = $state<{ kategori_id: number | null; severity: string; deskripsi: string }[]>([]);

	const cur = $derived<ReviewableEnrollment | undefined>(data?.enrollments.find((e) => e.enrollmentId === enrollmentId));
	const terkunci = $derived(cur?.review?.status === 'final');

	function pilih(id: number | null) {
		enrollmentId = id;
		const r = data?.enrollments.find((e) => e.enrollmentId === id)?.review;
		kekuatan = r?.kekuatan ?? ''; kekurangan = r?.kekurangan ?? ''; rekomendasi = r?.rekomendasi ?? ''; tindakLanjut = r?.tindakLanjut ?? 'none';
		gaps = (r?.gaps ?? []).map((g) => ({ kategori_id: g.kategori_id, severity: g.severity, deskripsi: g.deskripsi }));
	}

	async function buka() {
		open = true; pesan = ''; loading = true;
		try {
			data = await getReviewable(memberId);
			pilih(data.enrollments[0]?.enrollmentId ?? null);
		} catch (e: any) { pesan = e?.message || 'Gagal memuat.'; }
		loading = false;
	}

	async function simpan(final: boolean) {
		if (!enrollmentId) return;
		saving = true; pesan = '';
		try {
			await submitReview({ memberId, enrollmentId, kekuatan, kekurangan, rekomendasi, tindakLanjut, status: final ? 'final' : 'draft', gaps });
			pesan = final ? 'Review difinalkan. Peserta & HRD dapat melihatnya.' : 'Draft tersimpan.';
			data = await getReviewable(memberId);
			pilih(enrollmentId);
		} catch (e: any) { pesan = e?.message || 'Gagal menyimpan.'; }
		saving = false;
	}

	const inp = 'w-full text-xs rounded-xl p-2.5 border';
	const inpStyle = 'border-color: var(--sys-sep, rgba(0,0,0,0.12)); background: transparent; color: var(--sys-label)';
</script>

<div class="pt-2">
	{#if !open}
		<button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12)); color: var(--sys-label2)" onclick={buka}>📝 Review Hasil Training</button>
		<p class="text-[11px] mt-1" style="color: var(--sys-label4)">Nilai kemampuan {nama} setelah training: kekuatan, kekurangan, dan saran tindak lanjut.</p>
	{:else}
		<div class="space-y-2 p-3 rounded-xl border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12))">
			{#if loading}
				<p class="text-xs" style="color: var(--sys-label4)">Memuat…</p>
			{:else if !data || data.enrollments.length === 0}
				<p class="text-xs" style="color: var(--sys-label4)">{pesan || `${nama} belum punya training untuk direview.`}</p>
			{:else}
				<select class={inp} style={inpStyle} value={enrollmentId} onchange={(e) => pilih(Number((e.currentTarget as HTMLSelectElement).value))}>
					{#each data.enrollments as en (en.enrollmentId)}
						<option value={en.enrollmentId}>{en.programJudul} — {en.status}{en.review ? ` (${en.review.status})` : ''}</option>
					{/each}
				</select>
				{#if terkunci}<p class="text-[11px] font-semibold" style="color: #16a34a">Review sudah final dan tidak bisa diubah.</p>{/if}
				<textarea class={inp} style={inpStyle} rows="2" maxlength="1500" placeholder="Kekuatan: apa yang sudah baik?" bind:value={kekuatan} disabled={terkunci}></textarea>
				<textarea class={inp} style={inpStyle} rows="2" maxlength="1500" placeholder="Kekurangan: apa yang masih perlu diperbaiki?" bind:value={kekurangan} disabled={terkunci}></textarea>

				{#each gaps as g, i}
					<div class="flex gap-1.5 items-start">
						<select class="text-[11px] rounded-lg p-1.5 border" style={inpStyle} bind:value={g.kategori_id} disabled={terkunci}>
							<option value={null}>Kategori</option>
							{#each data.kategori as k}<option value={k.id}>{k.nama}</option>{/each}
						</select>
						<select class="text-[11px] rounded-lg p-1.5 border" style={inpStyle} bind:value={g.severity} disabled={terkunci}>
							<option value="rendah">rendah</option><option value="sedang">sedang</option><option value="tinggi">tinggi</option>
						</select>
						<input class="flex-1 min-w-0 text-[11px] rounded-lg p-1.5 border" style={inpStyle} placeholder="Detail" bind:value={g.deskripsi} disabled={terkunci} />
						{#if !terkunci}<button class="text-xs px-1" onclick={() => (gaps = gaps.filter((_, x) => x !== i))} aria-label="Hapus">✕</button>{/if}
					</div>
				{/each}
				{#if !terkunci && gaps.length < 5}
					<button class="text-[11px] font-bold" style="color: var(--sys-label2)" onclick={() => (gaps = [...gaps, { kategori_id: null, severity: 'sedang', deskripsi: '' }])}>+ Tambah kekurangan terperinci</button>
				{/if}

				<textarea class={inp} style={inpStyle} rows="2" maxlength="1500" placeholder="Saran untuk peserta" bind:value={rekomendasi} disabled={terkunci}></textarea>
				<select class={inp} style={inpStyle} bind:value={tindakLanjut} disabled={terkunci}>
					<option value="none">Tindak lanjut: tidak perlu</option>
					<option value="coaching">Coaching / bimbingan saya</option>
					<option value="remedial">Remedial (ulang modul lemah)</option>
					<option value="ulang">Ulang program</option>
				</select>
				{#if !terkunci}
					<div class="flex gap-2">
						<button class="px-3 py-1.5 rounded-xl text-xs font-bold border" style={inpStyle} disabled={saving} onclick={() => simpan(false)}>Simpan Draft</button>
						<button class="px-3 py-1.5 rounded-xl text-xs font-bold text-white gradient-bg disabled:opacity-50" disabled={saving} onclick={() => simpan(true)}>{saving ? 'Menyimpan…' : 'Finalkan'}</button>
					</div>
					<p class="text-[11px]" style="color: var(--sys-label4)">Draft hanya terlihat Anda. Setelah “Finalkan”, review tidak bisa diubah dan terlihat HRD (peserta sesuai setelan).</p>
				{/if}
			{/if}
			{#if pesan}<p class="text-xs font-semibold" style="color: var(--sys-label2)">{pesan}</p>{/if}
			<button class="text-[11px]" style="color: var(--sys-label3)" onclick={() => (open = false)}>Tutup</button>
		</div>
	{/if}
</div>
