<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Project Leader view (Rekomendasi #5 dokumen implementation_plan_pelatihan & jabatan.md):
	// progress silabus jabatan anggota tim langsung (karyawan.atasan_id == diri sendiri).
	import { goto } from '$app/navigation';
	import TeamReviewForm from '$lib/components/ess/TeamReviewForm.svelte';
	import { onMount } from 'svelte';
	import { getTimSilabus, getTimKesehatan, catatPembinaanTim, setujuiPercobaanUlang, type TeamMemberSilabusProgress, type TeamTrainingHealth, type TeamTrainingMember } from '$lib/services/ess/silabus';
	import { IconAlertTriangle, IconNotes, IconTrendingUp, IconChevronLeft, IconChevronDown, IconCircleCheck, IconCircleDashed, IconLoader2, IconLock, IconProgressCheck, IconUsersGroup } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let anggota = $state<TeamMemberSilabusProgress[]>([]);
	let expandedKaryawanId = $state<number | null>(null);
	// Kesehatan training tim (nilai kuis, dampak ke KPI atasan). Gagal memuat TIDAK menggagalkan halaman silabus.
	let kesehatan = $state<TeamTrainingHealth | null>(null);
	let filter = $state<'semua' | 'perlu' | 'lulus'>('semua');
	let pembinaanFor = $state<number | null>(null);
	let catatan = $state('');
	let simpanPembinaan = $state(false);
	// Persetujuan percobaan ulang kuis: kunci "enrollmentId:quizId" yang sedang diisi catatannya.
	let setujuiFor = $state<string | null>(null);
	let catatanSetuju = $state('');
	let pesan = $state('');
	const kesehatanById = $derived(new Map<number, TeamTrainingMember>((kesehatan?.anggota ?? []).map((a) => [a.karyawanId, a])));
	const anggotaTampil = $derived(
		anggota.filter((m) => {
			const k = kesehatanById.get(m.karyawanId);
			if (filter === 'perlu') return !!k && (k.status === 'perlu_dibina' || k.status === 'pantau');
			if (filter === 'lulus') return !!k && k.status === 'tuntas';
			return true;
		})
	);
	const STATUS_LABEL: Record<TeamTrainingMember['status'], { teks: string; warna: string }> = {
		perlu_dibina: { teks: 'Perlu dibina', warna: '#DC2626' },
		pantau: { teks: 'Pantau', warna: '#D97706' },
		tuntas: { teks: 'Tuntas', warna: 'var(--g)' },
		belum_terhitung: { teks: 'Belum terhitung', warna: 'var(--sys-label4)' }
	};

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const [res, kes] = await Promise.all([
				getTimSilabus(),
				getTimKesehatan().catch((e) => { console.warn('[tim] kesehatan training gagal dimuat:', e?.message || e); return null; })
			]);
			anggota = res.anggota;
			kesehatan = kes;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat progress tim.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function kirimPersetujuan(enrollmentId: number, quizId: number) {
		simpanPembinaan = true;
		pesan = '';
		try {
			await setujuiPercobaanUlang(enrollmentId, quizId, catatanSetuju);
			pesan = 'Percobaan ulang disetujui — bawahan dapat mengerjakan kuis sekali lagi.';
			setujuiFor = null;
			catatanSetuju = '';
			kesehatan = await getTimKesehatan().catch(() => kesehatan);
		} catch (e: any) {
			pesan = e?.message || 'Gagal menyimpan persetujuan.';
		} finally {
			simpanPembinaan = false;
		}
	}

	async function kirimPembinaan(memberId: number) {
		simpanPembinaan = true;
		pesan = '';
		try {
			const r = await catatPembinaanTim(memberId, catatan);
			pesan = r.created ? 'Pembinaan tercatat (Action Plan baru dibuat).' : 'Pembinaan ditambahkan ke Action Plan bulan ini.';
			catatan = '';
			pembinaanFor = null;
		} catch (e: any) {
			pesan = e?.message || 'Gagal menyimpan pembinaan.';
		} finally {
			simpanPembinaan = false;
		}
	}

	function toggleExpand(karyawanId: number) {
		expandedKaryawanId = expandedKaryawanId === karyawanId ? null : karyawanId;
	}

	function overallPersen(m: TeamMemberSilabusProgress): number {
		return m.totalWajibKeseluruhan > 0 ? Math.round((m.selesaiKeseluruhan / m.totalWajibKeseluruhan) * 100) : 0;
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<button
		class="flex items-center gap-1 text-xs font-bold mb-4"
		style="color: var(--sys-label3)"
		onclick={() => goto('/ess/pelatihan')}
	>
		<IconChevronLeft size={16} /> Kembali ke Pelatihan
	</button>

	<div class="mb-6 flex items-center gap-3">
		<IconUsersGroup size={28} style="color: var(--p, var(--g))" />
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Progress Tim</h1>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Silabus training anggota tim yang berada langsung di bawah Anda</p>
		</div>
	</div>

	{#if !loading && !errorMsg && kesehatan?.aktif && kesehatan.estimasiKpi != null}
		<!-- Dampak ke KPI atasan: hasil training tim menjadi indikator "Akuntabilitas Training & Pembinaan Tim" -->
		<div class="glass-panel rounded-2xl p-4 mb-4 flex items-start gap-3" data-testid="banner-dampak-kpi">
			<IconTrendingUp size={22} class="shrink-0 mt-0.5" style="color: var(--p, var(--g))" />
			<div class="min-w-0">
				<p class="text-sm font-bold" style="color: var(--sys-label)">
					Skor pembinaan tim Anda: {kesehatan.estimasiKpi}%
					{#if kesehatan.mode === 'shadow'}<span class="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700">simulasi</span>{/if}
				</p>
				<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
					Rata-rata kelulusan {kesehatan.rataKelulusan}% · rata-rata nilai {kesehatan.rataNilai ?? '—'} · {kesehatan.perluDibina} bawahan perlu dibina.
					{kesehatan.mode === 'shadow' ? 'Saat ini hanya perkiraan dan belum mengubah KPI Anda.' : 'Angka ini menjadi bagian KPI kepemimpinan Anda.'}
				</p>
				<p class="text-[11px] mt-1" style="color: var(--sys-label4)">Tips: buka bawahan berstatus "Perlu dibina", lalu tekan "Catat Pembinaan" — kelulusan tim yang naik langsung memperbaiki skor ini.</p>
			</div>
		</div>
	{/if}
	{#if !loading && !errorMsg && kesehatan?.aktif && anggota.length > 0}
		<div class="flex flex-wrap gap-2 mb-3" role="group" aria-label="Filter anggota tim">
			{#each [['semua', 'Semua'], ['perlu', 'Perlu dibina / dipantau'], ['lulus', 'Tuntas']] as [k, label]}
				<button class="px-3 py-1.5 rounded-full text-xs font-bold border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12)); {filter === k ? 'background: var(--p, var(--g)); color: #fff' : 'color: var(--sys-label3)'}" onclick={() => (filter = k as typeof filter)}>{label}</button>
			{/each}
		</div>
	{/if}
	{#if pesan}
		<p class="text-xs font-semibold mb-3" style="color: var(--sys-label2)" role="status">{pesan}</p>
	{/if}

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat progress pelatihan tim..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else if anggota.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<IconUsersGroup size={32} class="mx-auto mb-3" style="color: var(--sys-label4)" />
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada anggota tim yang tertaut ke Anda sebagai atasan langsung.</p>
			<p class="text-xs mt-1" style="color: var(--sys-label4)">Hubungi HRD bila seharusnya ada anggota tim di bawah Anda.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each anggotaTampil as m (m.karyawanId)}
				{@const kes = kesehatanById.get(m.karyawanId)}
				<div class="glass-panel rounded-2xl overflow-hidden">
					<button
						class="w-full flex items-center justify-between gap-3 p-4 text-left"
						onclick={() => toggleExpand(m.karyawanId)}
					>
						<div class="flex items-center gap-3 min-w-0">
							<IconChevronDown size={16} class="shrink-0 transition-transform {expandedKaryawanId === m.karyawanId ? 'rotate-180' : ''}" style="color: var(--sys-label4)" />
							<div class="min-w-0">
								<h3 class="text-sm font-bold truncate" style="color: var(--sys-label)">{m.namaKaryawan}</h3>
								<p class="text-xs truncate" style="color: var(--sys-label4)">{m.position?.nama_posisi || 'Jabatan belum terdata'}</p>
							</div>
						</div>
						<div class="flex items-center gap-2 shrink-0">
							{#if kes}
								<span class="text-[11px] font-bold" style="color: {STATUS_LABEL[kes.status].warna}">{STATUS_LABEL[kes.status].teks}{kes.avgNilai != null ? ` · ${kes.avgNilai}` : ''}</span>
							{/if}
							{#if m.totalWajibKeseluruhan === 0}
								<span class="text-xs font-medium" style="color: var(--sys-label4)">Tanpa silabus wajib</span>
							{:else}
								<div class="w-20 h-2 rounded-full bg-white/40 overflow-hidden">
									<div class="h-full rounded-full gradient-bg" style="width: {overallPersen(m)}%"></div>
								</div>
								<span class="text-xs font-bold" style="color: var(--sys-label3)">{m.selesaiKeseluruhan}/{m.totalWajibKeseluruhan}</span>
							{/if}
						</div>
					</button>

					{#if expandedKaryawanId === m.karyawanId}
						<div class="px-4 pb-4 space-y-3 border-t" style="border-color: var(--sys-sep, rgba(0,0,0,0.06))">
							{#if kes && kes.training.length > 0}
								<div class="pt-3">
									<p class="text-xs font-bold mb-1.5" style="color: var(--sys-label2)">Nilai & status training</p>
									<div class="flex flex-col gap-1">
										{#each kes.training as t}
											<div class="flex items-center justify-between gap-2 text-xs" style="color: var(--sys-label3)">
												<span class="truncate">{t.judul}</span>
												<span class="shrink-0 font-semibold" style="color: {t.terlambat || t.status === 'Gagal' || t.status === 'Remedial' ? '#DC2626' : 'var(--sys-label3)'}">{t.status}{t.nilai != null ? ' · ' + t.nilai : ''}{t.terlambat ? ' · terlambat' : ''}</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}
							{#if kes?.perluPersetujuan?.length}
								<div class="pt-2 space-y-2" data-testid="persetujuan-percobaan">
									{#each kes.perluPersetujuan as p (p.enrollmentId + ':' + p.quizId)}
										{@const k = p.enrollmentId + ':' + p.quizId}
										<div class="rounded-xl p-3 border" style="border-color: #D97706">
											<p class="text-xs font-bold" style="color: var(--sys-label)">Kuis "{p.quizJudul}" — batas percobaan tercapai ({p.percobaan}x)</p>
											<p class="text-[11px] mt-0.5" style="color: var(--sys-label4)">Bina dulu {m.namaKaryawan}, tulis hasil pembinaannya, lalu setujui SATU percobaan ulang.</p>
											{#if setujuiFor === k}
												<textarea bind:value={catatanSetuju} rows="2" maxlength="1500" placeholder="Hasil pembinaan (min. 5 karakter)" class="w-full text-xs rounded-xl p-2.5 border mt-2" style="border-color: var(--sys-sep, rgba(0,0,0,0.12)); background: transparent; color: var(--sys-label)"></textarea>
												<div class="flex gap-2 mt-2">
													<button class="px-3 py-1.5 rounded-xl text-xs font-bold text-white gradient-bg disabled:opacity-50" disabled={simpanPembinaan || catatanSetuju.trim().length < 5} onclick={() => kirimPersetujuan(p.enrollmentId, p.quizId)}>{simpanPembinaan ? 'Menyimpan…' : 'Setujui Percobaan Ulang'}</button>
													<button class="px-3 py-1.5 rounded-xl text-xs font-bold" style="color: var(--sys-label3)" onclick={() => { setujuiFor = null; catatanSetuju = ''; }}>Batal</button>
												</div>
											{:else}
												<button class="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12)); color: var(--sys-label2)" onclick={() => { setujuiFor = k; catatanSetuju = ''; pesan = ''; }}>
													<IconNotes size={14} /> Setujui Percobaan Ulang
												</button>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
							{#if kes?.status === 'perlu_dibina' || kes?.status === 'pantau'}
								<div class="pt-2">
									{#if pembinaanFor === m.karyawanId}
										<textarea bind:value={catatan} rows="3" maxlength="1500" placeholder="Apa yang Anda bahas/lakukan untuk membina {m.namaKaryawan}? (min. 5 karakter)" class="w-full text-xs rounded-xl p-2.5 border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12)); background: transparent; color: var(--sys-label)"></textarea>
										<div class="flex gap-2 mt-2">
											<button class="px-3 py-1.5 rounded-xl text-xs font-bold text-white gradient-bg disabled:opacity-50" disabled={simpanPembinaan || catatan.trim().length < 5} onclick={() => kirimPembinaan(m.karyawanId)}>{simpanPembinaan ? 'Menyimpan…' : 'Simpan Pembinaan'}</button>
											<button class="px-3 py-1.5 rounded-xl text-xs font-bold" style="color: var(--sys-label3)" onclick={() => { pembinaanFor = null; catatan = ''; }}>Batal</button>
										</div>
									{:else}
										<button class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border" style="border-color: var(--sys-sep, rgba(0,0,0,0.12)); color: var(--sys-label2)" onclick={() => { pembinaanFor = m.karyawanId; catatan = ''; pesan = ''; }}>
											<IconNotes size={14} /> Catat Pembinaan
										</button>
										<p class="text-[11px] mt-1" style="color: var(--sys-label4)">Catatan tersimpan sebagai Action Plan Anda bulan ini dan dilihat HRD saat cutoff KPI.</p>
									{/if}
								</div>
							{/if}
							<TeamReviewForm memberId={m.karyawanId} nama={m.namaKaryawan} />
							{#if m.silabusList.length === 0}
								<p class="text-xs pt-3" style="color: var(--sys-label4)">Belum ada silabus aktif untuk jabatan ini.</p>
							{:else}
								{#each m.silabusList as s (s.id)}
									<div class="pt-3">
										<div class="flex items-center justify-between mb-1.5">
											<span class="text-xs font-bold" style="color: var(--sys-label2)">{s.namaSilabus}</span>
											<span class="text-[11px] font-semibold" style="color: var(--sys-label4)">{s.wajibSelesai}/{s.totalWajib}</span>
										</div>
										<div class="flex flex-col gap-1">
											{#each s.materi as mat (mat.id)}
												<div class="flex items-center gap-2 text-xs" style="color: var(--sys-label3)">
													{#if mat.locked}
														<IconLock size={13} style="color: var(--sys-label4)" class="shrink-0" />
													{:else if mat.status === 'Lulus'}
														<IconCircleCheck size={13} style="color: var(--g)" class="shrink-0" />
													{:else if mat.status === 'Ongoing' || mat.status === 'Enrolled'}
														<IconProgressCheck size={13} style="color: var(--p, var(--g))" class="shrink-0" />
													{:else}
														<IconCircleDashed size={13} style="color: var(--sys-label4)" class="shrink-0" />
													{/if}
													<span class="truncate">{mat.programJudul}</span>
												</div>
											{/each}
										</div>
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
