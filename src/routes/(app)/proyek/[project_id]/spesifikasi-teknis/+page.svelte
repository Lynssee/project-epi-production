<!-- src/routes/(app)/proyek/[project_id]/spesifikasi-teknis/+page.svelte -->
<!-- Kartu Spesifikasi Teknis per objek (Technical Work Instruction) — READ-ONLY, mobile-first.
     Sumber: ERP Admin → Project Charter → Objek Pekerjaan → kolom "Spek" (project_objects.spesifikasi_teknis).
     Gate G_PRJ_SCOPE_SPEC_COMPLETE menilai kelengkapannya di sisi admin. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getProjectById } from '$lib/services/projects';
	import { fetchProjectObjectSpecs, type ProjectObjectSpec } from '$lib/services/projectSpecApi';
	import { secureAssetSrc, openSecureAsset } from '$lib/actions/secureAsset';
	import { specPhotoStages } from '$lib/shared/projectSpecDft';
	import { fetchObjectStagePhotos, addStagePhoto, groupPhotos, type ObjectStagePhoto } from '$lib/services/projectObjectPhotoApi';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { authStore } from '$lib/stores/auth';
	import { IconArrowLeft, IconAlertTriangle } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let error = $state('');
	let project = $state<any>(null);
	let objects = $state<ProjectObjectSpec[]>([]);
	let openId = $state<number | null>(null);
	let photos = $state<ObjectStagePhoto[]>([]);
	let photoError = $state('');
	let uploadingKey = $state('');
	let photoMsg = $state('');
	const photosByObject = $derived(groupPhotos(photos));

	const KETAHANAN: Record<string, string> = {
		beban_berat_forklift: 'Beban berat / forklift',
		tahan_kimia_oli: 'Tahan kimia / oli',
		anti_slip: 'Anti slip',
		anti_bakteri: 'Higienis / anti bakteri',
		anti_statik: 'Anti statik (ESD)'
	};

	async function load() {
		loading = true;
		error = '';
		try {
			const [proj, list] = await Promise.all([getProjectById(projectId), fetchProjectObjectSpecs(projectId)]);
			project = proj;
			objects = list;
			if (list.length === 1) openId = list[0].id;
			loadPhotos(list.map((o) => o.id));
		} catch (e: any) {
			console.error('[spesifikasi-teknis] gagal memuat:', e);
			error = 'Spesifikasi teknis belum bisa dimuat. Tarik ulang halaman atau coba lagi nanti.';
		} finally {
			loading = false;
		}
	}
	/** Foto progres dimuat terpisah: gagal tidak menyembunyikan spesifikasi, tetapi pesannya ditampilkan. */
	async function loadPhotos(ids: number[]) {
		photoError = '';
		try {
			photos = await fetchObjectStagePhotos(ids);
		} catch (e) {
			console.error('[spesifikasi-teknis] gagal memuat foto progres:', e);
			photos = [];
			photoError = 'Foto progres belum bisa dimuat.';
		}
	}

	async function onPickPhoto(o: ProjectObjectSpec, stage: { key: string; label: string }, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		uploadingKey = o.id + ':' + stage.key;
		photoMsg = '';
		try {
			const small = await compressPhoto(file).catch(() => file); // kompresi gagal → kirim asli, jangan blokir
			const row = await addStagePhoto({ objectId: o.id, stageKey: stage.key, stageLabel: stage.label, file: small, author: $authStore.karyawanName || null });
			photos = [row, ...photos];
			photoMsg = 'Foto tersimpan: ' + stage.label;
		} catch (err: any) {
			photoMsg = err?.message || 'Foto gagal disimpan.';
		} finally {
			uploadingKey = '';
		}
	}

	onMount(load);

	const isLantai = (o: ProjectObjectSpec) => o.spec?.kategori_pekerjaan === 'floor_coating' || (!o.spec && o.tipe === 'lantai');
	const terisi = $derived(objects.filter((o) => o.spec && (o.pengecualian || o.layers.length > 0)).length);
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
			<CircularProgressGauge size={52} strokeWidth={4} label="Memuat spesifikasi teknis..." />
		</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">Spesifikasi Teknis</h1>
		<p class="text-sm text-gray-500">{project?.name || '-'}</p>
		<p class="mb-4 mt-1 text-[11px] text-gray-400">
			Acuan kerja per objek: persiapan permukaan, cat & ketebalan tiap lapis, serta tingkat kilap. Diisi oleh admin proyek di ERP — jika ada yang salah/kosong, hubungi admin proyek.
		</p>

		{#if error}
			<div class="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
				<IconAlertTriangle size={16} class="mt-0.5 shrink-0" />
				<div>
					<p>{error}</p>
					<button class="mt-1 font-semibold underline" onclick={load}>Coba lagi</button>
				</div>
			</div>
		{:else if objects.length === 0}
			<p class="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-500">Belum ada objek pekerjaan pada proyek ini. Admin proyek mengisinya di Project Charter.</p>
		{:else}
			<p class="mb-3 text-xs text-gray-500">{terisi} dari {objects.length} objek sudah punya spesifikasi.</p>

			<div class="space-y-3">
				{#each objects as o (o.id)}
					{@const lantai = isLantai(o)}
					<div class="rounded-xl border border-gray-200 bg-white" data-testid="kartu-spesifikasi">
						<button class="flex w-full items-center gap-3 p-3 text-left" aria-expanded={openId === o.id} onclick={() => (openId = openId === o.id ? null : o.id)}>
							{#if o.foto_identitas}
								<img use:secureAssetSrc={`/assets/${o.foto_identitas}?width=96&height=96&fit=cover`} alt="Foto {o.nama}" class="h-12 w-12 shrink-0 rounded-lg object-cover" />
							{:else}
								<span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xl">{lantai ? '🏗️' : '🔩'}</span>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-bold text-gray-900">{o.nama}</p>
								<p class="text-[11px] text-gray-500">
									{#if lantai}{o.luas ? `${o.luas} m²` : '-'}{:else}{o.qty ?? '-'} {o.satuan || ''}{o.dimensi ? ` · ${o.dimensi}` : ''}{/if}
								</p>
							</div>
							{#if o.pengecualian}
								<span class="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600">Tanpa pelapisan</span>
							{:else if o.layers.length > 0}
								<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{o.totalMicron} µm</span>
							{:else}
								<span class="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Belum diisi</span>
							{/if}
						</button>

						{#if openId === o.id}
							<div class="space-y-3 border-t border-gray-100 p-3 text-xs">
								{#if o.pengecualian}
									<p class="rounded-lg bg-gray-50 p-2 text-gray-600">Objek ini dikecualikan dari pelapisan: <em>{o.pengecualian}</em></p>
								{:else if !o.spec || o.layers.length === 0}
									<p class="rounded-lg bg-amber-50 p-2 text-amber-800">Spesifikasi teknis objek ini belum lengkap. Minta admin proyek melengkapi di Project Charter sebelum mulai pekerjaan.</p>
								{:else}
									<section>
										<h3 class="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">1 · Persiapan permukaan</h3>
										{#if lantai}
											<p class="text-sm font-semibold text-gray-900">{o.spec.kondisi_substrat_beton?.metode_persiapan || '-'}</p>
											<ul class="mt-1 space-y-0.5 text-gray-600">
												{#if o.spec.kondisi_substrat_beton?.kelembaban_max_persen != null && o.spec.kondisi_substrat_beton?.kelembaban_max_persen !== ''}<li>Kelembaban beton maks. <b>{o.spec.kondisi_substrat_beton.kelembaban_max_persen}%</b></li>{/if}
												{#if o.spec.kondisi_substrat_beton?.umur_beton_hari}<li>Umur beton {o.spec.kondisi_substrat_beton.umur_beton_hari} hari</li>{/if}
												{#if o.spec.kondisi_substrat_beton?.kondisi_permukaan}<li>Kondisi: {o.spec.kondisi_substrat_beton.kondisi_permukaan}</li>{/if}
												{#if o.spec.kebutuhan_klien?.fungsi_ruangan}<li>Fungsi ruangan: {o.spec.kebutuhan_klien.fungsi_ruangan}</li>{/if}
												{#if (o.spec.kebutuhan_klien?.ketahanan || []).length}<li>Tahan: {(o.spec.kebutuhan_klien.ketahanan as string[]).map((k) => KETAHANAN[k] || k).join(', ')}</li>{/if}
											</ul>
										{:else}
											<p class="text-lg font-black text-gray-900">{o.spec.surface_preparation?.standar_sa || '-'}</p>
											<ul class="mt-1 space-y-0.5 text-gray-600">
												{#if o.spec.surface_preparation?.jenis_abrasive}<li>Abrasive: {o.spec.surface_preparation.jenis_abrasive}</li>{/if}
												{#if o.spec.surface_preparation?.surface_profile_micron}<li>Profil permukaan: {o.spec.surface_preparation.surface_profile_micron} µm</li>{/if}
											</ul>
										{/if}
									</section>

									<section>
										<h3 class="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">2 · Sistem lapisan (DFT)</h3>
										<div class="space-y-1.5">
											{#each o.layers as l (l.no)}
												<div class="rounded-lg border border-gray-100 bg-gray-50 p-2">
													<div class="flex items-baseline justify-between gap-2">
														<span class="font-semibold text-gray-900">L{l.no} · {l.tahap || 'Lapisan'}</span>
														<span class="font-mono text-sm font-black text-gray-900">{l.target} µm</span>
													</div>
													<div class="flex items-baseline justify-between gap-2 text-[11px] text-gray-500">
														<span class="truncate">{l.merk || 'Merk belum ditentukan'}</span>
														<span class="shrink-0 font-mono">batas {l.min}–{l.max}</span>
													</div>
												</div>
											{/each}
										</div>
										<p class="mt-1.5 text-right text-[11px] font-bold text-gray-700">Total target: {o.totalMicron} µm</p>
									</section>

									<section>
										<h3 class="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">3 · Finishing</h3>
										<p class="text-gray-900"><b>{o.spec.finishing?.tingkat_kilap || '-'}</b>{o.spec.finishing?.warna_ral ? ` · ${o.spec.finishing.warna_ral}` : ''}</p>
										{#if o.spec.finishing?.lingkungan_eksposur}<p class="text-gray-500">Lingkungan: {o.spec.finishing.lingkungan_eksposur}</p>{/if}
									</section>

									<button class="w-full rounded-lg bg-blue-600 py-2 text-xs font-bold text-white" onclick={() => goto('/inspection')}>
										Buat / lanjutkan laporan inspeksi (DFT dibandingkan otomatis)
									</button>
								{/if}

								<section data-testid="foto-tahap">
									<h3 class="mb-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">Foto progres per tahap</h3>
									<p class="mb-1.5 text-[11px] text-gray-400">Ketuk 📷 pada tahap yang baru dikerjakan. Foto menempel ke objek ini dan terlihat oleh admin proyek.</p>
									{#each specPhotoStages(o.spec, o.tipe) as st (st.key)}
										{@const list = photosByObject[o.id]?.[st.key] || []}
										<div class="mb-1.5 rounded-lg border border-gray-100 p-2">
											<div class="flex items-center justify-between gap-2">
												<span class="text-xs font-semibold text-gray-800">{st.label} <span class="font-normal text-gray-400">({list.length})</span></span>
												<label class="cursor-pointer rounded-lg bg-blue-50 px-2.5 py-1 text-[11px] font-bold text-blue-700">
													{uploadingKey === o.id + ':' + st.key ? 'Mengunggah…' : '📷 Foto'}
													<input type="file" accept="image/*" capture="environment" class="hidden" disabled={!!uploadingKey} onchange={(e) => onPickPhoto(o, st, e)} />
												</label>
											</div>
											{#if list.length}
												<div class="mt-1.5 flex gap-1.5 overflow-x-auto">
													{#each list.slice(0, 6) as ph (ph.id)}
														<button type="button" class="shrink-0" title="{ph.tanggal || ''} {ph.dibuat_oleh ? '· ' + ph.dibuat_oleh : ''}" onclick={() => openSecureAsset('/assets/' + ph.foto)}>
															<img use:secureAssetSrc={`/assets/${ph.foto}?width=120&height=120&fit=cover`} alt="Foto {st.label}" class="h-14 w-14 rounded-md object-cover" />
														</button>
													{/each}
												</div>
											{/if}
										</div>
									{/each}
									{#if photoMsg}<p class="text-[11px] text-gray-600" role="status">{photoMsg}</p>{/if}
									{#if photoError}<p class="text-[11px] text-amber-700">{photoError} <button class="underline" onclick={() => loadPhotos(objects.map((x) => x.id))}>Coba lagi</button></p>{/if}
								</section>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
