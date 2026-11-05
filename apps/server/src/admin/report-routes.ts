import type { FastifyInstance } from 'fastify';
import { GROUP_BYS, REPORT_NAMES, reportCsv, shopmeReport, type GroupBy, type ReportName } from '@shopme/core';
import { authenticate } from '../plugins/auth';

/** `GET /admin/api/reports/<NAME>.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&groupBy=DAY|WEEK|MONTH` (scope `read_reports`): CSV export of one report. */
export function registerReportRoutes(app: FastifyInstance) {
  app.get('/admin/api/reports/:file', async (req, reply) => {
    const m = /^([A-Z_]+)\.csv$/.exec((req.params as { file: string }).file);
    const name = m?.[1] as ReportName | undefined;
    if (!name || !REPORT_NAMES.includes(name)) return reply.code(404).send({ error: `Unknown report (${REPORT_NAMES.join(', ')})` });
    const auth = await authenticate(req);
    if (!auth) return reply.code(401).send({ error: 'Not authenticated' });
    if (!auth.scopes.includes('*') && !auth.scopes.includes('read_reports') && !auth.scopes.includes('write_reports')) return reply.code(403).send({ error: 'Access denied. Required access: read_reports' });
    const q = req.query as { from?: string; to?: string; groupBy?: string };
    const groupBy = (GROUP_BYS as readonly string[]).includes(q.groupBy ?? '') ? (q.groupBy as GroupBy) : 'DAY';
    const report = await shopmeReport(app.ctx.db, auth.shopId, name, q.from ?? '', q.to ?? '', groupBy);
    if (!report) return reply.code(422).send({ error: 'from and to must be YYYY-MM-DD dates with from <= to' });
    return reply.type('text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name.toLowerCase()}-${report.from}-${report.to}.csv"`).send(reportCsv(report));
  });
}
