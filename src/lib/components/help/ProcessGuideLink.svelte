<!-- src/lib/components/help/ProcessGuideLink.svelte -->
<!-- Tombol bantuan kontekstual: membuka Panduan Alur langsung di langkah halaman ini (mis. fokus="survey"). -->
<script lang="ts">
	interface Props {
		/** id langkah di processGuidance.ts yang dibuka otomatis. */
		fokus: string;
		label?: string;
	}
	let { fokus, label = 'Lihat alur' }: Props = $props();
</script>

<a
	href="/panduan/alur?fokus={encodeURIComponent(fokus)}"
	class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-gray-200 text-gray-600 bg-white active:scale-95 transition-transform"
	title="Lihat posisi halaman ini di alur kerja: apa yang harus dilakukan dan ke mana lanjutnya"
>
	<span aria-hidden="true">🗺️</span>{label}
</a>
