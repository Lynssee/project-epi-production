<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { IconId, IconLoader2 } from '@tabler/icons-svelte';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { openKioskNumpad } from '$lib/components/kiosk/kioskNumpad';

	let badge = $state('');
	let pin = $state('');

	// File 11 §5 — numpad layar untuk PIN, masked (●●●●●●), tanpa desimal. Keyboard OS tablet
	// berbeda-beda per merek dan kadang tidak muncul sama sekali di PC layar sentuh.
	async function bukaNumpadPin() {
		const hasil = await openKioskNumpad({ judul: 'Masukkan PIN', nilaiAwal: pin, masked: true, maxLength: 6 });
		if (hasil !== null) pin = hasil;
	}
	let loading = $state(false);
	let errorMsg = $state('');
	let badgeRead = $state('');
	let gagalBerturut = $state(0);
	let badgeInputEl = $state<HTMLInputElement | null>(null);
	let pinInputEl = $state<HTMLInputElement | null>(null);

	function onBadgeKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault(); // jangan submit form dengan PIN kosong (scanner selalu kirim Enter)
			if (badge.trim()) {
				const parsed = parseEpiQr(badge.trim());
				badgeRead = parsed?.type === 'BADGE' ? String(parsed.id) : badge.trim();
				pinInputEl?.focus();
			}
		}
	}

	// Auto-submit begitu PIN lengkap 6 digit — operator tidak perlu mencari tombol "Masuk".
	$effect(() => {
		if (pin.length === 6 && badge.trim() && !loading) login();
	});

	async function login() {
		if (!badge.trim() || !pin.trim()) {
			errorMsg = 'Isi badge dan PIN dulu.';
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/kiosk/login', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ badge: badge.trim(), pin: pin.trim() })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Login gagal.');
			gagalBerturut = 0;
			await invalidateAll();
			goto('/kiosk/home');
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Login gagal.';
			gagalBerturut += 1;
			// Kosongkan PIN, fokus kembali ke PIN, tapi PERTAHANKAN badge (jangan suruh scan ulang).
			pin = '';
			pinInputEl?.focus();
		} finally {
			loading = false;
		}
	}
</script>

<div class="login-wrap">
	<div class="login-card">
		<IconId size={48} style="color: #64748b" />
		<h1>Kiosk Produksi</h1>
		<p class="hint">1. Tempelkan kartu ke alat scan (atau ketik nomor badge). 2. Ketik PIN 6 angka. Kiosk akan masuk otomatis.</p>

		{#if errorMsg}<div class="error">{errorMsg}</div>{/if}
		{#if gagalBerturut >= 3}
			<div class="hint-lupa">Lupa PIN? Minta admin buat PIN baru di menu Akses Kiosk.</div>
		{/if}

		<form
			class="login-form"
			onsubmit={(e) => {
				e.preventDefault();
				login();
			}}
		>
			<input
				bind:this={badgeInputEl}
				bind:value={badge}
				onkeydown={onBadgeKeydown}
				name="badge"
				placeholder="Scan kartu / ketik no. badge"
				class="input"
				autofocus
				autocomplete="username"
			/>
			{#if badgeRead}<p class="badge-ok">✓ Kartu terbaca: {badgeRead}. Ketik PIN Anda.</p>{/if}
			<div class="pin-group" style="width: 100%; display: flex; gap: 0.5rem;">
				<input
					bind:this={pinInputEl}
					bind:value={pin}
					name="pin"
					type="password"
					inputmode="numeric"
					maxlength="6"
					placeholder="PIN 6 digit"
					class="input"
					autocomplete="current-password"
					style="flex: 1;"
				/>
				<button type="button" class="input input--pin" style="width: auto; padding: 0.5rem 1rem;" onclick={bukaNumpadPin} title="Buka tombol angka di layar">
					🔢
				</button>
			</div>

			<button type="submit" class="submit" disabled={loading}>
				{#if loading}<IconLoader2 size={20} class="animate-spin" />{:else}Masuk{/if}
			</button>
		</form>
	</div>
</div>

<style>
	.login-wrap { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 2rem; }
	.login-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		background: white;
		padding: 2.5rem 2rem;
		border-radius: 1.5rem;
		box-shadow: 0 10px 30px rgba(0,0,0,0.08);
		width: 100%;
		max-width: 400px;
	}
	.login-form {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
	}
	h1 { font-size: 1.5rem; font-weight: 800; margin: 0; color: #0f172a; }
	.hint { text-align: center; color: #64748b; font-size: 1rem; margin: 0 0 0.5rem; }
	.input {
		width: 100%;
		padding: 1rem;
		font-size: 1.25rem;
		border: 2px solid #e2e8f0;
		border-radius: 0.75rem;
		text-align: center;
	}
	.input:focus { outline: none; border-color: #16a34a; }
	.input--pin { cursor: pointer; background: white; color: #0f172a; font-weight: 700; letter-spacing: 0.15em; }
	.submit {
		width: 100%;
		min-height: 64px;
		background: #16a34a;
		color: white;
		font-weight: 800;
		font-size: 1.25rem;
		border: none;
		border-radius: 0.75rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.submit:disabled { opacity: 0.6; }
	.badge-ok {
		width: 100%;
		margin: -0.25rem 0 0;
		color: #15803d;
		font-weight: 700;
		font-size: 0.95rem;
		text-align: center;
	}
	.hint-lupa {
		width: 100%;
		background: #fffbeb;
		color: #92400e;
		padding: 0.6rem;
		border-radius: 0.5rem;
		text-align: center;
		font-size: 0.9rem;
	}
	.error {
		width: 100%;
		background: #fef2f2;
		color: #b91c1c;
		padding: 0.75rem;
		border-radius: 0.5rem;
		text-align: center;
		font-size: 0.95rem;
	}
</style>
