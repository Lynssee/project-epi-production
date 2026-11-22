<script lang="ts">
	// Slideshow standby layar Kiosk (Budaya & Propaganda Fase 5). Dipasang HANYA di beranda kiosk (bukan di halaman input, supaya tidak
	// pernah menutupi formulir yang sedang diisi). Muncul setelah `idleSeconds` tanpa sentuhan/tombol/gerak; SENTUHAN APA PUN langsung menutupnya
	// dan menghitung ulang waktu menganggur — beranda kiosk (menu kerja) ada tepat di bawahnya, tanpa muat ulang. Fail-soft: mati / kosong / error → tidak tampil.
	import { onMount, onDestroy } from 'svelte';
	import { secureAssetSrc } from '$lib/actions/secureAsset';

	type Slide = any;

	const ROTASI_MS = 9000;

	let slides = $state<Slide[]>([]);
	let idleMs = $state(120_000);
	let aktif = $state(false);
	let idx = $state(0);
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let rotTimer: ReturnType<typeof setInterval> | null = null;

	const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

	function mulaiIdle() {
		if (idleTimer) clearTimeout(idleTimer);
		if (!slides.length) return;
		idleTimer = setTimeout(tampil, idleMs);
	}
	function tampil() {
		if (!slides.length) return;
		idx = 0;
		aktif = true;
		if (rotTimer) clearInterval(rotTimer);
		rotTimer = setInterval(() => (idx = (idx + 1) % slides.length), ROTASI_MS);
	}
	function tutup() {
		aktif = false;
		if (rotTimer) clearInterval(rotTimer);
		rotTimer = null;
		mulaiIdle();
	}
	function aktivitas() {
		if (aktif) tutup();
		else mulaiIdle();
	}

	onMount(() => {
		let batal = false;
		(async () => {
			try {
				const res = await fetch('/api/kiosk/standby');
				if (!res.ok) return;
				const d = await res.json();
				if (batal || !d?.enabled || !Array.isArray(d.slides) || !d.slides.length) return;
				slides = d.slides;
				idleMs = Math.max(30, Number(d.idleSeconds) || 120) * 1000;
				for (const ev of EVENTS) window.addEventListener(ev, aktivitas, { passive: true, capture: true });
				mulaiIdle();
			} catch (e) {
				console.warn('[KioskStandby] gagal memuat slideshow (dilewati):', e);
			}
		})();
		return () => {
			batal = true;
		};
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') for (const ev of EVENTS) window.removeEventListener(ev, aktivitas, { capture: true } as any);
		if (idleTimer) clearTimeout(idleTimer);
		if (rotTimer) clearInterval(rotTimer);
	});

	const s = $derived(slides[idx] ?? null);
</script>

{#if aktif && s}
	<div class="standby" role="presentation" aria-hidden="true">
		<div class="standby-card">
			{#if s.type === 'visimisi'}
				<p class="lbl">Visi &amp; Misi EPI</p>
				{#if s.visi}<p class="besar">{s.visi}</p>{/if}
				{#if s.misi?.length}
					<ol class="misi">{#each s.misi as m}<li>{m}</li>{/each}</ol>
				{/if}
			{:else if s.type === 'motto'}
				<p class="lbl">Motto Kita</p>
				<p class="motto">“{s.motto}”</p>
			{:else if s.type === 'nilai'}
				<p class="lbl">Nilai Inti</p>
				<div class="grid-nilai">
					{#each s.nilai as n}
						<div class="nilai"><span class="ikon" style="background:{n.warna || '#64748b'}">{n.ikon || '★'}</span><div><strong>{n.judul}</strong><small>{n.arti_singkat}</small></div></div>
					{/each}
				</div>
			{:else if s.type === 'milestone'}
				<p class="lbl">🎉 Momen Rekan Kita</p>
				<ul class="daftar">{#each s.items as it}<li>{it.judul}</li>{/each}</ul>
			{:else if s.type === 'peringkat'}
				<p class="lbl">🏆 Peringkat 5 Besar — Musim {s.musim}</p>
				<ol class="rank">{#each s.baris as b, i}<li><span class="no">{i + 1}</span><span class="nm">{b.nama}</span><span class="pt">{b.poin} poin</span></li>{/each}</ol>
			{:else if s.type === 'spotlight'}
				<p class="lbl">🏆 Kebanggaan Proyek</p>
				<p class="besar">{s.judul}</p>
				{#if s.foto_id}<img class="foto" alt="" use:secureAssetSrc={`/assets/${s.foto_id}?width=900`} />{/if}
				<p class="ket">{s.ringkasan}</p>
				{#if s.pemimpin_nama}<p class="kecil">PL: {s.pemimpin_nama}</p>{/if}
			{/if}
		</div>
		<p class="sentuh">Sentuh layar untuk kembali bekerja</p>
	</div>
{/if}

<style>
	.standby {
		position: fixed;
		inset: 0;
		z-index: 9999;
		background: linear-gradient(135deg, #1e1b4b, #0c4a6e);
		color: #fff;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 2rem;
		text-align: center;
	}
	.standby-card {
		max-width: 60rem;
		width: 100%;
		animation: masuk 0.6s ease;
	}
	@keyframes masuk {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: none; }
	}
	.lbl { font-size: 1.1rem; letter-spacing: 0.18em; text-transform: uppercase; opacity: 0.75; margin-bottom: 1rem; font-weight: 700; }
	.besar { font-size: clamp(1.4rem, 3.2vw, 2.4rem); font-weight: 800; line-height: 1.3; }
	.motto { font-size: clamp(1.8rem, 4.5vw, 3.4rem); font-weight: 900; line-height: 1.25; }
	.misi { text-align: left; display: inline-block; margin-top: 1.25rem; font-size: clamp(1rem, 2vw, 1.5rem); line-height: 1.6; padding-left: 1.5rem; }
	.grid-nilai { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 0.9rem; text-align: left; }
	.nilai { display: flex; gap: 0.75rem; align-items: center; background: rgba(255, 255, 255, 0.1); padding: 0.8rem 1rem; border-radius: 1rem; }
	.nilai strong { display: block; font-size: 1.15rem; }
	.nilai small { display: block; opacity: 0.8; font-size: 0.9rem; }
	.ikon { width: 2.6rem; height: 2.6rem; border-radius: 0.7rem; display: grid; place-items: center; font-size: 1.3rem; font-weight: 800; flex-shrink: 0; }
	.daftar { list-style: none; padding: 0; font-size: clamp(1.1rem, 2.4vw, 1.8rem); line-height: 1.8; font-weight: 700; }
	.rank { list-style: none; padding: 0; max-width: 34rem; margin: 0 auto; font-size: clamp(1.1rem, 2.2vw, 1.6rem); }
	.rank li { display: flex; gap: 1rem; align-items: center; background: rgba(255, 255, 255, 0.1); border-radius: 0.9rem; padding: 0.6rem 1rem; margin-bottom: 0.5rem; }
	.no { font-weight: 900; width: 2rem; }
	.nm { flex: 1; text-align: left; font-weight: 700; }
	.pt { opacity: 0.85; font-variant-numeric: tabular-nums; }
	.foto { max-height: 40vh; max-width: 100%; border-radius: 1rem; margin: 1rem auto; object-fit: cover; }
	.ket { font-size: clamp(1rem, 2vw, 1.4rem); line-height: 1.5; opacity: 0.92; }
	.kecil { opacity: 0.7; margin-top: 0.5rem; }
	.sentuh { position: absolute; bottom: 1.5rem; opacity: 0.55; font-size: 0.95rem; letter-spacing: 0.05em; }
</style>
