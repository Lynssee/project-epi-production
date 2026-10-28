<!-- Toast.svelte — Sistem notifikasi toast global (sukses/error/info) dengan auto-dismiss 3 detik -->
<script lang="ts">
	// Simple toast notification system
	interface Toast {
		id: number;
		message: string;
		type: 'success' | 'error' | 'info';
	}

	let toasts = $state<Toast[]>([]);
	let nextId = 0;

	// Export functions via window for global access
	function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
		const id = nextId++;
		toasts = [...toasts, { id, message, type }];
		setTimeout(() => {
			toasts = toasts.filter(t => t.id !== id);
		}, 3000);
	}

	// Make available globally
	if (typeof window !== 'undefined') {
		(window as any).__showToast = showToast;
	}
</script>

{#if toasts.length > 0}
	<div class="fixed top-4 left-1/2 -translate-x-1/2 z-[999] flex flex-col gap-2 max-w-[380px] w-full px-4">
		{#each toasts as toast (toast.id)}
			<div
				class="py-2.5 px-4 rounded-xl text-[13px] font-medium shadow-lg flex items-center gap-2 animate-slide-down
					{toast.type === 'success' ? 'bg-[var(--g2)] text-white' : ''}
					{toast.type === 'error' ? 'bg-[var(--re)] text-white' : ''}
					{toast.type === 'info' ? 'bg-[var(--p)] text-white' : ''}"
			>
				<span>
					{#if toast.type === 'success'}✓{:else if toast.type === 'error'}✕{:else}ℹ{/if}
				</span>
				{toast.message}
			</div>
		{/each}
	</div>
{/if}

<style>
	@keyframes slide-down {
		from { opacity: 0; transform: translateY(-10px); }
		to { opacity: 1; transform: translateY(0); }
	}
	.animate-slide-down {
		animation: slide-down 0.25s ease-out;
	}
</style>
