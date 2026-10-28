import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';

describe('Project-EPI Grand PO Dossier Snapshot Relay API', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('mengembalikan 400 jika grandPoId dan projectId tidak disertakan', async () => {
		const request = new Request('http://localhost:5173/api/automation/grand-po-dossier-snapshot', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({})
		});

		await expect(POST({ request } as any)).rejects.toMatchObject({
			status: 400
		});
	});

	it('berhasil melakukan relay ke ERP Admin dan mengembalikan response', async () => {
		const mockResponse = {
			success: true,
			sentCount: 1,
			message: 'Snapshot terkirim'
		};

		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				status: 200,
				json: vi.fn().mockResolvedValue(mockResponse)
			})
		);

		const request = new Request('http://localhost:5173/api/automation/grand-po-dossier-snapshot', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				projectId: 978,
				stakeholder: 'operasional'
			})
		});

		const res = await POST({ request } as any);
		const data = await res.json();

		expect(res.status).toBe(200);
		expect(data.success).toBe(true);
		expect(data.sentCount).toBe(1);
	});

	it('menangani kegagalan jaringan ke ERP Admin secara fail-soft dengan status 502', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockRejectedValue(new Error('Connection refused'))
		);

		const request = new Request('http://localhost:5173/api/automation/grand-po-dossier-snapshot', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grandPoId: 'p978'
			})
		});

		const res = await POST({ request } as any);
		const data = await res.json();

		expect(res.status).toBe(502);
		expect(data.success).toBe(false);
		expect(data.message).toContain('Gagal menghubungi server ERP Admin');
	});
});
