<!-- src/lib/components/project/FieldResolutionModal.svelte -->
<!-- Modal pengiriman bukti penyelesaian instruksi dari lapangan ke kantor pusat -->
<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { submitResolution, type ProjectActionItem } from '$lib/services/projectActionApi';
	import { IconCheck, IconCamera, IconX, IconLoader2, IconPhoto } from '@tabler/icons-svelte';

	interface Props {
		actionItem: ProjectActionItem | null;
		actor: { id: string; nama: string };
		onClose: () => void;
		onSuccess: () => void;
	}

	let { actionItem, actor, onClose, onSuccess }: Props = $props();

	let notes = $state('');
	let selectedPhotos = $state<File[]>([]);
	let photoPreviews = $state<string[]>([]);
	let submitting = $state(false);
	let errorMsg = $state('');

	function handlePhotoSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		const files = Array.from(input.files);
		selectedPhotos = [...selectedPhotos, ...files];

		// Buat preview thumbnail
		files.forEach((file) => {
			const reader = new FileReader();
			reader.onload = (ev) => {
				if (ev.target?.result) {
					photoPreviews = [...photoPreviews, ev.target.result as string];
				}
			};
			reader.readAsDataURL(file);
		});
	}

	function removePhoto(index: number) {
		selectedPhotos = selectedPhotos.filter((_, i) => i !== index);
		photoPreviews = photoPreviews.filter((_, i) => i !== index);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!actionItem) return;
		if (!notes.trim()) {
			errorMsg = 'Tuliskan catatan penyelesaian pekerjaan secara singkat';
			return;
		}

		submitting = true;
		errorMsg = '';
		try {
			await submitResolution(actionItem.id, {
				catatan_penyelesaian: notes.trim(),
				actor,
				proofPhotos: selectedPhotos,
				itemDetails: actionItem
			});
			onSuccess();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim bukti penyelesaian';
		} finally {
			submitting = false;
		}
	}
</script>

{#if actionItem}
	<div
		class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="bg-white dark:bg-slate-900 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
			transition:slide={{ duration: 200 }}
		>
			<!-- Header -->
			<div class="p-4 border-b border-slate-200 dark:border-slate-800 bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-sm font-bold">
						✓
					</div>
					<div>
						<h3 class="text-xs font-bold text-slate-800 dark:text-slate-100 uppercase tracking-wider">
							Laporan Pelaksanaan Arahan / Selesai
						</h3>
						<p class="text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
							{actionItem.nomor_dokumen}
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-700 flex items-center justify-center"
				>
					<IconX size={16} />
				</button>
			</div>

			<!-- Body -->
			<form onsubmit={handleSubmit} class="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
				<!-- Ringkasan Instruksi -->
				<div class="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
					<div class="font-bold text-slate-800 dark:text-slate-100 mb-0.5">{actionItem.judul}</div>
					<div class="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2">{actionItem.deskripsi}</div>
				</div>

				<!-- Catatan Hasil Pekerjaan -->
				<div>
					<label for="resolution-notes" class="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
						Catatan Penanganan / Hasil Pekerjaan <span class="text-rose-500">*</span>
					</label>
					<textarea
						id="resolution-notes"
						rows={3}
						placeholder="Jelaskan tindakan yang telah dilakukan di lapangan..."
						bind:value={notes}
						class="w-full text-xs p-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						required
					></textarea>
				</div>

				<!-- Upload Foto Kamera -->
				<div>
					<div class="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
						Foto Hasil Kerja / Bukti Lapangan
					</div>

					<div class="flex items-center gap-2 flex-wrap">
						<!-- Camera Button Direct -->
						<label
							class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition active:scale-95"
						>
							<IconCamera size={16} />
							<span>Ambil Foto</span>
							<input
								type="file"
								accept="image/*"
								capture="environment"
								onchange={handlePhotoSelect}
								class="hidden"
							/>
						</label>

						<!-- Gallery Upload -->
						<label
							class="cursor-pointer inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium transition"
						>
							<IconPhoto size={16} />
							<span>Galeri HP</span>
							<input
								type="file"
								accept="image/*"
								multiple
								onchange={handlePhotoSelect}
								class="hidden"
							/>
						</label>
					</div>

					<!-- Previews -->
					{#if photoPreviews.length > 0}
						<div class="grid grid-cols-3 gap-2 mt-2.5">
							{#each photoPreviews as preview, idx}
								<div class="relative w-full h-20 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 group">
									<img src={preview} alt="Preview Bukti" class="w-full h-full object-cover" />
									<button
										type="button"
										onclick={() => removePhoto(idx)}
										class="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-[10px] shadow-sm"
									>
										✕
									</button>
								</div>
							{/each}
						</div>
						<p class="text-[10px] text-slate-400 mt-1">Foto otomatis dikompresi agar hemat kuota internet.</p>
					{/if}
				</div>

				{#if errorMsg}
					<div class="p-2.5 rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-200 text-xs">
						⚠️ {errorMsg}
					</div>
				{/if}

				<!-- Actions -->
				<div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
					<button
						type="button"
						onclick={onClose}
						disabled={submitting}
						class="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 font-medium hover:bg-slate-100"
					>
						Batal
					</button>
					<button
						type="submit"
						disabled={submitting}
						class="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
					>
						{#if submitting}
							<IconLoader2 size={16} class="animate-spin" />
							<span>Mengirim Laporan...</span>
						{:else}
							<IconCheck size={16} />
							<span>Laporkan Sudah Dilaksanakan</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
