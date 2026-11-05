<!-- src/lib/components/ess/SopSayaCard.svelte
     Auto-Bridge Peta Alur → Training & KPI (Fase 4). Dua tampilan dari SATU data (/api/ess/sop-saya):
       variant="training"  : "Training dari SOP Saya" (ESS Pelatihan) — training yang dibutuhkan SOP jabatan + status + alur asalnya.
       variant="kesiapan"  : "Kesiapan SOP Saya" (ESS Kinerja) — persentase kesiapan, per alur, dan saran training berikutnya.
     Training yang BELUM TERDAFTAR atau masih masa tenggang tidak dihitung ke KPI (hanya Lulus & terlambat selesai).
     Fail-soft: data tak tersedia / jabatan belum terhubung / tidak ada kebutuhan training → kartu tidak tampil. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getSopSaya, sopStateInfo, type SopSaya } from '$lib/services/ess/sopSaya';
	// Impor per-ikon (bukan barrel) — barrel @tabler/icons-svelte membuat transform tes DOM sangat lambat/crash.
	import IconCircleCheck from '@tabler/icons-svelte/icons/circle-check';
	import IconCircleDashed from '@tabler/icons-svelte/icons/circle-dashed';
	import IconClock from '@tabler/icons-svelte/icons/clock';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconChevronRight from '@tabler/icons-svelte/icons/chevron-right';
	import IconListCheck from '@tabler/icons-svelte/icons/list-check';

	let { variant = 'training' }: { variant?: 'training' | 'kesiapan' } = $props();

	let data = $state<SopSaya | null>(null);
	let showAll = $state(false);

	onMount(async () => {
		data = await getSopSaya();
	});

	let programs = $derived(data?.programs ?? []);
	let prasyarat = $derived(data?.prasyarat ?? []);
	let prasyaratSiap = $derived(prasyarat.filter((p) => p.state === 'lulus').length);
	// Bagian SOP jabatan butuh jabatan terhubung; checklist prasyarat proyek berlaku untuk semua karyawan.
	let adaSop = $derived(Boolean(data?.available && data.terhubung && programs.length > 0));
	let tampil = $derived(variant === 'training' ? adaSop || (Boolean(data?.available) && prasyarat.length > 0) : adaSop);
	// R10 — skill gap berbasis alur: alur "dikuasai" bila tak ada langkah yang belum siap maupun menunggu training.
	let alurDikuasai = $derived((data?.flows ?? []).filter((f) => f.langkah > 0 && f.belum_siap === 0 && f.ditunda === 0).length);
	let alurTotal = $derived((data?.flows ?? []).filter((f) => f.langkah > 0).length);
	let alurPerluTingkat = $derived((data?.flows ?? []).filter((f) => f.langkah > 0 && (f.belum_siap > 0 || f.ditunda > 0)).slice(0, 3));
	let grace = $derived(data?.grace_hari ?? 30);
	// Daftar ringkas: yang masih perlu tindakan dulu (server sudah mengurutkan); selebihnya lewat "lihat semua".
	let perluTindakan = $derived(programs.filter((p) => p.state !== 'lulus'));
	let daftar = $derived(showAll ? programs : perluTindakan.length > 0 ? perluTindakan.slice(0, 5) : programs.slice(0, 3));
	let tersembunyi = $derived(programs.length - daftar.length);

	let nilai = $derived(data?.readiness?.value ?? null);
	let warna = $derived(nilai == null ? 'var(--sys-label3)' : nilai >= 80 ? '#059669' : nilai >= 50 ? '#D97706' : '#DC2626');
	let flowsBerlaku = $derived((data?.flows ?? []).filter((f) => f.langkah > 0));
	let sarankan = $derived(
		[...new Map((data?.flows ?? []).flatMap((f) => f.perlu_training).map((t) => [t.program_id, t])).values()].slice(0, 3)
	);

	function buka(programId: number) {
		goto(`/ess/pelatihan/${programId}`);
	}
</script>

{#if tampil && data}
	{#if variant === 'training'}
		{#if prasyarat.length > 0}
			<!-- R6: Checklist Siap Proyek — prasyarat diatur admin (Pengaturan Peta Alur → Sinkron Silabus). -->
			<div class="mb-8" data-testid="sop-prasyarat-proyek">
				<h2 class="text-sm font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style="color: var(--sys-label3)">
					<IconListCheck size={16} /> Checklist Siap Proyek
				</h2>
				<p class="text-xs mb-3" style="color: var(--sys-label3)">
					Pastikan semua training ini Lulus sebelum turun ke proyek. <strong>{prasyaratSiap} dari {prasyarat.length}</strong> sudah siap.
				</p>
				<ul class="glass-panel rounded-2xl divide-y divide-black/5">
					{#each prasyarat as p (p.program_id)}
						{@const info = sopStateInfo(p.state)}
						<li class="p-4 flex items-center gap-3">
							{#if info.tone === 'ok'}<IconCircleCheck size={20} style="color:#059669" />
							{:else if info.tone === 'jalan'}<IconClock size={20} style="color:#D97706" />
							{:else if info.tone === 'belum'}<IconAlertTriangle size={20} style="color:#DC2626" />
							{:else}<IconCircleDashed size={20} style="color: var(--sys-label3)" />{/if}
							<div class="min-w-0 flex-1">
								<p class="text-sm font-semibold" style="color: var(--sys-label)">{p.judul}</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">{info.label}{#if p.state === 'tidak_terdaftar'} — belum ada pendaftaran; hubungi HRD/atasan{/if}</p>
							</div>
							{#if p.state !== 'tidak_terdaftar'}
								<button class="shrink-0 text-xs font-bold flex items-center gap-0.5" style="color: var(--p, var(--g))" onclick={() => buka(p.program_id)} aria-label="Buka prasyarat {p.judul}">
									{p.state === 'lulus' ? 'Lihat' : 'Belajar'} <IconChevronRight size={14} />
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		{#if adaSop}
		<div class="mb-8" data-testid="sop-saya-training">
			<h2 class="text-sm font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style="color: var(--sys-label3)">
				<IconListCheck size={16} /> Training dari SOP Saya
			</h2>
			<p class="text-xs mb-3" style="color: var(--sys-label3)">
				Training yang ditautkan pada alur SOP untuk jabatan <strong>{data.jabatan?.nama}</strong>. Training yang baru didaftarkan belum dihitung ke KPI selama {grace} hari.
			</p>
			<div class="glass-panel rounded-2xl divide-y divide-black/5">
				{#each daftar as p (p.program_id)}
					{@const info = sopStateInfo(p.state)}
					<div class="p-4 flex items-start gap-3">
						<div class="mt-0.5 shrink-0">
							{#if info.tone === 'ok'}<IconCircleCheck size={20} style="color:#059669" />
							{:else if info.tone === 'jalan'}<IconClock size={20} style="color:#D97706" />
							{:else if info.tone === 'belum'}<IconAlertTriangle size={20} style="color:#DC2626" />
							{:else}<IconCircleDashed size={20} style="color: var(--sys-label3)" />{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="text-sm font-semibold" style="color: var(--sys-label)">
								{p.judul}
								{#if p.wajib}<span class="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-50 text-red-600">Wajib</span>{/if}
							</p>
							<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
								Dibutuhkan untuk alur:
								{#each p.alur as a, i}{i > 0 ? ' · ' : ' '}<strong>{a.flow_title}</strong> → langkah {a.node_label}{/each}{#if p.alur_total > p.alur.length} · +{p.alur_total - p.alur.length} lainnya{/if}
							</p>
							<p class="text-[11px] mt-1 font-semibold" style="color: {info.tone === 'ok' ? '#059669' : info.tone === 'belum' ? '#DC2626' : info.tone === 'jalan' ? '#D97706' : 'var(--sys-label3)'}">
								{info.label}{#if p.state === 'tidak_terdaftar'} — belum ada pendaftaran; hubungi HRD/atasan bila perlu segera{/if}
							</p>
						</div>
						{#if p.state !== 'tidak_terdaftar'}
							<button class="shrink-0 text-xs font-bold flex items-center gap-0.5" style="color: var(--p, var(--g))" onclick={() => buka(p.program_id)} aria-label="Buka training {p.judul}">
								{p.state === 'lulus' ? 'Lihat' : 'Belajar'} <IconChevronRight size={14} />
							</button>
						{/if}
					</div>
				{/each}
			</div>
			{#if tersembunyi > 0 || showAll}
				<button class="mt-2 text-xs font-bold underline" style="color: var(--p, var(--g))" onclick={() => (showAll = !showAll)}>
					{showAll ? 'Ringkas daftar' : `Lihat semua ${programs.length} training SOP`}
				</button>
			{/if}
		</div>
		{/if}
	{:else}
		<div class="mb-8 glass-panel rounded-2xl p-5" data-testid="sop-saya-kesiapan">
			<div class="flex items-start justify-between gap-3">
				<div>
					<h2 class="text-lg font-bold flex items-center gap-2" style="color: var(--sys-label)">
						<IconListCheck size={20} style="color: var(--p, var(--g))" /> Kesiapan SOP Saya
					</h2>
					<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
						Seberapa siap Anda mengerjakan langkah SOP jabatan <strong>{data.jabatan?.nama}</strong>. Langkah dianggap siap bila training yang ditautkan sudah Lulus.
					</p>
				</div>
				<div class="text-right shrink-0">
					<p class="text-2xl font-extrabold" style="color: {warna}">{nilai != null ? `${nilai}%` : '–'}</p>
					<p class="text-[10px]" style="color: var(--sys-label3)">{nilai != null ? 'siap' : 'belum dinilai'}</p>
				</div>
			</div>

			{#if nilai == null}
				<p class="text-[11px] mt-3 rounded-lg px-3 py-2 bg-slate-50" style="color: var(--sys-label3)">
					Belum bisa dinilai — training SOP Anda masih dalam masa tenggang ({grace} hari sejak didaftarkan) atau belum didaftarkan. Tidak ada yang mengurangi KPI Anda saat ini.
				</p>
			{/if}

			{#if alurTotal > 0}
				<!-- R10: skill gap berbasis alur -->
				<p class="text-xs mt-3 font-semibold" style="color: var(--sys-label)" data-testid="sop-alur-dikuasai">
					Anda menguasai {alurDikuasai} dari {alurTotal} alur SOP jabatan Anda.
					{#if alurPerluTingkat.length > 0}<span class="font-normal" style="color: var(--sys-label3)">Perlu ditingkatkan: {alurPerluTingkat.map((f) => f.flow_title).join(', ')}.</span>{/if}
				</p>
			{/if}

			{#if flowsBerlaku.length > 0}
				<div class="mt-4 space-y-2">
					{#each flowsBerlaku.slice(0, 5) as f (f.flow_id)}
						{@const dinilai = f.siap + f.belum_siap}
						<div>
							<div class="flex items-center justify-between text-xs">
								<span class="font-semibold truncate pr-2" style="color: var(--sys-label)">{f.flow_title}</span>
								<span class="shrink-0" style="color: var(--sys-label3)">{f.siap}/{f.langkah} langkah siap{#if f.ditunda > 0} · {f.ditunda} menunggu training{/if}</span>
							</div>
							<div class="h-1.5 rounded-full bg-slate-100 mt-1 overflow-hidden" role="progressbar" aria-valuenow={f.langkah ? Math.round((f.siap / f.langkah) * 100) : 0} aria-valuemin="0" aria-valuemax="100" aria-label="Kesiapan alur {f.flow_title}">
								<div class="h-full rounded-full" style="width:{f.langkah ? Math.round((f.siap / f.langkah) * 100) : 0}%; background:{dinilai > 0 && f.belum_siap > 0 ? '#D97706' : '#059669'}"></div>
							</div>
						</div>
					{/each}
					{#if flowsBerlaku.length > 5}
						<p class="text-[11px]" style="color: var(--sys-label3)">+{flowsBerlaku.length - 5} alur lainnya</p>
					{/if}
				</div>
			{/if}

			{#if sarankan.length > 0}
				<div class="mt-4 rounded-xl p-3 bg-blue-50 border border-blue-100">
					<p class="text-[11px] font-bold text-blue-800">Saran: selesaikan training berikut untuk mencapai 100%</p>
					<ul class="mt-1 space-y-1">
						{#each sarankan as t (t.program_id)}
							<li>
								<button class="text-xs font-semibold underline text-blue-700 text-left" onclick={() => buka(t.program_id)}>{t.judul}</button>
							</li>
						{/each}
					</ul>
				</div>
			{:else if nilai === 100}
				<p class="text-[11px] mt-3 flex items-center gap-1.5 text-emerald-700"><IconCircleCheck size={14} /> Semua training SOP jabatan Anda sudah Lulus. Pertahankan!</p>
			{/if}
		</div>
	{/if}
{/if}
