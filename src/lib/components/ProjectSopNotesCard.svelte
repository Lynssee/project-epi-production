<script lang="ts">
	// Kartu "Instruksi & SOP Khusus Proyek Ini" di cockpit proyek (Fase 5 SOP Proyek).
	// Sumber: project_sop_notes (dikelola admin di /settings/project-sop), dibaca lewat /api/project-sop yang memakai proyek "aktif hari ini"
	// milik user — kartu HANYA tampil bila proyek aktif itu sama dengan proyek yang sedang dibuka (tak ada akses lintas proyek).
	import { fetchProjectSop, type ProjectSopNote } from '$lib/services/tutorialApi';

	let { projectId }: { projectId: number | string } = $props();

	let notes = $state<ProjectSopNote[]>([]);
	let loaded = $state(false);

	const KAT: Record<string, { label: string; cls: string }> = {
		keselamatan: { label: 'Keselamatan', cls: 'bg-red-100 text-red-700' },
		akses_lokasi: { label: 'Akses Lokasi', cls: 'bg-amber-100 text-amber-800' },
		kontak: { label: 'Kontak', cls: 'bg-sky-100 text-sky-800' },
		lainnya: { label: 'Lainnya', cls: 'bg-slate-100 text-slate-700' }
	};

	$effect(() => {
		const pid = Number(projectId);
		if (!Number.isFinite(pid)) return;
		let batal = false;
		fetchProjectSop().then((r) => {
			if (batal) return;
			notes = r.success && r.data && Number(r.data.projectId) === pid ? r.data.notes : [];
			loaded = true;
		});
		return () => { batal = true; };
	});
</script>

{#if loaded && notes.length > 0}
	<section class="rounded-2xl border border-amber-200 bg-amber-50/60 p-3.5 space-y-2" aria-label="Instruksi khusus proyek">
		<h3 class="text-xs font-bold text-amber-900" title="Instruksi yang ditetapkan admin khusus untuk proyek ini">📌 Instruksi & SOP Khusus Proyek Ini</h3>
		<ul class="space-y-2">
			{#each notes as n (n.id)}
				<li class="rounded-xl bg-white border border-amber-100 p-2.5">
					<div class="flex items-center gap-1.5">
						<span class="rounded px-1.5 py-0.5 text-[10px] font-semibold {(KAT[n.kategori] ?? KAT.lainnya).cls}">{(KAT[n.kategori] ?? KAT.lainnya).label}</span>
						<p class="text-xs font-semibold text-gray-900">{n.judul}</p>
					</div>
					{#if n.isi}<p class="mt-1 whitespace-pre-line text-[12px] leading-snug text-gray-700">{n.isi}</p>{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
