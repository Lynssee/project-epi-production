<script lang="ts">
	// Banner "Versi baru tersedia" untuk registerType: 'prompt' (rencana v2, 1.4).
	// Wajib satu paket dengan perubahan itu — tanpa ini user tidak akan pernah menerima versi baru.
	import { browser } from '$app/environment';
	import { IconRefresh, IconX } from '@tabler/icons-svelte';

	let needRefresh = $state(false);
	let updateFn: ((reloadPage?: boolean) => Promise<void>) | null = null;
	let dismissed = $state(false);
	let updating = $state(false);

	if (browser) {
		import('virtual:pwa-register/svelte').then(({ useRegisterSW }) => {
			const sw = useRegisterSW({
				onRegisterError(err: unknown) {
					console.error('SW register error', err);
				},
				onRegisteredSW(_swUrl, _registration) {
					// Pendaftaran SW pasif — tanpa auto-poll berkala agar tidak mengganggu sesi aktif lapangan
				}
			});
			updateFn = sw.updateServiceWorker;
			sw.needRefresh.subscribe((v) => (needRefresh = v));
		});
	}

	async function reload() {
		if (!updateFn) return;
		updating = true;
		await updateFn(true);
		window.location.reload();
	}
</script>

{#if needRefresh && !dismissed}
	<div class="update-banner">
		<span class="update-banner__text">Versi baru tersedia</span>
		<button type="button" class="update-banner__reload" onclick={reload} disabled={updating}>
			<IconRefresh size={14} class={updating ? 'animate-spin' : ''} />
			{updating ? 'Memuat…' : 'Muat Ulang'}
		</button>
		<button type="button" class="update-banner__dismiss" onclick={() => (dismissed = true)} aria-label="Tutup">
			<IconX size={14} />
		</button>
	</div>
{/if}

<style>
	.update-banner {
		position: fixed;
		left: 50%;
		bottom: 72px;
		transform: translateX(-50%);
		z-index: 200;
		display: flex;
		align-items: center;
		gap: 10px;
		background: var(--sys-label, #1f2937);
		color: white;
		padding: 8px 10px 8px 14px;
		border-radius: 999px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		font-size: 12px;
		max-width: 92vw;
	}
	.update-banner__text {
		font-weight: 600;
		white-space: nowrap;
	}
	.update-banner__reload {
		display: flex;
		align-items: center;
		gap: 4px;
		background: white;
		color: #111827;
		font-weight: 700;
		font-size: 11px;
		padding: 5px 10px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.update-banner__reload:disabled {
		opacity: 0.6;
	}
	.update-banner__dismiss {
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0.7;
	}
</style>
