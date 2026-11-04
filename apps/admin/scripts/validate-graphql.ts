// Validates every admin GraphQL operation against the server's schema.
// Run: pnpm --filter @shopme/admin validate:graphql   (exit code 1 when any operation is invalid)
import { parse, validate } from 'graphql';
import { operations } from '../src/graphql';
import { schema } from '../../server/src/admin/graphql/schema';

let failed = 0;
for (const [name, source] of Object.entries(operations)) {
  try {
    const errors = validate(schema, parse(source));
    if (errors.length) throw new Error(errors.map((e) => e.message).join('\n    '));
    console.log(`ok    ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}
console.log(`\n${Object.keys(operations).length - failed}/${Object.keys(operations).length} operations valid`);
process.exit(failed ? 1 : 0);
