// Paket 08a Site Visit Release — POST /api/site-checkin menolak tipe_keperluan=marketing.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockCreate = vi.fn();
vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('$lib/server/siteCheckin', () => ({
	createCheckin: (...a: unknown[]) => mockCreate(...a),
	AkurasiGpsError: class AkurasiGpsError extends Error {}
}));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));

const { POST } = await import('./+server');

function fakeEvent(fields: Record<string, string | File>) {
	return {
		request: {
			formData: () => Promise.resolve((() => {
				const fd = new FormData();
				for (const [k, v] of Object.entries(fields)) fd.append(k, v as any);
				return fd;
			})()),
			headers: new Headers()
		}
	} as any;
}

beforeEach(() => {
	mockAuth.mockReset();
	mockCreate.mockReset();
	mockAuth.mockResolvedValue({ karyawan: { id: 10, nama_karyawan: 'Budi' } });
});

describe('POST /api/site-checkin — §08a tolak tipe marketing', () => {
	it('tipe_keperluan=marketing -> 422, tidak memanggil createCheckin', async () => {
		const foto = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
		let caught: any = null;
		try {
			await POST(
				fakeEvent({
					referensi_id: '5',
					lat: '-6.2',
					lng: '106.8',
					tipe_keperluan: 'marketing',
					foto
				})
			);
		} catch (e) {
			caught = e;
		}
		expect(caught?.status).toBe(422);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('tipe_keperluan=proyek tetap jalan seperti biasa', async () => {
		mockCreate.mockResolvedValue({ id: 'chk-1' });
		const foto = new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' });
		const res = await POST(
			fakeEvent({
				referensi_id: '5',
				lat: '-6.2',
				lng: '106.8',
				foto
			})
		);
		const json = await res.json();
		expect(json.record.id).toBe('chk-1');
		expect(mockCreate).toHaveBeenCalled();
	});
});
