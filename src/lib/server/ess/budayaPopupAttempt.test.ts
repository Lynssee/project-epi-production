import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let responder: any;
vi.mock('$lib/server/ess/polaKerjaResolver', () => ({ resolveKaryawanPolaKerja: vi.fn(async () => 'project') }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn(async (path: string, opts: any) => responder(path, opts)) }));

const karyawan = { id: 77, divisi: 'HRD', posisi: 'Staff' };
const base = { id: 1, judul: 'SOP', isi_pesan: 'x', tipe: 'reminder_sop', aktif: true, target_audiens: 'semua', pertanyaan_kuis: 'Q?', opsi_kuis: ['a', 'b', 'c'], jawaban_benar_idx: 0 };
const f6 = { id: 1, display_mode: 'popup', trigger_moments: ['clock_in'], kuis_reviewed: true, microquiz_aktif: true };
const setup = () => {
  responder = (path: string) => {
    if (path.includes('/items/app_settings')) return { data: [{ setting_key: 'culture.popup_enabled', setting_value: 'true' }, { setting_key: 'culture.microquiz_enabled', setting_value: 'true' }] };
    if (path.includes('culture_propaganda_ack') && path.includes('aggregate')) return { data: [{ count: 0 }] };
    if (path.includes('culture_propaganda_ack')) return { data: [] };
    if (path.includes('trigger_moments')) return { data: [f6] };
    if (path.includes('/items/culture_propaganda?')) return { data: [base] };
    return { data: [] };
  };
};
const OLD = process.env.MICROQUIZ_ATTEMPT_SECRET;
beforeEach(() => { process.env.MICROQUIZ_ATTEMPT_SECRET = 'rahasia-tes'; vi.resetModules(); setup(); });
afterEach(() => { if (OLD === undefined) delete process.env.MICROQUIZ_ATTEMPT_SECRET; else process.env.MICROQUIZ_ATTEMPT_SECRET = OLD; });

describe('token percobaan microquiz', () => {
  it('tanda tangan: sah hanya untuk karyawan/konten/hari yang sama; dirusak → 0; tanpa secret → null', async () => {
    const { signAttempt, readAttempt } = await import('./budayaPopup');
    const t = signAttempt(77, 1, '2026-11-19', 1);
    expect(readAttempt(t, 77, 1, '2026-11-19')).toBe(1);
    expect(readAttempt(t, 78, 1, '2026-11-19')).toBe(0);
    expect(readAttempt(t, 77, 2, '2026-11-19')).toBe(0);
    expect(readAttempt(t, 77, 1, '2026-11-20')).toBe(0);
    expect(readAttempt(t.replace(/.$/, 'x'), 77, 1, '2026-11-19')).toBe(0);
    expect(readAttempt('sampah', 77, 1, '2026-11-19')).toBe(0);
    expect(readAttempt(null, 77, 1, '2026-11-19')).toBe(0);
    delete process.env.MICROQUIZ_ATTEMPT_SECRET;
    delete process.env.AUTOMATION_SERVER_SECRET;
    delete process.env.TRAINING_CERT_VERIFY_SECRET;
    expect(signAttempt(77, 1, 'x', 1)).toBeNull();
  });

  it('salah pertama → token; instance BARU (memori kosong) + token → salah kedua langsung final', async () => {
    let m = await import('./budayaPopup');
    const r1 = await m.submitMicroquizAnswer(karyawan, { propagandaId: 1, jawabanIdx: 2 });
    expect(r1).toMatchObject({ boleh_ulang: true, kunci_idx: null });
    expect(typeof r1.token).toBe('string');
    vi.resetModules(); // instance lain: memori percobaan kosong
    setup();
    m = await import('./budayaPopup');
    const r2 = await m.submitMicroquizAnswer(karyawan, { propagandaId: 1, jawabanIdx: 1, token: r1.token });
    expect(r2).toMatchObject({ boleh_ulang: false, status_aksi: 'kuis_salah', kunci_idx: 0, token: null });
  });

  it('token milik karyawan lain diabaikan (dianggap percobaan pertama)', async () => {
    const m = await import('./budayaPopup');
    const t = m.signAttempt(999, 1, new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' }), 1);
    const r = await m.submitMicroquizAnswer(karyawan, { propagandaId: 1, jawabanIdx: 2, token: t });
    expect(r.boleh_ulang).toBe(true);
  });
});
