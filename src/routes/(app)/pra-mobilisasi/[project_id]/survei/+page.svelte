<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Survei Lapangan oleh Leader (Fase 3 plan "Penguraian PO Jasa", 10 Okt 2026).
	// Leader/Manpower Leader proyek mengisi data & foto survei dari HP sebelum Charter dibuat.
	// Disimpan ke `sales_survey` (terkait PO proyek) -> otomatis terbaca di tab Charter.
	// Isian Sales TIDAK ditimpa: untuk survei yang sudah ada hanya kolom kosong yang terisi.
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import { getProjectMobilizationContext, canFillChecklist, type MobilizationProjectContext } from '$lib/services/mobilizationChecklist';
	import { loadLeaderSurvey, saveLeaderSurvey, type LeaderSurveyState } from '$lib/services/leaderSurvey';
	import { LEADER_SURVEY_FIELDS, type LeaderSurveyForm } from '$lib/services/leaderSurveyLogic';
	import { KETERSEDIAAN_OPTIONS, JAM_KERJA_OPTIONS, SHIFT_KERJA_OPTIONS, KONDISI_PERMUKAAN_OPTIONS } from '$lib/services/sales';
	import { IconArrowLeft, IconLoader2, IconPhoto, IconX } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let resultMsg = $state('');
	let allowed = $state(true);
	let project = $state<MobilizationProjectContext | null>(null);
	let state_ = $state<LeaderSurveyState>({ soCustomerId: null, survey: null, images: [] });
	let form = $state<LeaderSurveyForm>({});
	let photos = $state<File[]>([]);
	let previews = $derived(photos.map((f) => URL.createObjectURL(f)));

	// Kolom yang sudah terisi (oleh Sales / simpan sebelumnya) dikunci agar tidak tertimpa.
	let locked = $derived(
		new Set(LEADER_SURVEY_FIELDS.filter((k) => state_.survey && state_.survey[k] != null && String(state_.survey[k]).trim() !== ''))
	);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const auth = get(authStore);
			const ctx = await getProjectMobilizationContext(projectId);
			project = ctx;
			allowed = canFillChecklist(ctx, auth.karyawanId);
			if (!allowed) return;
			state_ = await loadLeaderSurvey(projectId);
			const f: LeaderSurveyForm = {};
			for (const k of LEADER_SURVEY_FIELDS) f[k] = state_.survey?.[k] ?? '';
			if (!state_.survey && !f.lokasi_project) f.lokasi_project = '';
			form = f;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat survei.';
		} finally {
			loading = false;
		}
	}

	function addPhotos(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		photos = [...photos, ...Array.from(input.files || [])].slice(0, 10);
		input.value = '';
	}

	async function submit() {
		if (!state_.soCustomerId || saving) return;
		saving = true;
		errorMsg = '';
		resultMsg = '';
		try {
			const auth = get(authStore);
			const r = await saveLeaderSurvey({
				soCustomerId: state_.soCustomerId,
				existing: state_.survey,
				leaderName: auth.karyawanName || auth.user?.displayName || auth.user?.email || 'Leader',
				customerName: project?.name ?? null,
				form,
				photos
			});
			const parts = [
				r.created ? 'Survei baru tersimpan.' : `${r.filled.length} kolom kosong terisi.`,
				r.photosOk ? `${r.photosOk} foto terunggah.` : '',
				r.skipped.length ? `${r.skipped.length} kolom dilewati karena sudah diisi Sales.` : '',
				r.photosFailed.length ? `Foto gagal: ${r.photosFailed.join(', ')} — coba unggah ulang.` : ''
			].filter(Boolean);
			resultMsg = parts.join(' ');
			photos = [];
			await load();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal menyimpan survei.';
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		if (projectId) load();
	});
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="px-4 pt-4 max-w-4xl mx-auto w-full">
		<button type="button" onclick={() => goto(`/pra-mobilisasi/${projectId}`)} class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 mb-2">
			<IconArrowLeft size={16} /> <span>Kembali ke Pra-Mobilisasi</span>
		</button>
		<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Survei Lapangan — {project?.name || `Proyek #${projectId}`}</h2>
		<p class="text-[12px]" style="color: var(--sys-label3)">
			💡 Isi data yang Anda lihat di lokasi dan unggah foto. Data ini otomatis muncul sebagai acuan di tab Charter. Kolom bergembok sudah diisi Sales dan tidak bisa ditimpa.
		</p>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16" style="background: var(--sys-bg)">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat survei pra-mobilisasi..." />
		</div>
	{:else if !allowed}
		<div class="scroll-body px-4 py-4"><div class="card-section text-center py-8"><p class="text-[13px]" style="color: var(--sys-label3)">Hanya Project Leader atau Manpower Leader proyek ini yang bisa mengisi survei lapangan.</p></div></div>
	{:else if !state_.soCustomerId}
		<div class="scroll-body px-4 py-4"><div class="card-section text-center py-8"><p class="text-[13px]" style="color: var(--sys-label3)">Proyek ini belum terhubung ke PO (SO), sehingga survei belum bisa disimpan. Hubungi admin proyek.</p></div></div>
	{:else}
		<div class="scroll-body px-4 py-4 flex flex-col gap-3 max-w-4xl mx-auto w-full">
			{#if state_.survey}
				<div class="card-section text-[12px]" style="color: var(--sys-label3)">
					Survei {state_.survey.nomor_survey || `#${state_.survey.id}`} • surveyor: {state_.survey.surveyor || '-'} • {state_.survey.status === 'completed' ? 'Selesai' : 'Draft'}
				</div>
			{/if}

			<div class="card-section flex flex-col gap-3">
				<label class="text-[12px] font-semibold">Lokasi proyek {#if !state_.survey}<span class="text-red-500">*</span>{/if}
					<textarea class="w-full border rounded-lg p-2 mt-1 text-[13px]" rows="2" bind:value={form.lokasi_project} disabled={locked.has('lokasi_project')}></textarea>
				</label>
				<div class="grid grid-cols-2 gap-2">
					<label class="text-[12px] font-semibold">PIC lapangan<input class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.pic_lapangan} disabled={locked.has('pic_lapangan')} /></label>
					<label class="text-[12px] font-semibold">Telp PIC<input class="w-full border rounded-lg p-2 mt-1 text-[13px]" inputmode="tel" bind:value={form.pic_lapangan_telp} disabled={locked.has('pic_lapangan_telp')} /></label>
					<label class="text-[12px] font-semibold">Target mulai<input type="date" class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.tanggal_mulai_target} disabled={locked.has('tanggal_mulai_target')} /></label>
					<label class="text-[12px] font-semibold">Target selesai<input type="date" class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.tanggal_selesai_target} disabled={locked.has('tanggal_selesai_target')} /></label>
					<label class="text-[12px] font-semibold">Luas area (m²)<input class="w-full border rounded-lg p-2 mt-1 text-[13px]" inputmode="decimal" bind:value={form.luas_area} disabled={locked.has('luas_area')} /></label>
					<label class="text-[12px] font-semibold">Kondisi permukaan
						<select class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.kondisi_permukaan} disabled={locked.has('kondisi_permukaan')}>
							<option value="">-- pilih --</option>
							{#each KONDISI_PERMUKAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</label>
					<label class="text-[12px] font-semibold">Listrik
						<select class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.ketersediaan_listrik} disabled={locked.has('ketersediaan_listrik')}>
							<option value="">-- pilih --</option>{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</label>
					<label class="text-[12px] font-semibold">Air
						<select class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.ketersediaan_air} disabled={locked.has('ketersediaan_air')}>
							<option value="">-- pilih --</option>{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</label>
					<label class="text-[12px] font-semibold">Toilet
						<select class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.ketersediaan_toilet} disabled={locked.has('ketersediaan_toilet')}>
							<option value="">-- pilih --</option>{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</label>
					<label class="text-[12px] font-semibold">Akomodasi
						<select class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.akomodasi} disabled={locked.has('akomodasi')}>
							<option value="">-- pilih --</option>{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</label>
					<label class="text-[12px] font-semibold">Hari kerja diizinkan
						<select class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.jam_kerja_diizinkan} disabled={locked.has('jam_kerja_diizinkan')}>
							<option value="">-- pilih --</option>{#each JAM_KERJA_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</label>
					<label class="text-[12px] font-semibold">Shift
						<select class="w-full border rounded-lg p-2 mt-1 text-[13px]" bind:value={form.shift_kerja} disabled={locked.has('shift_kerja')}>
							<option value="">-- pilih --</option>{#each SHIFT_KERJA_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</label>
				</div>
				<label class="text-[12px] font-semibold">Akses lokasi<textarea class="w-full border rounded-lg p-2 mt-1 text-[13px]" rows="2" bind:value={form.akses_lokasi} disabled={locked.has('akses_lokasi')}></textarea></label>
				<label class="text-[12px] font-semibold">Kebutuhan safety<textarea class="w-full border rounded-lg p-2 mt-1 text-[13px]" rows="2" bind:value={form.kebutuhan_safety} disabled={locked.has('kebutuhan_safety')}></textarea></label>
				<label class="text-[12px] font-semibold">Catatan khusus<textarea class="w-full border rounded-lg p-2 mt-1 text-[13px]" rows="2" bind:value={form.catatan_khusus} disabled={locked.has('catatan_khusus')}></textarea></label>
			</div>

			<div class="card-section">
				<p class="text-[13px] font-semibold mb-2 flex items-center gap-1.5"><IconPhoto size={16} /> Foto survei ({state_.images.length} tersimpan{photos.length ? `, ${photos.length} akan diunggah` : ''})</p>
				<p class="text-[11px] mb-2" style="color: var(--sys-label3)">💡 Maks. 10 foto per simpan: kondisi permukaan, akses masuk, titik listrik/air, area kerja.</p>
				<div class="flex flex-wrap gap-2 mb-2">
					{#each state_.images as img (img.id)}
						<img src={`/api/directus/assets/${img.file_id}?width=160&height=160&fit=cover`} alt="Foto survei" class="w-20 h-20 object-cover rounded-lg border" />
					{/each}
					{#each previews as src, i (src)}
						<div class="relative">
							<img {src} alt="Foto baru" class="w-20 h-20 object-cover rounded-lg border-2 border-emerald-400" />
							<button type="button" class="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full p-0.5" aria-label="Hapus foto" onclick={() => (photos = photos.filter((_, j) => j !== i))}><IconX size={12} /></button>
						</div>
					{/each}
				</div>
				<input type="file" accept="image/*" capture="environment" multiple onchange={addPhotos} class="text-[12px]" />
			</div>

			{#if errorMsg}<div class="card-section text-[12px] text-red-600">{errorMsg}</div>{/if}
			{#if resultMsg}<div class="card-section text-[12px] text-emerald-700">{resultMsg}</div>{/if}

			<button type="button" onclick={submit} disabled={saving} class="h-11 rounded-xl text-[13px] font-bold text-white disabled:opacity-50" style="background: var(--p, var(--g))">
				{saving ? 'Menyimpan…' : state_.survey ? 'Simpan Tambahan Survei' : 'Simpan Survei'}
			</button>
		</div>
	{/if}
</div>
