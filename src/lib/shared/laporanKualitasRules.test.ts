import { describe, it, expect } from 'vitest';
import { parseDisiplin, hariMundur, evaluasiMundur, evaluasiVolumeWajar, evaluasiPolaDatar, evaluasiFotoHarian, DEFAULT_DISIPLIN } from './laporanKualitasRules';

describe('parseDisiplin', () => {
  it('default bila kosong/rusak; menerima string JSON; menjaga wajib_alasan_hari >= bebas_hari', () => {
    expect(parseDisiplin(null)).toEqual(DEFAULT_DISIPLIN);
    expect(parseDisiplin('{"bebas_hari":1,"wajib_alasan_hari":5}')).toMatchObject({ bebas_hari: 1, wajib_alasan_hari: 5 });
    expect(parseDisiplin({ bebas_hari: 6, wajib_alasan_hari: 3 }).wajib_alasan_hari).toBe(6);
    expect(parseDisiplin({ bebas_hari: -1 }).bebas_hari).toBe(2);
  });
});

describe('K1 lapor mundur', () => {
  const today = '2026-10-20';
  it('hariMundur', () => {
    expect(hariMundur('2026-10-19T00:00:00', today)).toBe(1);
    expect(hariMundur('2026-10-21', today)).toBe(-1);
    expect(hariMundur('x', today)).toBeNull();
  });
  it('H-1 dan H-2 bebas', () => {
    expect(evaluasiMundur({ date: '2026-10-19', today })).toBeNull();
    expect(evaluasiMundur({ date: '2026-10-18', today })).toBeNull();
  });
  it('H-3..H-7 wajib alasan', () => {
    expect(evaluasiMundur({ date: '2026-10-17', today })).toMatchObject({ level: 'alasan', hari: 3 });
    expect(evaluasiMundur({ date: '2026-10-17', today, alasan: 'Sinyal hilang di site 2 hari' })).toBeNull();
    expect(evaluasiMundur({ date: '2026-10-17', today, alasan: 'sinyal' })).not.toBeNull(); // terlalu pendek
  });
  it('> H-7 hanya admin dengan kategori + alasan', () => {
    expect(evaluasiMundur({ date: '2026-10-05', today, alasan: 'Lupa input kemarin lusa' })).toMatchObject({ level: 'admin' });
    expect(evaluasiMundur({ date: '2026-10-05', today, alasan: 'Lupa input kemarin lusa', isAdmin: true })).not.toBeNull(); // kategori kosong
    expect(evaluasiMundur({ date: '2026-10-05', today, alasan: 'Lupa input kemarin lusa', isAdmin: true, kategoriAdmin: 'lupa_input' })).toBeNull();
  });
  it('ambang dari setelan', () => {
    const cfg = { ...DEFAULT_DISIPLIN, bebas_hari: 0, wajib_alasan_hari: 1 };
    expect(evaluasiMundur({ date: '2026-10-19', today, cfg })).toMatchObject({ level: 'alasan' });
  });
});

describe('volume wajar', () => {
  const tl = { categories: [{ subtasks: [{ id: 's1', name: 'Primer', volume: 100, daily_actual: { '2026-10-10': 30, '2026-10-11': 40, '2026-10-15': 5 } }] }] };
  it('nilai harian <= sisa -> wajar', () => {
    expect(evaluasiVolumeWajar([{ subtask_id: 's1', progress_value: 25 }], tl, '2026-10-20')).toEqual([]);
  });
  it('kumulatif diisi sebagai harian (304 vs sisa) -> ditandai', () => {
    const r = evaluasiVolumeWajar([{ subtask_id: 's1', activity: 'Primer', progress_value: 304 }], tl, '2026-10-20');
    expect(r).toEqual([expect.objectContaining({ subtask_id: 's1', nilai: 304, sisa: 25 })]);
  });
  it('realisasi tanggal laporan sendiri tidak dihitung dobel (edit ulang)', () => {
    expect(evaluasiVolumeWajar([{ subtask_id: 's1', progress_value: 30 }], tl, '2026-10-10')).toEqual([]); // sisa = 100-45 = 55
  });
  it('subtask tak dikenal / volume 0 diabaikan; membaca stages.pekerjaan & value', () => {
    expect(evaluasiVolumeWajar([{ subtask_id: 'zzz', progress_value: 999 }], tl, '2026-10-20')).toEqual([]);
    expect(evaluasiVolumeWajar([{ subtask_id: 's1', stages: { pekerjaan: 500 } }], tl, '2026-10-20')).toHaveLength(1);
    expect(evaluasiVolumeWajar([{ subtask_id: 's1', value: 500 }], tl, '2026-10-20')).toHaveLength(1);
  });
});

describe('pola datar', () => {
  const rep = (v: number) => ({ progress: [{ subtask_id: 's1', progress_value: v }] });
  it('>= 5 laporan berturut-turut identik -> ditandai', () => {
    const r = evaluasiPolaDatar([{ subtask_id: 's1', progress_value: 29 }], [rep(29), rep(29), rep(29), rep(29)]);
    expect(r).toEqual([{ subtask_id: 's1', nilai: 29, run: 5 }]);
  });
  it('putus di tengah / kurang dari 5 -> tidak', () => {
    expect(evaluasiPolaDatar([{ subtask_id: 's1', progress_value: 29 }], [rep(29), rep(30), rep(29), rep(29)])).toEqual([]);
    expect(evaluasiPolaDatar([{ subtask_id: 's1', progress_value: 29 }], [rep(29), rep(29)])).toEqual([]);
  });
  it('ambang dari setelan', () => {
    expect(evaluasiPolaDatar([{ subtask_id: 's1', progress_value: 29 }], [rep(29)], 2)).toHaveLength(1);
  });
});

describe('foto harian', () => {
  it('laporan baru tanpa foto sama sekali -> ditandai (walau kolom tidak dikirim)', () => {
    expect(evaluasiFotoHarian({ project_id: 1 }, { isCreate: true })).not.toBeNull();
    expect(evaluasiFotoHarian({ attendance_photos: ['a'] }, { isCreate: true })).toBeNull();
    expect(evaluasiFotoHarian({ progress_photos: '["x"]' }, { isCreate: true })).toBeNull();
  });
  it('PATCH status tanpa kolom foto tidak dinilai; PATCH yang mengosongkan foto dinilai', () => {
    expect(evaluasiFotoHarian({ status: 'approved' })).toBeNull();
    expect(evaluasiFotoHarian({ progress_photos: [] })).not.toBeNull();
  });
});
