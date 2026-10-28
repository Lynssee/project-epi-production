<!-- src/lib/components/shared/TaskProgressModal.svelte -->
<script lang="ts">
	import { fade, scale } from 'svelte/transition';

	interface StepItem {
		label: string;
		status?: 'pending' | 'running' | 'done' | 'error';
	}

	interface Props {
		open?: boolean;
		title?: string;
		description?: string;
		icon?: string;
		progress?: number;
		steps?: StepItem[];
		currentStepIndex?: number;
		error?: string | null;
		successMessage?: string;
		canCancel?: boolean;
		onCancel?: (() => void) | null;
		onClose?: (() => void) | null;
	}

	let {
		open = false,
		title = 'Memproses Tindakan...',
		description = '',
		icon = '⚡',
		progress = 0,
		steps = [],
		currentStepIndex = 0,
		error = null,
		successMessage = '',
		canCancel = false,
		onCancel = null,
		onClose = null
	}: Props = $props();

	let boundedProgress = $derived(Math.max(0, Math.min(100, Math.round(Number(progress) || 0))));
	let isCompleted = $derived(boundedProgress >= 100 && !error);
</script>

{#if open}
	<div 
		class="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
		transition:fade={{ duration: 180 }}
	>
		<div 
			class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-md w-full p-6 overflow-hidden relative"
			transition:scale={{ start: 0.95, duration: 200 }}
		>
			<!-- Header -->
			<div class="flex items-center gap-3.5 mb-4">
				<div class="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-800/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xl shrink-0 shadow-xs">
					{icon}
				</div>
				<div class="flex-1 min-w-0">
					<h3 class="text-base font-bold text-slate-900 dark:text-white truncate">
						{title}
					</h3>
					{#if description}
						<p class="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
							{description}
						</p>
					{/if}
				</div>
			</div>

			<!-- Main Progress Bar -->
			<div class="space-y-1.5 mb-5">
				<div class="flex items-center justify-between text-xs">
					<span class="font-medium text-slate-600 dark:text-slate-300">
						{#if error}
							<span class="text-rose-500 font-semibold">Terjadi kendala</span>
						{:else if isCompleted}
							<span class="text-emerald-500 font-semibold">Selesai 100%</span>
						{:else}
							Memproses ({boundedProgress}%)
						{/if}
					</span>
					<span class="font-mono font-bold text-emerald-600 dark:text-emerald-400">
						{boundedProgress}%
					</span>
				</div>
				
				<div class="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5">
					<div 
						class="h-full rounded-full transition-all duration-300 ease-out relative {error ? 'bg-rose-500' : isCompleted ? 'bg-emerald-500' : 'bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]'}"
						style="width: {boundedProgress}%"
					></div>
				</div>
			</div>

			<!-- Steps Checklist -->
			{#if steps && steps.length > 0}
				<div class="space-y-2 mb-5 bg-slate-50 dark:bg-slate-950/50 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800/80">
					{#each steps as step, idx}
						{@const status = step.status || (idx < currentStepIndex ? 'done' : idx === currentStepIndex ? 'running' : 'pending')}
						<div class="flex items-center gap-3 text-xs">
							{#if status === 'done'}
								<div class="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 text-[11px] font-bold shadow-xs">
									✓
								</div>
								<span class="text-slate-700 dark:text-slate-300 font-medium line-through opacity-80">{step.label}</span>
							{:else if status === 'running'}
								<div class="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 border border-emerald-400 flex items-center justify-center shrink-0">
									<div class="w-2.5 h-2.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin"></div>
								</div>
								<span class="text-slate-900 dark:text-white font-bold">{step.label}</span>
							{:else if status === 'error'}
								<div class="w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 text-[11px] font-bold">
									✕
								</div>
								<span class="text-rose-600 dark:text-rose-400 font-medium">{step.label}</span>
							{:else}
								<div class="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-400 flex items-center justify-center shrink-0 text-[10px]">
									{idx + 1}
								</div>
								<span class="text-slate-400 dark:text-slate-500">{step.label}</span>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<!-- Error Alert -->
			{#if error}
				<div class="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-xs text-rose-700 dark:text-rose-300 mb-4">
					⚠️ {error}
				</div>
			{/if}

			<!-- Success Notification -->
			{#if isCompleted && successMessage}
				<div class="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs text-emerald-700 dark:text-emerald-300 mb-4">
					🎉 {successMessage}
				</div>
			{/if}

			<!-- Actions Footer -->
			<div class="flex items-center justify-end gap-2 pt-2">
				{#if canCancel && !isCompleted && !error && onCancel}
					<button
						type="button"
						onclick={onCancel}
						class="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
					>
						Batal
					</button>
				{/if}

				{#if isCompleted || error}
					<button
						type="button"
						onclick={onClose}
						class="px-5 py-2 text-xs font-bold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white rounded-xl shadow-xs transition-colors"
					>
						Tutup
					</button>
				{/if}
			</div>
		</div>
	</div>
{/if}
