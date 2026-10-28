import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { checkTokenAccess, onBehalfVersion } from './pengajuanKonfirmasi';

const token = 'tok-abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const hash = createHash('sha256').update(token).digest('hex');
const future = new Date(Date.now() + 3600_000).toISOString();
const base = { storedHash: hash, expiresAt: future, givenToken: token, pemohonNoHp: '0812-3456-7890', tail: '7890' };

describe('checkTokenAccess (mirror erp-epi)', () => {
	it('lolos', () => expect(checkTokenAccess(base).ok).toBe(true));
	it('token salah 403', () => expect((checkTokenAccess({ ...base, givenToken: 'x' }) as any).httpStatus).toBe(403));
	it('kedaluwarsa 410', () => expect((checkTokenAccess({ ...base, expiresAt: new Date(Date.now() - 1000).toISOString() }) as any).httpStatus).toBe(410));
	it('4 digit salah / HP kosong ditolak', () => {
		expect(checkTokenAccess({ ...base, tail: '0000' }).ok).toBe(false);
		expect(checkTokenAccess({ ...base, pemohonNoHp: null }).ok).toBe(false);
	});
});

describe('onBehalfVersion (paritas dgn erp-epi: nilai tetap)', () => {
	const rec = { tujuan_pengajuan: 'BBM site', project_id: 12, penerima_dana_nama: 'Irfan', bank_name: 'BCA', bank_account_number: '123', bank_account_name: 'Irfan' };
	const items = [{ id: 2, deskripsi: 'Solar', quantity: 10, harga: 12500 }, { id: 1, nama_barang: 'Oli', quantity: 2, harga: 80000.5 }];
	it('nilai tetap sama dgn paOnBehalf.test.js di erp-epi', () => expect(onBehalfVersion(rec, items)).toBe('4lgjkjp91f'));
	it('urutan item & project_id objek tidak berpengaruh', () => expect(onBehalfVersion({ ...rec, project_id: { id: 12 } }, [...items].reverse())).toBe('4lgjkjp91f'));
	it('berubah bila nominal berubah', () => expect(onBehalfVersion(rec, [{ ...items[0], harga: 12600 }, items[1]])).not.toBe('4lgjkjp91f'));
});
