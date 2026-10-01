import axios from 'axios';
import { fetchPricingPlan, pricingRowsToByHour } from '../pricingSource';

jest.mock('axios');

const URL = 'http://pricing.test/cod_pricing_test';
const row = (o = {}) => ({ date: '2026-09-25', hour: 7, gametype: 'BA', table: '10001', table_minimum: '500', revised_date: '2026-09-20', ...o });

afterEach(() => jest.resetAllMocks());

describe('fetchPricingPlan', () => {
    it('reports a failing endpoint instead of returning an empty plan', async () => {
        axios.mockRejectedValue(Object.assign(new Error('Request failed with status code 500'), {
            response: { status: 500, data: 'Error fetching data' },
        }));
        await expect(fetchPricingPlan({ date: '2026-09-25', url: URL }))
            .rejects.toThrow(/HTTP 500 — Error fetching data/);
    });

    it('reports a network failure (wrong port / CORS)', async () => {
        axios.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
        await expect(fetchPricingPlan({ date: '2026-09-25', url: URL })).rejects.toThrow(/ERR_NETWORK/);
    });

    it('sends a plain GET with the date and keeps only that date', async () => {
        axios.mockResolvedValue({ status: 200, data: [row(), row({ date: '2026-09-24' })] });
        const rows = await fetchPricingPlan({ date: '2026-09-25', url: URL });
        expect(axios).toHaveBeenCalledWith({ url: `${URL}?date=2026-09-25`, method: 'get', timeout: 60000 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ date: '2026-09-25', hour: 7, table: '10001', table_minimum: 500 });
    });

    it('lists the dates the database does have when the asked date is missing', async () => {
        axios.mockResolvedValue({ status: 200, data: [row({ date: '2026-09-20' }), row({ date: '2026-09-22' })] });
        const rows = await fetchPricingPlan({ date: '2026-09-25', url: URL });
        expect(rows).toHaveLength(0);
        expect(rows.availableDates).toEqual(['2026-09-20', '2026-09-22']);
    });

    it('rejects a non-array body', async () => {
        axios.mockResolvedValue({ status: 200, data: '<html>login</html>' });
        await expect(fetchPricingPlan({ date: '2026-09-25', url: URL })).rejects.toThrow(/expected a JSON array/);
    });
});

describe('pricingRowsToByHour', () => {
    it('snaps minimums to tiers and skips unpriced rows', () => {
        const tiers = [{ id: 't300', min: 300 }, { id: 't500', min: 500 }];
        const rows = [row({ table_minimum: 500 }), row({ hour: 8, table_minimum: null })];
        const { byHour } = pricingRowsToByHour(rows, '2026-09-25', tiers);
        expect(byHour).toEqual({ h_7: { assignments: { 'BA|10001': 't500' } } });
    });
});
