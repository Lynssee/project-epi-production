<script lang="ts">
	// Rencana Self-Service PL v2 — FASE 6: Onboarding Manpower Lapangan.
	// Satu layar, empat langkah. Project Leader mendaftarkan pekerja baru dari lokasi
	// tanpa menunggu admin input ulang. Hasilnya: manpower (status_pekerja='calon') +
	// manpower_dokumen (KTP + TTD) + manpower_assignment (status 'menunggu_validasi',
	// yang otomatis mendaftarkan SPK ke Approval Center resource.spk).
	//
	// K4: setelah terdaftar, pekerja boleh diabsen dari layar regu selama
	// `manpower.masa_sementara_hari` (default 3) hari kerja; lewat itu absensinya
	// terkunci sampai admin menyetujui SPK.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { createManpower, updateManpower, createManpowerDokumen, findManpowerByNik, findManpowerByNama } from '$lib/services/manpower';
	import { createAssignment } from '$lib/services/manpowerAssignment';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';

	// Pola toast repo ini: Toast.svelte global lewat window.__showToast (bukan svelte-sonner).
	const toast = {
		success: (m: string) => (window as any).__showToast?.(m, 'success'),
		error: (m: string) => (window as any).__showToast?.(m, 'error')
	};

	let step = $state(1);
	let submitting = $state(false);

	// ── Langkah 1: identitas ────────────────────────────────────────────────
	let nama = $state('');
	let nik = $state('');
	let noHp = $state('');
	let noBpjsTk = $state('');
	let namaKontakDarurat = $state('');
	let noHpDarurat = $state('');
	let golonganDarah = $state('');
	let riwayatAlergi = $state('');
	let keahlian = $state('');
	let projects = $state<any[]>([]);
	let projectId = $state<string>('');
	let tanggalMulai = $state(new Date().toISOString().slice(0, 10));
	let tanggalSelesai = $state('');

	let nikChecking = $state(false);
	let nikExisting = $state<any>(null);
	let nikError = $derived(nik && !/^\d{16}$/.test(nik) ? 'NIK harus 16 digit angka.' : '');

	// GPA-10: peringatan nama kembar — pengguna harus menegaskan ini orang berbeda sebelum lanjut.
	let namaMirip = $state<Array<{ id: number; nama: string; posisi: string | null; status_pekerja: string | null }>>([]);
	let namaBedaOrang = $state(false);
	async function checkNama() {
		namaBedaOrang = false;
		namaMirip = await findManpowerByNama(nama);
	}

	async function checkNik() {
		nikExisting = null;
		if (!/^\d{16}$/.test(nik)) return;
		nikChecking = true;
		try {
			nikExisting = await findManpowerByNik(nik);
		} finally {
			nikChecking = false;
		}
	}

	// ── Langkah 2: foto KTP ─────────────────────────────────────────────────
	let ktpFile = $state<File | null>(null);
	let ktpPreview = $state<string>('');
	function onKtpPick(e: Event) {
		const f = (e.target as HTMLInputElement).files?.[0] || null;
		ktpFile = f;
		ktpPreview = f ? URL.createObjectURL(f) : '';
	}

	// ── Langkah 3: rate ────────────────────────────────────────────────────
	let rateTipe = $state<'harian' | 'borongan'>('harian');
	let rateHarian = $state('');
	let nilaiBorongan = $state('');

	// ── Langkah 4: tanda tangan ────────────────────────────────────────────
	let sigPad = $state<any>(null);

	onMount(async () => {
		try {
			projects = (await getProjectsForCurrentUser(true)) || [];
			if (projects.length === 1) projectId = String(projects[0].id);
		} catch {
			projects = [];
		}
	});

	function step1Valid() {
		return (
			nama.trim().length >= 2 &&
			/^\d{16}$/.test(nik) &&
			!nikExisting &&
			(namaMirip.length === 0 || namaBedaOrang) &&
			noHp.trim().length >= 8 &&
			keahlian.trim().length >= 2 &&
			projectId
		);
	}
	function step3Valid() {
		return rateTipe === 'harian' ? Number(rateHarian) > 0 : Number(nilaiBorongan) > 0;
	}

	function next() {
		if (step === 1 && !step1Valid()) return toast.error('Lengkapi data identitas dulu (NIK 16 digit, tidak duplikat).');
		if (step === 2 && !ktpFile) return toast.error('Foto KTP wajib.');
		if (step === 3 && !step3Valid()) return toast.error('Isi rate yang valid.');
		step = Math.min(4, step + 1);
	}
	function back() {
		step = Math.max(1, step - 1);
	}

	async function submit() {
		if (!step1Valid() || !ktpFile || !step3Valid()) return toast.error('Data belum lengkap.');
		const sig = sigPad?.toDataURL?.();
		if (!sig) return toast.error('Tanda tangan pekerja wajib.');

		submitting = true;
		try {
			// 1. manpower
			const mp = await createManpower({
				nama: nama.trim(),
				NIK: nik.trim(), // GPA-06: string — Number() merusak presisi 16 digit (notasi ilmiah)
				no_telpon: Number(String(noHp).replace(/\D/g, '')) || null,
				posisi: keahlian.trim(),
				nama_kontak_darurat: namaKontakDarurat.trim() || null,
				golongan_darah: golonganDarah || null,
				riwayat_alergi: riwayatAlergi.trim() || null,
				kontak_darurat_telp: noHpDarurat.trim() ? String(noHpDarurat).replace(/^(\+?62|0)/, '').replace(/\D/g, '') : null,
				// Hanya dikirim bila diisi: kolom no_bpjs_tk baru ada setelah skema BPJSTK Proyek dirilis (hindari 403 saat belum ada).
				...(noBpjsTk.trim() ? { no_bpjs_tk: noBpjsTk.trim() } : {})
			});
			if (!mp?.id) throw new Error('Gagal membuat data pekerja.');

			// 2. dokumen — KTP + TTD pendaftaran
			const ktpCompressed = await compressPhoto(ktpFile);
			const ktpFileId = await uploadEvidencePhoto(ktpCompressed, 'manpower_dokumen:ktp');
			if (!ktpFileId) throw new Error('Gagal mengunggah foto KTP.');
			// GPA-05: manpower_dokumen WAJIB sukses dulu (melempar bila gagal); baru tandai kolom lama.
			try {
				await createManpowerDokumen({ manpowerId: mp.id, jenisDokumen: 'ktp', fileId: ktpFileId, projectId });
			} catch (e) {
				throw new Error(
					'Foto KTP belum tersimpan ke berkas HRD. Coba unggah ulang di Manpower › Dokumen. (' + ((e as Error)?.message || 'gagal') + ')'
				);
			}
			await updateManpower(mp.id, { ktp: true, foto_ktp: ktpFileId });

			try {
				const sigBlob = await (await fetch(sig)).blob();
				const sigFile = new File([sigBlob], `ttd-daftar-${mp.id}.png`, { type: 'image/png' });
				const sigCompressed = await compressPhoto(sigFile);
				const sigFileId = await uploadEvidencePhoto(sigCompressed, 'manpower_dokumen:ttd_pendaftaran');
				if (sigFileId) {
					await createManpowerDokumen({ manpowerId: mp.id, jenisDokumen: 'lainnya', fileId: sigFileId, projectId });
				}
			} catch (e) {
				console.warn('[daftar-baru] gagal simpan TTD (pendaftaran tetap lanjut):', e);
			}

			// 3. assignment → status menunggu_validasi → SPK otomatis masuk Approval Center
			const res = await createAssignment({
				manpower_id: mp.id,
				project_id: Number(projectId),
				jabatan: keahlian.trim(),
				rate_tipe: rateTipe,
				rate_harian: rateTipe === 'harian' ? Number(rateHarian) : null,
				nilai_borongan: rateTipe === 'borongan' ? Number(nilaiBorongan) : null,
				tanggal_mulai: tanggalMulai || null,
				tanggal_selesai: tanggalSelesai || null,
				status: 'menunggu_validasi',
				catatan: 'Pendaftaran dari lapangan (Self-Service PL).'
			});
			if (!res?.success) throw new Error(res?.error || 'Gagal membuat penugasan/SPK.');

			toast.success('Pekerja terdaftar. SPK menunggu validasi admin — pekerja boleh diabsen sementara.');
			goto('/manpower');
		} catch (e: any) {
			toast.error(e?.message || 'Gagal mendaftarkan pekerja.');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-lg mx-auto p-4 space-y-4">
	<div class="flex items-center gap-2">
		<button onclick={() => goto('/manpower')} class="text-sm text-gray-500 hover:text-gray-800">← Kembali</button>
		<h1 class="text-lg font-bold">Daftar Pekerja Baru</h1>
	</div>

	<div class="flex gap-1">
		{#each [1, 2, 3, 4] as s}
			<div class="flex-1 h-1.5 rounded-full {step >= s ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-slate-700'}"></div>
		{/each}
	</div>

	{#if step === 1}
		<section class="space-y-3">
			<h2 class="font-semibold text-sm">1. Identitas & penugasan</h2>
			<label class="block text-xs font-medium">Nama lengkap
				<input bind:value={nama} onblur={checkNama} class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="Sesuai KTP" />
				{#if namaMirip.length}
					<span class="block mt-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
						<strong>Pekerja bernama "{namaMirip[0].nama}" sudah terdaftar:</strong>
						{#each namaMirip as m (m.id)}<span class="block">• #{m.id} — {m.posisi || 'posisi -'} ({m.status_pekerja || 'status -'})</span>{/each}
						Bila orangnya sama, jangan daftar ulang — pilih pekerja yang ada saat membuat SPK.
						<span class="mt-1 flex items-center gap-1.5 font-medium">
							<input type="checkbox" bind:checked={namaBedaOrang} /> Ini orang yang berbeda, lanjut daftar baru
						</span>
					</span>
				{/if}
			</label>
			<label class="block text-xs font-medium">NIK (16 digit)
				<input bind:value={nik} inputmode="numeric" maxlength="16" onblur={checkNik}
					class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="3201xxxxxxxxxxxx" />
				<span class="block text-[11px] text-gray-500 mt-0.5">16 digit sesuai KTP, tanpa spasi/titik. Dipakai untuk BPJS &amp; payroll — salah satu digit saja bisa menahan pembayaran gaji.</span>
				{#if nikError}<span class="block text-[11px] text-rose-600">{nikError}</span>{/if}
				{#if nikChecking}<span class="block text-[11px] text-gray-400">Memeriksa duplikat…</span>{/if}
				{#if nikExisting}<span class="block text-[11px] text-rose-600 font-semibold">NIK ini sudah terdaftar atas nama "{nikExisting.nama}" (#{nikExisting.id}). Tidak perlu daftar ulang.</span>{/if}
			</label>
			<label class="block text-xs font-medium">No. HP
				<input bind:value={noHp} inputmode="numeric" class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="08xxxxxxxxxx" />
			</label>
			<label class="block text-xs font-medium">No. Kartu BPJS TK (opsional)
				<input bind:value={noBpjsTk} inputmode="numeric" class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="Kosongkan bila belum punya" />
				<span class="block text-[11px] text-gray-500 mt-0.5">Kosongkan jika pekerja belum memiliki kartu BPJS TK mandiri. Pekerja otomatis terlindungi BPJS Jakon jika proyek mewajibkan.</span>
			</label>
			<div class="grid grid-cols-2 gap-2">
				<label class="block text-xs font-medium">Nama Kontak Darurat (opsional)
					<input bind:value={namaKontakDarurat} class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="Nama keluarga/kerabat" />
				</label>
				<label class="block text-xs font-medium">No. HP Darurat (opsional)
					<input bind:value={noHpDarurat} inputmode="numeric" class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="08xxxxxxxxxx" />
				</label>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<label class="block text-xs font-medium">Golongan Darah (opsional)
					<select bind:value={golonganDarah} class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm">
						<option value="">- Tidak tahu / lewati -</option>
						{#each ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as g}<option value={g}>{g}</option>{/each}
					</select>
					<span class="block text-[11px] text-gray-500 mt-0.5">Untuk keselamatan kerja (pertolongan darurat), bukan penilaian.</span>
				</label>
				<label class="block text-xs font-medium">Alergi (opsional)
					<input bind:value={riwayatAlergi} class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="Mis. alergi obat/debu epoxy" />
				</label>
			</div>
			<label class="block text-xs font-medium">Keahlian / jabatan
				<input bind:value={keahlian} class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="mis. Tukang Las, Helper, Painter" />
			</label>
			<label class="block text-xs font-medium">Proyek
				<select bind:value={projectId} class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm">
					<option value="">— pilih proyek —</option>
					{#each projects as p}<option value={String(p.id)}>{p.name || p.nama || `Proyek #${p.id}`}</option>{/each}
				</select>
			</label>
			<div class="grid grid-cols-2 gap-2">
				<label class="block text-xs font-medium">Mulai
					<input type="date" bind:value={tanggalMulai} class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" />
				</label>
				<label class="block text-xs font-medium">Selesai (opsional)
					<input type="date" bind:value={tanggalSelesai} class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" />
				</label>
			</div>
		</section>
	{:else if step === 2}
		<section class="space-y-3">
			<h2 class="font-semibold text-sm">2. Foto KTP</h2>
			<p class="text-[11px] text-gray-500">Ambil langsung dari kamera. Pastikan seluruh KTP terbaca &amp; tidak silau.</p>
			<input type="file" accept="image/*" capture="environment" onchange={onKtpPick} class="text-sm" />
			{#if ktpPreview}<img src={ktpPreview} alt="pratinjau KTP" class="rounded-lg border max-h-64 object-contain" />{/if}
		</section>
	{:else if step === 3}
		<section class="space-y-3">
			<h2 class="font-semibold text-sm">3. Rate / upah</h2>
			<p class="text-[11px] text-gray-500">Rate di luar koridor keahlian akan dinaikkan ke persetujuan Manajer dan memperlambat SPK.</p>
			<div class="flex gap-2 text-sm">
				<label class="flex items-center gap-1"><input type="radio" bind:group={rateTipe} value="harian" /> Harian</label>
				<label class="flex items-center gap-1"><input type="radio" bind:group={rateTipe} value="borongan" /> Borongan</label>
			</div>
			{#if rateTipe === 'harian'}
				<label class="block text-xs font-medium">Rate harian (Rp)
					<input bind:value={rateHarian} inputmode="numeric" class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="mis. 150000" />
				</label>
			{:else}
				<label class="block text-xs font-medium">Nilai borongan (Rp)
					<input bind:value={nilaiBorongan} inputmode="numeric" class="mt-1 w-full rounded-lg border-gray-300 dark:bg-slate-800 text-sm" placeholder="total nilai" />
				</label>
			{/if}
		</section>
	{:else}
		<section class="space-y-3">
			<h2 class="font-semibold text-sm">4. Tanda tangan pekerja</h2>
			<p class="text-[11px] text-gray-500">Pekerja membubuhkan tanda tangan sebagai persetujuan pendaftaran &amp; rate di atas.</p>
			<SignaturePad bind:this={sigPad} />
			<div class="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-2 text-[11px] text-amber-800 dark:text-amber-200">
				Setelah terdaftar, pekerja ini <strong>boleh diabsen dari layar regu</strong> sementara SPK diproses admin.
				Lewat batas hari kerja sementara, absensinya terkunci sampai SPK disetujui. SPK biasanya divalidasi dalam beberapa jam kerja.
			</div>
		</section>
	{/if}

	<div class="flex justify-between pt-2">
		<button onclick={back} disabled={step === 1 || submitting}
			class="px-4 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-sm disabled:opacity-40">Kembali</button>
		{#if step < 4}
			<button onclick={next} disabled={submitting}
				class="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">Lanjut</button>
		{:else}
			<button onclick={submit} disabled={submitting}
				class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-50">
				{submitting ? 'Menyimpan…' : 'Daftarkan pekerja'}
			</button>
		{/if}
	</div>
</div>
