<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		ajukanCuti,
		fetchDelegasiKandidat,
		fetchAturanPengajuanCuti,
		type DelegasiKandidat,
		type AturanPengajuanCuti
	} from '$lib/services/ess/cuti';
	import { IconArrowLeft, IconLoader2, IconCircleCheck } from '@tabler/icons-svelte';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { essHints } from '$lib/data/hints/ess';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul ESS; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(essHints, key, 'ess');

	const JENIS_CUTI_OPTIONS = ['Cuti Tahunan', 'Cuti Sakit', 'Cuti Melahirkan', 'Cuti Khusus', 'Cuti Tidak Berbayar', 'Lainnya'];
	// Fase 4.3 (UU 13/2003 Ps. 93) — kuota terpisah, tidak mengurangi cuti tahunan.
	const SUB_JENIS_CUTI_KHUSUS_OPTIONS = [
		{ value: 'Menikah', label: 'Menikah (3 hari)' },
		{ value: 'Menikahkan Anak', label: 'Menikahkan Anak (2 hari)' },
		{ value: 'Mengkhitankan/Membaptiskan Anak', label: 'Mengkhitankan/Membaptiskan Anak (2 hari)' },
		{ value: 'Istri Melahirkan/Keguguran', label: 'Istri Melahirkan/Keguguran (2 hari)' },
		{ value: 'Keluarga Meninggal (Serumah)', label: 'Keluarga Meninggal Serumah (2 hari)' },
		{ value: 'Keluarga Meninggal (Tidak Serumah)', label: 'Keluarga Meninggal Tidak Serumah (1 hari)' }
	];

	function getTodayString() {
		const d = new Date();
		const offset = d.getTimezoneOffset();
		const localDate = new Date(d.getTime() - offset * 60 * 1000);
		return localDate.toISOString().split('T')[0];
	}

	let jenisCuti = $state('Cuti Tahunan');
	let subJenisCutiKhusus = $state('');
	let tanggalMulai = $state(getTodayString());
	let tanggalSelesai = $state(getTodayString());
	let durasi = $state<'FULL' | 'HALF'>('FULL'); // HALF = cuti 1/2 hari (hanya bila 1 tanggal)
	let paruh = $state<'pagi' | 'siang'>('pagi');
	let alasan = $state('');
	let delegasiKaryawanId = $state('');
	let delegasiCatatan = $state('');
	let rekanKerja = $state<DelegasiKandidat[]>([]);
	let lampiranFile = $state<File | null>(null);

	function handleLampiranChange(e: Event) {
		const target = e.target as HTMLInputElement;
		lampiranFile = target.files?.[0] || null;
	}

	let aturan = $state<AturanPengajuanCuti | null>(null);

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);

	// Tanggal mulai paling cepat (aturan "tidak dadakan", dari kebijakan_cuti di server).
	// Kosong = tidak dibatasi (jenis dikecualikan seperti Cuti Sakit, atau aturan belum termuat).
	let minMulai = $derived(
		aturan && aturan.minimumHari > 0 && !aturan.jenisDikecualikan.includes(jenisCuti) ? aturan.tanggalMinimum : ''
	);
	let terlaluDadakan = $derived(!!minMulai && tanggalMulai < minMulai);

	function formatTanggal(iso: string) {
		return new Date(`${iso}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
	}

	onMount(async () => {
		const [kandidat, aturanRes] = await Promise.allSettled([fetchDelegasiKandidat(), fetchAturanPengajuanCuti()]);
		if (kandidat.status === 'fulfilled') rekanKerja = kandidat.value;
		else console.error('Gagal memuat daftar rekan kerja:', kandidat.reason);
		if (aturanRes.status === 'fulfilled') {
			aturan = aturanRes.value;
			// Default form (Cuti Tahunan) langsung diarahkan ke tanggal paling cepat yang valid.
			if (minMulai && tanggalMulai < minMulai) {
				tanggalMulai = minMulai;
				if (tanggalSelesai < tanggalMulai) tanggalSelesai = tanggalMulai;
			}
		} else {
			console.error('Gagal memuat aturan pengajuan cuti:', aturanRes.reason);
		}
	});

	// Estimasi tampilan saja (exclude Sabtu/Minggu) — nilai final tetap dihitung & divalidasi
	// di server (lihat calcJumlahHari di src/lib/server/ess/cuti.ts) yang juga cek holidays.
	function calcJumlahHari(mulai: string, selesai: string) {
		if (!mulai || !selesai) return 0;
		const start = new Date(`${mulai}T00:00:00`);
		const end = new Date(`${selesai}T00:00:00`);
		if (end < start) return 0;
		let count = 0;
		const cursor = new Date(start);
		while (cursor <= end) {
			const day = cursor.getDay(); // 0 = Minggu, 6 = Sabtu
			if (day !== 0 && day !== 6) count += 1;
			cursor.setDate(cursor.getDate() + 1);
		}
		return count;
	}

	let isSingleDay = $derived(!!tanggalMulai && tanggalMulai === tanggalSelesai);
	// Durasi 1/2 hari hanya untuk 1 tanggal — reset ke FULL bila rentang berubah jadi multi-hari.
	$effect(() => {
		if (!isSingleDay && durasi === 'HALF') durasi = 'FULL';
	});
	let isSetengahHari = $derived(durasi === 'HALF' && isSingleDay);

	let jumlahHari = $derived(
		isSetengahHari ? 0.5 : calcJumlahHari(tanggalMulai, tanggalSelesai)
	);
	// H-08 fix: jumlahHari bisa 0 bila mulai/selesai jatuh di weekend — jangan izinkan submit.
	let canSubmit = $derived(
		!!jenisCuti && !!tanggalMulai && !!tanggalSelesai && tanggalSelesai >= tanggalMulai && jumlahHari > 0 && !terlaluDadakan &&
		(jenisCuti !== 'Cuti Khusus' || !!subJenisCutiKhusus) &&
		(jenisCuti !== 'Cuti Sakit' || !!lampiranFile) &&
		!!delegasiKaryawanId && delegasiCatatan.trim().length >= 5 && !submitting
	);

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = '';
		try {
			await ajukanCuti({
				jenis_cuti: jenisCuti,
				sub_jenis_cuti_khusus: jenisCuti === 'Cuti Khusus' ? subJenisCutiKhusus : undefined,
				tanggal_mulai: tanggalMulai,
				tanggal_selesai: tanggalSelesai,
				paruh: isSetengahHari ? paruh : null,
				alasan: alasan.trim(),
				delegasi_karyawan_id: delegasiKaryawanId,
				delegasi_catatan: delegasiCatatan.trim(),
				lampiranFile
			});
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengajukan cuti.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess/cuti')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Pengajuan cuti terkirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Menunggu persetujuan atasan/HRD.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/ess/cuti')}>
				Kembali ke Riwayat Cuti
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Ajukan Cuti</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Isi form berikut untuk mengajukan cuti/izin/sakit</p>

		<SectionGuide
			id="ess.cuti.page"
			title={h('cuti.page').sectionGuide?.title}
			steps={h('cuti.page').sectionGuide?.steps ?? []}
		/>

		<div class="flex flex-col gap-4">
			<div>
				<p class="text-[12px] font-semibold mb-1.5 inline-flex items-center gap-1.5" style="color: var(--sys-label)">
					Jenis Cuti<HelpIcon text={h('cuti.form.jenis').helpIcon} position="bottom" />
				</p>
				<FieldHint text={h('cuti.form.jenis').fieldHint} />
				<div class="grid grid-cols-2 gap-2">
					{#each JENIS_CUTI_OPTIONS as opt}
						<button
							class="h-10 rounded-lg text-[11px] font-bold"
							style={jenisCuti === opt ? 'background: var(--p, var(--g)); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
							onclick={() => (jenisCuti = opt)}
						>
							{opt}
						</button>
					{/each}
				</div>
			</div>

			{#if jenisCuti === 'Cuti Khusus'}
				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Jenis Cuti Khusus (UU 13/2003)</p>
					<select
						class="w-full rounded-lg border text-[13px] p-3"
						style="border-color: var(--sys-sep)"
						bind:value={subJenisCutiKhusus}
					>
						<option value="">-- Pilih --</option>
						{#each SUB_JENIS_CUTI_KHUSUS_OPTIONS as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
					<FieldHint text={h('cuti.form.jenisKhusus').fieldHint} />
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="mulai">Mulai</label>
					<input
						id="mulai"
						type="date"
						min={minMulai || undefined}
						class="w-full rounded-lg border text-[13px] p-3"
						style="border-color: var(--sys-sep)"
						bind:value={tanggalMulai}
					/>
				</div>
				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="selesai">Selesai</label>
					<input
						id="selesai"
						type="date"
						min={tanggalMulai}
						class="w-full rounded-lg border text-[13px] p-3"
						style="border-color: var(--sys-sep)"
						bind:value={tanggalSelesai}
					/>
				</div>
			</div>
			{#if minMulai}
				<FieldHint
					type={terlaluDadakan ? 'warning' : 'info'}
					text={`Tidak boleh dadakan: hari ini dan ${aturan!.minimumHari - 1} hari berikutnya tidak bisa dipilih. Tanggal mulai paling cepat ${formatTanggal(minMulai)}. Darurat? Hubungi HRD langsung.`}
				/>
			{/if}

			{#if isSingleDay}
				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Durasi</p>
					<div class="grid grid-cols-2 gap-2">
						<button
							class="h-10 rounded-lg text-[11px] font-bold"
							style={durasi === 'FULL' ? 'background: var(--p, var(--g)); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
							onclick={() => (durasi = 'FULL')}
						>
							1 Hari Penuh
						</button>
						<button
							class="h-10 rounded-lg text-[11px] font-bold"
							style={durasi === 'HALF' ? 'background: var(--p, var(--g)); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
							onclick={() => (durasi = 'HALF')}
						>
							½ Hari
						</button>
					</div>
					{#if durasi === 'HALF'}
						<p class="text-[12px] font-semibold mb-1.5 mt-3" style="color: var(--sys-label)">Sesi</p>
						<div class="grid grid-cols-2 gap-2">
							<button
								class="h-10 rounded-lg text-[11px] font-bold"
								style={paruh === 'pagi' ? 'background: var(--p, var(--g)); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
								onclick={() => (paruh = 'pagi')}
							>
								Sesi Pagi (08:00–12:00)
							</button>
							<button
								class="h-10 rounded-lg text-[11px] font-bold"
								style={paruh === 'siang' ? 'background: var(--p, var(--g)); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
								onclick={() => (paruh = 'siang')}
							>
								Sesi Siang (13:00–17:00)
							</button>
						</div>
						<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">
							Memotong jatah cuti 0,5 hari. Sesi lainnya tetap wajib hadir &amp; absen seperti biasa.
						</p>
					{/if}
				</div>
			{/if}

			<div>
				<div class="rounded-lg px-4 py-2.5 text-[12px] flex justify-between items-center font-semibold" style="background: var(--sys-fill); color: var(--sys-label)">
					<span class="inline-flex items-center gap-1.5">
						Jumlah Hari:<HelpIcon text={h('cuti.form.tanggal').helpIcon} position="right" />
					</span>
					<span class="text-[14px]" style="color: var(--p, var(--g))">
						{isSetengahHari ? '0,5' : jumlahHari} Hari{isSetengahHari ? ` — ${paruh === 'pagi' ? 'Pagi' : 'Siang'}` : ''}
					</span>
				</div>
				<FieldHint
					text={h('cuti.form.tanggal').fieldHint}
					type={h('cuti.form.tanggal').type}
				/>
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="alasan">Alasan</label>
				<textarea
					id="alasan"
					class="w-full rounded-lg border text-[13px] p-3"
					style="border-color: var(--sys-sep)"
					rows="3"
					placeholder="Sebutkan alasan cuti (opsional)"
					bind:value={alasan}
				></textarea>
				<FieldHint text={h('cuti.form.alasan').fieldHint} />
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5 inline-flex items-center gap-1.5" style="color: var(--sys-label)">
					Lampiran Dokumen Pendukung
					{#if jenisCuti === 'Cuti Sakit'}<span style="color:#DC2626">*</span>{/if}
					<HelpIcon text={h('cuti.form.lampiran').helpIcon} position="bottom" />
				</p>
				<FieldHint text={h('cuti.form.lampiran').fieldHint} type={jenisCuti === 'Cuti Sakit' ? 'warning' : undefined} />
				<input
					type="file"
					accept="image/*,application/pdf"
					class="w-full rounded-lg border text-[13px] p-3"
					style="border-color: var(--sys-sep)"
					onchange={handleLampiranChange}
				/>
				{#if lampiranFile}
					<p class="text-[11px] mt-1" style="color: #16A34A">✓ {lampiranFile.name}</p>
				{/if}
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="delegasi">
					Delegasi Tugas Kepada <span style="color:#DC2626">*</span>
				</label>
				<select
					id="delegasi"
					class="w-full rounded-lg border text-[13px] p-3"
					style="border-color: var(--sys-sep)"
					bind:value={delegasiKaryawanId}
				>
					<option value="">-- Pilih rekan kerja --</option>
					{#each rekanKerja as k}
						<option value={k.id}>{k.nama_karyawan}</option>
					{/each}
				</select>
				<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Rekan kerja yang menanggung tugas Anda selama tidak hadir.</p>
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="delegasiCatatan">
					Tugas yang Didelegasikan <span style="color:#DC2626">*</span>
				</label>
				<textarea
					id="delegasiCatatan"
					class="w-full rounded-lg border text-[13px] p-3"
					style="border-color: var(--sys-sep)"
					rows="3"
					placeholder="Sebutkan tugas/tanggung jawab yang dialihkan selama Anda tidak hadir"
					bind:value={delegasiCatatan}
				></textarea>
			</div>

			{#if errorMsg}
				<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Kirim Pengajuan
			</button>
		</div>
	{/if}
</div>
