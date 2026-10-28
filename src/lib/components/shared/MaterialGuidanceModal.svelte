<!-- src/lib/components/shared/MaterialGuidanceModal.svelte -->
<!-- Modal Edukasi & Guidance Bahan Baku Lapangan (Mobile-Friendly) -->
<script lang="ts">
	import { fade, fly } from 'svelte/transition';
	import type { MaterialProfileView } from '$lib/services/rndField';

	interface Props {
		open?: boolean;
		material?: MaterialProfileView | null;
		onClose?: () => void;
	}

	let { open = false, material = null, onClose }: Props = $props();

	function handleClose() {
		if (onClose) onClose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) handleClose();
	}

	function getHazardBadge(tingkat?: string | null) {
		const val = String(tingkat || '').toLowerCase();
		switch (val) {
			case 'rendah':
				return {
					label: 'Bahaya Rendah (Aman)',
					badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
					icon: '🟢'
				};
			case 'sedang':
				return {
					label: 'Bahaya Sedang (Iritasi)',
					badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800',
					icon: '🟡'
				};
			case 'tinggi':
				return {
					label: 'Bahaya Tinggi (Mudah Terbakar/Toksik)',
					badgeClass: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border-orange-300 dark:border-orange-800',
					icon: '⚠️'
				};
			case 'sangat_tinggi':
				return {
					label: 'Bahaya Sangat Tinggi (Ekstrem)',
					badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300 dark:border-rose-800',
					icon: '☠️'
				};
			default:
				return {
					label: 'Standar Lab',
					badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700',
					icon: 'ℹ️'
				};
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open && material}
	<!-- Backdrop Overlay -->
	<div
		class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-xs"
		transition:fade={{ duration: 180 }}
		onclick={handleClose}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClose(); }}
		role="button"
		tabindex="0"
		aria-label="Tutup Dialog"
	>
		<!-- Modal Card (Sheet on Mobile, Center Modal on Tablet/Desktop) -->
		<div
			class="w-full sm:max-w-lg max-h-[90vh] bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden relative"
			transition:fly={{ y: 80, duration: 220 }}
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-labelledby="material-guidance-title"
			tabindex="-1"
		>
			<!-- Mobile Pull Bar -->
			<div class="sm:hidden w-full flex justify-center pt-3 pb-1">
				<div class="w-12 h-1 bg-slate-300 dark:bg-slate-700 rounded-full"></div>
			</div>

			<!-- Header -->
			<div class="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-3 bg-slate-50/80 dark:bg-slate-800/60">
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2 flex-wrap mb-1">
						<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
							<span>🔬</span> Panduan Bahan
						</span>
						{#if material.kelas}
							<span class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
								{material.kelas}
							</span>
						{/if}
						{#if material.tingkat_bahaya}
							{@const hazard = getHazardBadge(material.tingkat_bahaya)}
							<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border {hazard.badgeClass}">
								<span>{hazard.icon}</span> {hazard.label}
							</span>
						{/if}
					</div>

					<h2 id="material-guidance-title" class="text-base font-bold text-slate-900 dark:text-white truncate">
						{material.nama}
					</h2>

					<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
						{material.kode_item}{material.kode_rm ? ` · ${material.kode_rm}` : ''}{material.cas_number ? ` · CAS ${material.cas_number}` : ''}
					</p>
				</div>

				<!-- Close Button -->
				<button
					type="button"
					class="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
					onclick={handleClose}
					aria-label="Tutup"
				>
					✕
				</button>
			</div>

			<!-- Scrollable Body -->
			<div class="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
				<!-- 1. Deskripsi Edukasi (Ramah Awam) -->
				<div class="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/60 rounded-xl p-3.5">
					<h3 class="text-[11px] font-bold text-blue-950 dark:text-blue-200 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
						<span>💡</span> Apa Itu {material.nama}?
					</h3>
					{#if material.deskripsi_edukasi}
						<p class="text-[12px] text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-line">
							{material.deskripsi_edukasi}
						</p>
					{:else if material.deskripsi_tds}
						<p class="text-[12px] text-slate-800 dark:text-slate-200 leading-relaxed">
							{material.deskripsi_tds}
						</p>
					{:else}
						<p class="text-[11px] text-slate-500 dark:text-slate-400 italic">
							Deskripsi edukatif sedang disiapkan oleh tim R&D.
						</p>
					{/if}
				</div>

				<!-- 2. Fungsi Utama Formulasi -->
				{#if material.fungsi_utama}
					<div class="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
						<h3 class="text-[11px] font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
							<span>🎯</span> Fungsi Utama
						</h3>
						<p class="text-[12px] font-medium text-slate-800 dark:text-slate-200 leading-normal">
							{material.fungsi_utama}
						</p>
					</div>
				{/if}

				<!-- 3. Cocok Digunakan untuk Produk Apa Saja -->
				{#if material.cocok_untuk_produk && material.cocok_untuk_produk.length > 0}
					<div class="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5">
						<h3 class="text-[11px] font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5 mb-2">
							<span>📦</span> Cocok untuk Produk
						</h3>
						<div class="flex flex-wrap gap-1.5">
							{#each material.cocok_untuk_produk as p}
								<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-600">
									<span class="text-emerald-500 font-bold">✓</span> {p}
								</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- 4. APD Wajib & Larangan Campur -->
				<div class="bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/60 rounded-xl p-3.5 space-y-2.5">
					<h3 class="text-[11px] font-bold text-amber-950 dark:text-amber-200 uppercase tracking-wider flex items-center gap-1.5">
						<span>🦺</span> K3 & Perlindungan Diri Lapangan
					</h3>

					{#if material.panduan_apd && material.panduan_apd.length > 0}
						<div>
							<span class="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">APD Wajib Saat Menangani Bahan:</span>
							<div class="flex flex-wrap gap-1.5">
								{#each material.panduan_apd as apd}
									<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-amber-200 dark:border-amber-800/60">
										🛡️ {apd}
									</span>
								{/each}
							</div>
						</div>
					{/if}

					{#if material.inkompatibilitas_tags && material.inkompatibilitas_tags.length > 0}
						<div class="pt-2 border-t border-amber-200/60 dark:border-amber-900/40">
							<span class="text-[10px] font-bold text-rose-600 dark:text-rose-400 block mb-1">⛔ Dilarang Dicampur Langsung Dengan:</span>
							<div class="flex flex-wrap gap-1.5">
								{#each material.inkompatibilitas_tags as tag}
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
										✕ {tag}
									</span>
								{/each}
							</div>
						</div>
					{/if}
				</div>

				<!-- 5. Tips Penanganan & Aplikasi Lapangan -->
				{#if material.tips_penggunaan || material.catatan_aplikasi}
					<div class="bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/60 rounded-xl p-3.5">
						<h3 class="text-[11px] font-bold text-emerald-950 dark:text-emerald-200 uppercase tracking-wider flex items-center gap-1.5 mb-1.5">
							<span>🛠️</span> Tips Penanganan Lapangan
						</h3>
						{#if material.tips_penggunaan}
							<p class="text-[12px] text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed">
								{material.tips_penggunaan}
							</p>
						{/if}
						{#if material.catatan_aplikasi}
							<p class="text-[11px] text-slate-600 dark:text-slate-400 italic mt-2 pt-2 border-t border-emerald-200/60 dark:border-emerald-900/40">
								<b>Catatan Aplikasi:</b> {material.catatan_aplikasi}
							</p>
						{/if}
					</div>
				{/if}

				<!-- 6. Dokumen TDS & MSDS -->
				{#if material.tds_url || material.msds_url}
					<div class="flex gap-2 pt-1">
						{#if material.tds_url}
							<a
								href={material.tds_url}
								target="_blank"
								rel="noopener noreferrer"
								class="flex-1 text-center py-2.5 rounded-xl font-bold text-[12px] text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-xs"
							>
								📄 Buka TDS
							</a>
						{/if}
						{#if material.msds_url}
							<a
								href={material.msds_url}
								target="_blank"
								rel="noopener noreferrer"
								class="flex-1 text-center py-2.5 rounded-xl font-bold text-[12px] text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-xs"
							>
								🛡️ Buka MSDS
							</a>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Footer -->
			<div class="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex justify-end">
				<button
					type="button"
					class="w-full sm:w-auto px-5 py-2 rounded-xl text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 transition-colors cursor-pointer"
					onclick={handleClose}
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}
