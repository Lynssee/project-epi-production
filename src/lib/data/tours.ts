// src/lib/data/tours.ts
// Definisi langkah guided tour (wizard) per modul — port dari erp-epi-1
// (src/lib/data/tours.js), disesuaikan skema panduan.ts project-epi.
// Konten diturunkan otomatis dari panduan.ts agar konsisten, ditambah kartu
// intro/outro dan satu langkah yang menyorot menu modul di nav.
// Fase 2, implementation_plan_tutorial aplikasi per role.md.
//
// Bentuk step:
//   { target?, title, body, placement?, href? }
// - target kosong  -> kartu modal di tengah (intro/penjelasan langkah)
// - target ada     -> spotlight elemen + tooltip (mis. item nav)
// - href ada       -> tombol "Buka halaman" ditampilkan di kartu
//
// Fase 5, Rencana v2 Panduan Auto-Sync erp-epi-1 (docs/(eh) implementation_
// plan_standarisasi_panduan_visual_dan_rekomendasi_dashboard.md — menutup
// celah K3): diperiksa saat mengerjakan Fase 5, dan file ini TIDAK punya
// celah yang sama dengan tours.js erp-epi-1. Setiap langkah di sini SELALU
// memakai `modul.href` (tidak ada peta href-per-langkah berbasis index),
// jadi tidak ada risiko index diam-diam menunjuk langkah yang salah saat
// urutan langkah diedit. `panduan_steps.step_key` tetap di-backfill &
// dipertahankan di Directus (lihat panduan.ts PanduanLangkah.step_key) untuk
// PARITAS dan jaga-jaga andai suatu saat modul di sini butuh deep-link
// per-langkah seperti tours.js — kalau ditambahkan nanti, kuncinya harus
// step_key, bukan index posisi.

import { modulDokumentasi, getModulById, type ModulPanduan } from '$lib/data/panduan';

export interface TourStep {
  target?: string | null;
  title: string;
  body: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  href?: string;
}

export interface Tour {
  id: string;
  label: string;
  route: string;
  steps: TourStep[];
}

/** Ringkas isi panduan agar muat di kartu tour (buang baris kosong berlebih). */
function ringkas(isi: string, maxLen = 420): string {
  if (!isi) return '';
  let teks = String(isi).replace(/\n{3,}/g, '\n\n').trim();
  if (teks.length > maxLen) {
    teks = teks.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  }
  return teks;
}

/** Slug modul untuk anchor nav, diturunkan dari href (mis. /laporan -> laporan). */
function slugFromHref(href: string): string {
  return (href || '').split('/').filter(Boolean)[0] || '';
}

function buildSteps(modul: ModulPanduan): TourStep[] {
  const slug = slugFromHref(modul.href);
  const steps: TourStep[] = [];

  // 1. Intro (kartu tengah)
  steps.push({
    target: null,
    title: `Selamat datang di ${modul.nama}`,
    body: modul.deskripsi || `Tur singkat untuk mengenal fitur utama ${modul.nama}.`,
    href: modul.href,
  });

  // 2. Sorot menu modul di nav (bila ada anchornya)
  if (slug) {
    steps.push({
      target: `[data-tour="nav-${slug}"]`,
      title: `Menu ${modul.nama}`,
      body: `Akses ${modul.nama} dari menu ini.`,
      placement: 'bottom',
      href: modul.href,
    });
  }

  // 3. Satu kartu per langkah panduan
  const langkahArr = modul.langkah || [];
  for (const lang of langkahArr) {
    let body = ringkas(lang.isi);
    if (lang.tips) body += `\n\n💡 Tips: ${lang.tips}`;
    steps.push({
      target: null,
      title: lang.judul || 'Langkah',
      body,
      href: modul.href,
    });
  }

  // 4. Outro
  steps.push({
    target: null,
    title: 'Tur selesai 🎉',
    body: `Anda siap menggunakan ${modul.nama}. Buka halaman Bantuan kapan saja untuk melihat panduan lengkap atau memutar ulang tur ini.`,
    href: `/bantuan?modul=${modul.id || slug}`,
  });

  return steps;
}

/** Daftar modul yang punya tour, untuk halaman Bantuan/pengaturan. */
export const tourableModules = modulDokumentasi.map((m) => ({
  id: slugFromHref(m.href) || m.id,
  label: m.nama,
  route: m.href,
}));

/**
 * Ambil definisi tour sebuah modul berdasarkan slug rute (mis. 'laporan')
 * atau id panduan.ts.
 */
export function getTour(moduleId: string): Tour | null {
  if (!moduleId) return null;
  const modul =
    modulDokumentasi.find((m) => slugFromHref(m.href) === moduleId) ||
    getModulById(moduleId);
  if (!modul) return null;
  return {
    id: moduleId,
    label: modul.nama,
    route: modul.href,
    steps: buildSteps(modul),
  };
}
