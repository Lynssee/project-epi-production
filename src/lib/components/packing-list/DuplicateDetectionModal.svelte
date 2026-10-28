<!-- DuplicateDetectionModal.svelte — Modal deteksi item duplikat pada packing list dengan opsi lanjut atau batal -->
<script lang="ts">
	import { IconAlertTriangle, IconX } from '@tabler/icons-svelte';

	interface Props {
		duplicates: string[];
		onConfirm: (action: 'skip' | 'cancel') => void;
		show: boolean;
	}

	let { duplicates, onConfirm, show }: Props = $props();

	function handleSkip() {
		onConfirm('skip');
	}

	function handleCancel() {
		onConfirm('cancel');
	}
</script>

{#if show}
	<div class="modal-overlay" onclick={handleCancel}>
		<div class="modal-content" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">
				<div class="flex items-center gap-2">
					<IconAlertTriangle size={20} class="text-orange-500" />
					<h3 class="text-[15px] font-semibold text-gray-800">Item Duplikat Terdeteksi</h3>
				</div>
				<button class="close-btn" onclick={handleCancel}>
					<IconX size={18} />
				</button>
			</div>

			<div class="modal-body">
				<p class="text-[13px] text-gray-600 mb-3">
					Beberapa item dari template sudah ada di project ini:
				</p>

				<div class="duplicate-list">
					{#each duplicates as item}
						<div class="duplicate-item">
							<span class="text-[12px] text-gray-700">{item}</span>
						</div>
					{/each}
				</div>

				<p class="text-[12px] text-gray-500 mt-3">
					Item duplikat akan dilewati. Hanya item baru yang akan ditambahkan.
				</p>
			</div>

			<div class="modal-footer">
				<button class="btn-secondary" onclick={handleCancel}>
					Batal
				</button>
				<button class="btn-primary" onclick={handleSkip}>
					Lanjutkan (Skip Duplikat)
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 16px;
	}

	.modal-content {
		background: white;
		border-radius: 12px;
		max-width: 500px;
		width: 100%;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 16px 20px;
		border-bottom: 1px solid #e5e7eb;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: #9ca3af;
		cursor: pointer;
		transition: all 0.2s;
	}

	.close-btn:hover {
		background: #f3f4f6;
		color: #6b7280;
	}

	.modal-body {
		padding: 20px;
		overflow-y: auto;
		flex: 1;
	}

	.duplicate-list {
		max-height: 200px;
		overflow-y: auto;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 8px;
		background: #f9fafb;
	}

	.duplicate-item {
		padding: 8px 12px;
		background: white;
		border-radius: 6px;
		margin-bottom: 6px;
		border: 1px solid #e5e7eb;
	}

	.duplicate-item:last-child {
		margin-bottom: 0;
	}

	.modal-footer {
		display: flex;
		gap: 8px;
		padding: 16px 20px;
		border-top: 1px solid #e5e7eb;
		justify-content: flex-end;
	}

	.btn-secondary {
		padding: 8px 16px;
		border-radius: 8px;
		border: 1px solid #e5e7eb;
		background: white;
		color: #6b7280;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-secondary:hover {
		background: #f3f4f6;
		border-color: #d1d5db;
	}

	.btn-primary {
		padding: 8px 16px;
		border-radius: 8px;
		border: none;
		background: var(--g);
		color: white;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-primary:hover {
		background: var(--gd);
	}
</style>
