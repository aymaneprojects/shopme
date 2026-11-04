import { describe, expect, it } from 'vitest';
import { paginateArray } from './admin/graphql/types/connection';

const all = Array.from({ length: 10 }, (_, i) => i);

describe('paginate', () => {
  it('forward pagination with cursors', async () => {
    const p1 = await paginateArray({ first: 4 }, all);
    expect(p1.nodes).toEqual([0, 1, 2, 3]);
    expect(p1.pageInfo).toMatchObject({ hasNextPage: true, hasPreviousPage: false });
    const p2 = await paginateArray({ first: 4, after: p1.pageInfo.endCursor }, all);
    expect(p2.nodes).toEqual([4, 5, 6, 7]);
    expect(p2.pageInfo.hasPreviousPage).toBe(true);
    const p3 = await paginateArray({ first: 4, after: p2.pageInfo.endCursor }, all);
    expect(p3.nodes).toEqual([8, 9]);
    expect(p3.pageInfo.hasNextPage).toBe(false);
  });
  it('backward pagination', async () => {
    const last = await paginateArray({ last: 3 }, all);
    expect(last.nodes).toEqual([7, 8, 9]);
    expect(last.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
    const prev = await paginateArray({ last: 3, before: last.pageInfo.startCursor }, all);
    expect(prev.nodes).toEqual([4, 5, 6]);
    expect(prev.pageInfo.hasNextPage).toBe(true);
    expect(prev.edges.map((e) => e.node)).toEqual(prev.nodes);
  });
  it('validates arguments', async () => {
    await expect(paginateArray({}, all)).rejects.toThrow(/first or last/);
    await expect(paginateArray({ first: 500 }, all)).rejects.toThrow(/between/);
    await expect(paginateArray({ first: 1, after: 'bogus' }, all)).rejects.toThrow(/cursor/i);
    expect((await paginateArray({ first: 0 }, all)).nodes).toEqual([]);
  });
});
