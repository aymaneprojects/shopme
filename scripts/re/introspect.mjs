// Usage: node introspect.mjs query            -> prints the introspection query
//        node introspect.mjs sdl <in.json> <out.graphql>  -> converts a response to SDL
import { getIntrospectionQuery, buildClientSchema, printSchema } from 'graphql';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , mode, input, output] = process.argv;
if (mode === 'query') {
  process.stdout.write(getIntrospectionQuery({ descriptions: true, inputValueDeprecation: true }));
} else if (mode === 'sdl' && input && output) {
  const json = JSON.parse(readFileSync(input, 'utf8'));
  if (json.errors) {
    console.error(JSON.stringify(json.errors).slice(0, 800));
    process.exit(1);
  }
  writeFileSync(output, printSchema(buildClientSchema(json.data)));
} else {
  console.error('usage: introspect.mjs query | sdl <in.json> <out.graphql>');
  process.exit(2);
}
