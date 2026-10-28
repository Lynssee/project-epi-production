<!-- Foto Awal Proyek (kamera-first) — melengkapi syarat gate Pengajuan Anggaran (G_SIAP_PA) & Packing List (G_PKL_READINESS).
     Foto diberi cap tanggal/jam + koordinat GPS (bila tersedia; TIDAK dikarang) lalu disimpan sebagai thumbnail proyek
     (projects.timeline_planning.metadata.thumbnail_file_id — field yang sama dengan Command Center admin).
     Tampil hanya bila foto belum ada. Gagal simpan ditampilkan jelas (bukan ditelan). -->
<script lang="ts">
	import { uploadFiles, updateItem, readItem } from '@directus/sdk';
	import directus from '$lib/services/directus';
	import { getProjectById } from '$lib/services/projects';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { DATA_DASAR_EVALUATORS } from '$lib/utils/dataDasarProyek';
	import { IconCamera, IconLoader2 } from '@tabler/icons-svelte';

	let { project = $bindable(), onsaved }: { project: any; onsaved?: (fileId: string) => void } = $props();

	let busy = $state(false);
	let errorMsg = $state('');
	let input: HTMLInputElement | undefined = $state();

	const hasPhoto = $derived(DATA_DASAR_EVALUATORS.foto_proyek_set(project));

	function getGps(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
		return new Promise((resolve) => {
			if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
			navigator.geolocation.getCurrentPosition(
				(p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
				() => resolve(null),
				{ enableHighAccuracy: true, timeout: 6000, maximumAge: 30000 }
			);
		});
	}

	async function onPick(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file || !project?.id) return;
		errorMsg = '';
		if (!file.type.startsWith('image/')) {
			errorMsg = 'File harus berupa gambar (JPG/PNG/WebP).';
			return;
		}
		busy = true;
		try {
			const gps = await getGps();
			const stamped = await watermarkPhoto(file, gps, new Date().toISOString());
			const compressed = await compressPhoto(stamped);

			const fd = new FormData();
			fd.append('file', compressed);
			fd.append('title', `Foto awal proyek ${project.name || project.id}`);
			const up = (await directus.request(uploadFiles(fd))) as any;
			if (!up?.id) throw new Error('Upload foto gagal: server tidak mengembalikan id file.');

			// Baca timeline_planning TERKINI dulu supaya metadata lain tidak tertimpa (read-modify-write).
			const fresh = (await directus.request(readItem('projects', project.id, { fields: ['id', 'timeline_planning'] }))) as any;
			const tp = typeof fresh?.timeline_planning === 'object' && fresh.timeline_planning ? fresh.timeline_planning : {};
			const next = { ...tp, metadata: { ...(tp.metadata || {}), thumbnail_file_id: up.id } };
			await directus.request(updateItem('projects', project.id, { timeline_planning: next }));

			project = { ...project, timeline_planning: next };
			getProjectById(project.id, null, true).catch(() => {}); // segarkan cache detail
			onsaved?.(up.id);
		} catch (err: any) {
			console.error('[FotoAwalProyekCard] simpan foto gagal:', err);
			errorMsg = err?.message
				? `Gagal menyimpan foto: ${err.message}. Bila terus gagal, minta Admin Project mengunggah dari Command Center.`
				: 'Gagal menyimpan foto. Coba lagi atau minta Admin Project mengunggah dari Command Center.';
		} finally {
			busy = false;
			if (input) input.value = '';
		}
	}
</script>

{#if project && !hasPhoto}
	<div class="mx-4 mt-3 rounded-2xl p-3.5" style="background: #fff7ed; border: 1px solid #fed7aa">
		<div class="flex items-start gap-3">
			<div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background: #ffedd5">
				<IconCamera size={20} style="color: #c2410c" />
			</div>
			<div class="flex-1 min-w-0">
				<p class="text-[13px] font-bold" style="color: #9a3412">Foto awal proyek belum ada</p>
				<p class="text-[11px] mt-0.5" style="color: #c2410c">
					Foto kondisi awal lokasi/objek diperlukan sebelum Pengajuan Anggaran & Packing List bisa diproses. Ambil
					langsung dengan kamera — otomatis diberi tanggal, jam, dan koordinat GPS.
				</p>
				{#if errorMsg}
					<p class="text-[11px] mt-1.5 font-semibold" style="color: #b91c1c" role="alert">{errorMsg}</p>
				{/if}
				<button
					type="button"
					class="mt-2.5 px-3 py-1.5 rounded-xl text-[12px] font-bold flex items-center gap-1.5 disabled:opacity-60"
					style="background: #ea580c; color: white"
					disabled={busy}
					onclick={() => input?.click()}
				>
					{#if busy}
						<IconLoader2 size={14} class="animate-spin" /> Menyimpan…
					{:else}
						<IconCamera size={14} /> Ambil Foto Awal
					{/if}
				</button>
				<input bind:this={input} type="file" accept="image/*" capture="environment" class="hidden" onchange={onPick} />
			</div>
		</div>
	</div>
{/if}
