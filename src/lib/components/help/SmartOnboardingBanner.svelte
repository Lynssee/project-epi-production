<!-- src/lib/components/help/SmartOnboardingBanner.svelte -->
<!-- §7B #5 (implementation_plan_panduan + video generator.md): "Smart
     onboarding" — user baru (jabatannya punya modul tutorial WAJIB tapi
     belum menyelesaikan satupun) auto-diarahkan ke /bantuan lewat banner,
     alih-alih harus menemukan sendiri. Memanfaatkan tutorial_role_map +
     tutorial_progress yang sudah ada (§Fase 1/2 implementation_plan_tutorial
     aplikasi per role.md) — TIDAK ada koleksi/field baru.
     Ditutup = tersimpan di localStorage per akun, tidak muncul lagi sesi
     berikutnya (bukan modal yang memblokir, sengaja tidak memaksa). -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth';
  import { fetchTutorialForMe } from '$lib/services/tutorialApi';

  let show = $state(false);
  let jumlahWajib = $state(0);

  function dismissKey(email: string) {
    return `epi_onboarding_dismissed_${email}`;
  }

  function dismiss() {
    show = false;
    const email = $authStore.user?.email;
    if (browser && email) localStorage.setItem(dismissKey(email), '1');
  }

  function mulai() {
    dismiss();
    goto('/bantuan');
  }

  async function cek() {
    const email = $authStore.user?.email;
    if (!browser || !email) return;
    if (localStorage.getItem(dismissKey(email))) return;

    const res = await fetchTutorialForMe();
    if (!res.success || !res.data) return;
    const { roleMap, progress } = res.data;
    const wajib = roleMap.filter((r) => r.wajib);
    if (wajib.length === 0) return;

    const selesaiSlugs = new Set(
      progress.filter((p) => p.jenis === 'tour' && p.status === 'selesai').map((p) => p.tutorial_ref)
    );
    const belumSelesai = wajib.filter((r) => !selesaiSlugs.has(r.modul_slug));
    // Sinyal "user baru": SEMUA modul wajib belum disentuh sama sekali —
    // kalau sudah ada satu saja yang selesai, dia bukan pemula lagi.
    if (belumSelesai.length === wajib.length) {
      jumlahWajib = wajib.length;
      show = true;
    }
  }

  onMount(cek);
</script>

{#if show}
  <div class="mx-3 mt-3 sm:mx-4 sm:mt-4 bg-gradient-to-r from-indigo-600 to-blue-600 rounded-2xl p-4 shadow-lg text-white flex items-center gap-3">
    <span class="text-2xl shrink-0">👋</span>
    <div class="flex-1 min-w-0">
      <p class="text-sm font-bold">Selamat datang!</p>
      <p class="text-xs text-indigo-100 mt-0.5">Ada {jumlahWajib} tutorial wajib untuk jabatan Anda — mulai dari sini biar cepat familiar dengan aplikasi.</p>
    </div>
    <div class="flex flex-col gap-1.5 shrink-0">
      <button onclick={mulai} class="px-3 py-1.5 rounded-lg bg-white text-indigo-700 text-xs font-bold whitespace-nowrap">Mulai Sekarang</button>
      <button onclick={dismiss} class="px-3 py-1 rounded-lg text-indigo-100 text-[11px] hover:bg-white/10">Nanti saja</button>
    </div>
  </div>
{/if}
