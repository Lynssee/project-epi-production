<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { fetchActiveDelayReasons, createDelayFlag, type DelayReason } from '$lib/services/timelineDelayFlags';
	import { IconX, IconLoader2 } from '@tabler/icons-svelte';

	let {
		open = $bindable(false),
		projectId,
		categoryId,
		subtaskId,
		subtaskName,
		daysDelayed,
		onSubmitted = () => {}
	}: {
		open: boolean;
		projectId: number;
		categoryId: string;
		subtaskId: string;
		subtaskName: string;
		daysDelayed: number;
		onSubmitted?: () => void;
	} = $props();

	let reasons = $state<DelayReason[]>([]);
	let selectedReasonId = $state<number | ''>('');
	let note = $state('');
	let saving = $state(false);
	let loadingReasons = $state(false);
	let errorMsg = $state('');

	$effect(() => {
		if (open && reasons.length === 0 && !loadingReasons) {
			loadingReasons = true;
			fetchActiveDelayReasons().then((r) => {
				reasons = r;
				loadingReasons = false;
			});
		}
	});

	function resetForm() {
		selectedReasonId = '';
		note = '';
		errorMsg = '';
	}

	function close() {
		open = false;
		resetForm();
	}

	async function handleSubmit() {
		errorMsg = '';
		if (!selectedReasonId) {
			errorMsg = 'Pilih alasan keterlambatan';
			return;
		}
		saving = true;
		try {
			const res = await createDelayFlag({
				projectId,
				categoryId,
				subtaskId,
				subtaskName,
				daysDelayed,
				delayReasonId: Number(selectedReasonId),
				note: note.trim() || null
			});
			if (res.success) {
				onSubmitted();
				close();
			} else {
				errorMsg = res.error || 'Gagal menyimpan alasan delay';
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Terjadi kesalahan';
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<div class="sheet-overlay" onclick={close} role="presentation">
		<div class="sheet-content" onclick={(e) => e.stopPropagation()} role="dialog">
			<div class="sheet-handle"></div>
			<div class="sheet-header">
				<h3>⏱️ Isi Alasan Keterlambatan</h3>
				<button class="sheet-close" onclick={close}><IconX size={20} /></button>
			</div>

			<div class="sheet-body">
				<div class="current-info">
					<strong>{subtaskName}</strong><br />
					Terlambat {daysDelayed} hari dari rencana
				</div>

				<label class="field-label" for="reason-select">Alasan <span class="required">*</span></label>
				{#if loadingReasons}
					<div class="loading-row"><CircularProgressGauge size={36} strokeWidth={3} label="Memuat kategori alasan..." /></div>
				{:else}
					<select id="reason-select" bind:value={selectedReasonId}>
						<option value="">-- Pilih Alasan --</option>
						{#each reasons as r}
							<option value={r.id}>{r.name}</option>
						{/each}
					</select>
				{/if}

				<label class="field-label" for="note-input">Catatan (opsional)</label>
				<textarea id="note-input" bind:value={note} rows="2" placeholder="Detail tambahan..."></textarea>

				{#if errorMsg}
					<div class="error-msg">{errorMsg}</div>
				{/if}
			</div>

			<div class="sheet-footer">
				<button class="btn-cancel" onclick={close} disabled={saving}>Batal</button>
				<button class="btn-submit" onclick={handleSubmit} disabled={saving}>
					{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
					{saving ? 'Menyimpan...' : 'Simpan'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.sheet-overlay {
		position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 1000;
		display: flex; align-items: flex-end; justify-content: center;
	}
	.sheet-content {
		background: white; width: 100%; max-width: 480px; border-radius: 20px 20px 0 0;
		max-height: 88vh; display: flex; flex-direction: column; overflow: hidden;
	}
	.sheet-handle { width: 36px; height: 4px; background: #d1d5db; border-radius: 2px; margin: 10px auto 0; }
	.sheet-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
	.sheet-header h3 { margin: 0; font-size: 15px; font-weight: 700; color: #1e293b; }
	.sheet-close { background: none; border: none; color: #64748b; padding: 4px; }
	.sheet-body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
	.field-label { font-size: 12px; font-weight: 600; color: #374151; margin-top: 12px; margin-bottom: 4px; }
	.required { color: #dc2626; }
	select, input, textarea {
		width: 100%; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px;
		font-size: 13px; box-sizing: border-box; font-family: inherit; background: #f8fafc;
	}
	.current-info { font-size: 12px; color: #475569; background: #fef3f2; padding: 8px 10px; border-radius: 10px; margin-top: 8px; line-height: 1.5; }
	.loading-row { font-size: 12px; color: #64748b; display: flex; align-items: center; gap: 6px; padding: 6px 0; }
	.error-msg { font-size: 12px; color: #dc2626; background: #fef2f2; padding: 8px 10px; border-radius: 10px; margin-top: 12px; }
	.sheet-footer { display: flex; gap: 8px; padding: 12px 16px; border-top: 1px solid #f1f5f9; }
	.btn-cancel, .btn-submit {
		flex: 1; padding: 12px; border-radius: 12px; font-size: 14px; font-weight: 600; cursor: pointer; border: none;
		display: flex; align-items: center; justify-content: center; gap: 6px;
	}
	.btn-cancel { background: #f1f5f9; color: #475569; }
	.btn-submit { background: #dc2626; color: white; }
	.btn-cancel:disabled, .btn-submit:disabled { opacity: 0.6; }
</style>
