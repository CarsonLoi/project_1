import { fetchTables, fetchShoe, fetchPatrons } from '../rtDataSource';
import { groupShoeRows } from '../shoeData';

test('mock shoe matches its table row (hand # and shoe win)', async () => {
    const { rows: tables } = await fetchTables();
    const t = tables.find((r) => r.is_open && (r.gametype === 'BA' || r.gametype === 'NC'));
    expect(t).toBeDefined();
    const { rows } = await fetchShoe({ gametype: t.gametype, table: t.table });
    const shoe = groupShoeRows(rows);
    expect(shoe.hands.length).toBe(t.shoe_hands_dealt);
    expect(Math.round(shoe.hands.reduce((a, h) => a + h.casinoNet, 0))).toBe(Math.round(t.shoe_win));
});

test('mock patrons: never two patrons in one seat of a table', async () => {
    const { rows } = await fetchPatrons();
    const seen = new Set();
    for (const p of rows) {
        if (!p.current_table_key || !p.current_seat) continue;
        const k = `${p.current_table_key}#${p.current_seat}`;
        expect(seen.has(k)).toBe(false);
        seen.add(k);
    }
    expect(seen.size).toBeGreaterThan(0);
});
