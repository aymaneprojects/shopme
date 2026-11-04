import { builder } from '../builder';
import { Node, loadNode } from '../types/node';
import '../types/scalars';
import '../types/money';
import '../types/connection';
import '../types/errors';

builder.queryFields((t) => ({
  node: t.field({
    type: Node, nullable: true, args: { id: t.arg.id({ required: true }) },
    resolve: (_r, { id }, ctx) => loadNode(ctx, String(id)),
  }),
  nodes: t.field({
    type: [Node], nullable: { list: false, items: true }, args: { ids: t.arg.idList({ required: true }) },
    resolve: (_r, { ids }, ctx) => Promise.all(ids.map((id) => loadNode(ctx, String(id)))),
  }),
}));
