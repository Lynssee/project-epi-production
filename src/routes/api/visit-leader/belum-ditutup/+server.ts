// GET /api/visit-leader/belum-ditutup — PDP-33: visit terbuka milik leader yang login + setelan (batas jam, min foto).
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { daftarVisitBelumDitutup } from '$lib/server/visitLeaderTutup';

export const GET: RequestHandler = async (event) => json(await daftarVisitBelumDitutup(event));
