<script lang="ts">
	import { signInWithEmailAndPassword } from 'firebase/auth';
	import { auth } from '$lib/firebase';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { IconBuildingFactory2, IconLogin, IconLoader2, IconMail, IconLock, IconEye, IconEyeOff } from '@tabler/icons-svelte';

	let email = $state('');
	let password = $state('');
	let loading = $state(false);
	let errorMsg = $state('');
	let showPassword = $state(false);

	// Tujuan setelah login — dipakai saat masuk lewat QR fisik (mis. /scan/CP-AU-005)
	// yang mengarahkan kemari via /login?returnTo=... (lihat +layout.svelte).
	function safeReturnTo(): string {
		const returnTo = page.url.searchParams.get('returnTo');
		return returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/';
	}

	async function handleLogin() {
		if (!email || !password) {
			errorMsg = 'Email dan password harus diisi.';
			return;
		}
		try {
			loading = true;
			errorMsg = '';
			await signInWithEmailAndPassword(auth, email, password);
			goto(safeReturnTo());
		} catch (e: any) {
			if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
				errorMsg = 'Email atau password salah.';
			} else if (e.code === 'auth/too-many-requests') {
				errorMsg = 'Terlalu banyak percobaan. Coba lagi nanti.';
			} else {
				errorMsg = 'Gagal masuk. Periksa koneksi internet Anda.';
			}
		} finally {
			loading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleLogin();
	}
</script>

<div class="flex-1 flex flex-col" style="background: var(--sys-bg)">
	<!-- Hero -->
	<div class="relative overflow-hidden pt-14 pb-12 px-6 flex flex-col items-center text-white" style="background: linear-gradient(145deg, #1F6592 0%, #1B5478 55%, #1E1B4B 100%)">
		<!-- Decorative circles -->
		<div class="absolute -top-12 -right-12 w-48 h-48 rounded-full opacity-10" style="background: white"></div>
		<div class="absolute -bottom-16 -left-10 w-56 h-56 rounded-full opacity-8" style="background: white"></div>
		<div class="absolute top-8 left-6 w-24 h-24 rounded-full opacity-5" style="background: white"></div>

		<!-- App icon -->
		<div class="relative mb-5">
			<div class="w-20 h-20 rounded-[22px] flex items-center justify-center shadow-2xl" style="background: rgba(255,255,255,0.18); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.3)">
				<IconBuildingFactory2 size={40} />
			</div>
			<div class="absolute -bottom-1 -right-1 w-5 h-5 bg-[var(--am)] rounded-full border-2 border-white shadow-md flex items-center justify-center">
				<div class="w-1.5 h-1.5 bg-white rounded-full"></div>
			</div>
		</div>

		<h1 class="text-[22px] font-bold tracking-tight mb-1">ERP EPI</h1>
		<p class="text-[14px] opacity-70 font-medium">Sistem Laporan Harian Proyek</p>
	</div>

	<!-- Form Card -->
	<div class="flex-1 px-5 -mt-5 relative z-10">
		<div class="bg-white rounded-2xl shadow-lg p-5 mb-4" style="box-shadow: 0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.06)">
			{#if errorMsg}
				<div class="mb-4 text-[13px] rounded-xl flex items-center gap-2.5 p-3.5" style="background: var(--rel); color: var(--red); border: 1px solid rgba(226,75,74,0.15)">
					<span class="text-base shrink-0">⚠</span>
					{errorMsg}
				</div>
			{/if}

			<div class="mb-4">
				<label class="f-label">Email</label>
				<div class="relative">
					<div class="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color: var(--sys-label4)">
						<IconMail size={17} />
					</div>
					<input
						type="email"
						bind:value={email}
						class="f-input pl-10"
						placeholder="leader@eltamaprimaindo.com"
						onkeydown={handleKeydown}
					>
				</div>
			</div>
			<div class="mb-5">
				<label class="f-label">Password</label>
				<div class="relative">
					<div class="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color: var(--sys-label4)">
						<IconLock size={17} />
					</div>
					<input
						type={showPassword ? 'text' : 'password'}
						bind:value={password}
						class="f-input pl-10 pr-10"
						placeholder="••••••••"
						onkeydown={handleKeydown}
					>
					<button
						type="button"
						class="absolute right-3.5 top-1/2 -translate-y-1/2 focus:outline-none transition-colors cursor-pointer flex items-center justify-center"
						style="color: var(--sys-label4)"
						onclick={() => showPassword = !showPassword}
					>
						{#if showPassword}
							<IconEyeOff size={17} />
						{:else}
							<IconEye size={17} />
						{/if}
					</button>
				</div>
			</div>

			<button class="btn-primary" onclick={handleLogin} disabled={loading}>
				{#if loading}
					<IconLoader2 size={20} class="animate-spin" />
					Memproses...
				{:else}
					<IconLogin size={20} />
					Masuk
				{/if}
			</button>
		</div>

		<p class="text-center text-[12px] font-medium" style="color: var(--sys-label4)">Akses hanya untuk leader proyek</p>
	</div>
</div>
