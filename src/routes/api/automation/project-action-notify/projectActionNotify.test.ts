import { describe, it, expect, vi, beforeEach } from 'vitest';

let envMock: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({
	get env() {
		return envMock;
	}
}));

import { POST } from './+server';

const req = (body: any) => ({ request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) }) as any;
const BODY = { eventType: 'issue', actionItem: { id: 1 }, projectId: 7, actor: { nama: 'PL' } };

beforeEach(() => {
	vi.restoreAllMocks();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('POST project-action-notify (relay)', () => {
	it('tanpa AUTOMATION_SERVER_SECRET -> dilewati, TIDAK memanggil erp-epi (tanpa secret bawaan di kode)', async () => {
		envMock = {};
		const f = vi.spyOn(globalThis, 'fetch');
		const body = await (await POST(req(BODY))).json();
		expect(body.sent).toBe(false);
		expect(f).not.toHaveBeenCalled();
	});
	it('dengan secret dari env -> relay memakai secret itu', async () => {
		envMock = { AUTOMATION_SERVER_SECRET: 'env-secret', ERP_EPI1_BASE_URL: 'https://erp.test/' };
		const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		const body = await (await POST(req(BODY))).json();
		expect(body.sent).toBe(true);
		const [url, init] = f.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://erp.test/api/automation/project-action-notify');
		expect(JSON.parse(String(init.body)).secret).toBe('env-secret');
	});
	it('eventType/actionItem kosong -> 400', async () => {
		envMock = { AUTOMATION_SERVER_SECRET: 's' };
		expect((await POST(req({}))).status).toBe(400);
	});
});
