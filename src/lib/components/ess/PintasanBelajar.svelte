<script lang="ts">
	// Kartu kecil "Belajar cepat" di halaman kerja Project Leader (Inspection, Field Report, Pusat Pengajuan).
	// Pemetaan halaman → kursus diatur admin (app_settings training_lms/pintasan_konteks). Tidak tampil bila tak ada kursus relevan
	// yang belum lulus. Gagal memuat TIDAK menggagalkan halaman induk (dilog); 1 panggilan API per konteks per sesi (cache memori).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getPintasanBelajar, type PintasanItem } from '$lib/services/ess/training';
	import { IconSchool, IconChevronRight, IconX } from '@tabler/icons-svelte';

	let { konteks }: { konteks: string } = $props();

	let items = $state<PintasanItem[]>([]);
	let tersembunyi = $state(false);
	const KEY = () => `pintasan-belajar-tutup:${konteks}`;

	onMount(async () => {
		try {
			if (sessionStorage.getItem(KEY()) === '1') {
				tersembunyi = true;
				return;
			}
		} catch {
			/* sessionStorage tak tersedia (mode privat) — tampilkan saja */
		}
		try {
			items = (await getPintasanBelajar(konteks)).items;
		} catch (err) {
			console.warn('[PintasanBelajar] gagal memuat pintasan:', err);
		}
	});

	function tutup() {
		tersembunyi = true;
		try {
			sessionStorage.setItem(KEY(), '1');
		} catch {
			/* abaikan */
		}
	}
</script>

{#if !tersembunyi && items.length > 0}
	<aside class="glass-panel rounded-2xl p-3 md:p-4 mb-4" aria-label="Pintasan belajar">
		<div class="flex items-start justify-between gap-2">
			<p class="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style="color: var(--sys-label3)">
				<IconSchool size={14} /> Belajar cepat untuk pekerjaan ini
			</p>
			<button class="p-1 rounded-lg hover:bg-black/5" aria-label="Sembunyikan pintasan belajar" title="Sembunyikan (muncul lagi di sesi berikutnya)" onclick={tutup}>
				<IconX size={14} style="color: var(--sys-label4)" />
			</button>
		</div>
		<div class="mt-2 flex flex-col gap-2">
			{#each items as it (it.programId)}
				<button class="hover-lift text-left rounded-xl px-3 py-2.5 flex items-center justify-between gap-3" style="background: var(--sys-fill2)" onclick={() => goto(`/ess/pelatihan/${it.programId}`)}>
					<span class="min-w-0">
						<span class="block text-sm font-bold truncate" style="color: var(--sys-label)">{it.judul}</span>
						<span class="flex items-center gap-2 flex-wrap text-[11px] font-semibold" style="color: var(--sys-label4)">
							<span>{it.pilarLabel}</span>
							{#if it.durasiMenit}<span>· {it.durasiMenit} mnt</span>{/if}
							{#if it.wajib}<span style="color: var(--red)">· Wajib</span>{/if}
							<span>· {it.status === 'berjalan' ? `Lanjutkan (${it.progress}%)` : 'Belum dimulai'}</span>
						</span>
					</span>
					<IconChevronRight size={18} class="shrink-0" style="color: var(--sys-label4)" />
				</button>
			{/each}
		</div>
		<p class="text-[11px] mt-2 font-medium" style="color: var(--sys-label4)">Pintasan ini mengarah ke kursus yang relevan dengan halaman ini dan belum Anda selesaikan.</p>
	</aside>
{/if}
