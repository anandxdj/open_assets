#!/usr/bin/env node
// Generates every AniBuddy RigDocument v5 language binding from the one
// canonical JSON Schema, so the Python geometry service, the Node gateway and
// the browser editor cannot drift apart.
//
//   node scripts/anibuddy/generate-bindings.mjs            # write
//   node scripts/anibuddy/generate-bindings.mjs --check     # CI drift gate
//
// Zero dependencies on purpose. The three workspaces have three different
// dependency stories and no shared install step, so a generator that needs
// `pnpm install` first is a generator CI cannot run cheaply.
//
// SUPPORTED JSON SCHEMA SUBSET
// The canonical schema is authored against exactly this subset; anything else
// throws rather than emitting something plausible and wrong.
//   - `$ref` to `#/$defs/<Name>` only
//   - `type: "object"` with `properties`/`required`/`additionalProperties:false`
//   - record objects: `type: "object"` + `propertyNames.pattern` +
//     `additionalProperties: <schema>`
//   - `type: "array"` with `items`, `minItems`, `maxItems`
//   - `type: "string"` with `enum` | `const` | `pattern` | `format` |
//     `minLength` | `maxLength`
//   - `type: "integer"` / `"number"` with `const` | `minimum` | `maximum`
//   - `type: "boolean"`
//   - nullability as `type: ["<t>", "null"]`, or as
//     `oneOf: [<schema>, {type:"null"}]`
//   - tagged unions as `oneOf: [...]` plus `x-discriminator: "<field>"`
//
// TWO EXTENSION KEYWORDS
//   - `x-limit`: `{ "<constraintName>": "<CONSTANT_NAME>" }` lifts a constraint
//     value into the emitted LIMITS object, so a cap is authored once as a real
//     JSON Schema constraint and still reaches every language as a named
//     constant (Rule 9).
//   - `x-constants`: root-level invariants that are not expressible as a
//     per-field constraint (tree depth caps, epsilons, the credit ceiling).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SCHEMA_PATH = join(REPO_ROOT, 'schemas', 'anibuddy', 'rig-document.v5.schema.json');
const SCHEMA_REL = 'schemas/anibuddy/rig-document.v5.schema.json';
const COMMAND = 'pnpm --dir backend schema:anibuddy';

const OUTPUTS = {
  frontendTypes: join(REPO_ROOT, 'frontend', 'src', 'features', 'anibuddy', 'rig', 'rig-document.generated.ts'),
  backendZod: join(REPO_ROOT, 'backend', 'src', 'modules', 'anibuddy', 'dto', 'rig-document.generated.ts'),
  backendMongoose: join(REPO_ROOT, 'backend', 'src', 'modules', 'anibuddy', 'anibuddy.rig-document.generated.model.ts'),
  pythonPydantic: join(REPO_ROOT, 'py_backend', 'app', 'modules', 'anibuddy', 'schemas.py'),
};

const PY_RESERVED = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break',
  'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield',
]);

// ── Schema reading ──────────────────────────────────────────────────────────

/** Normalize any schema node into one tagged shape the emitters switch on. */
function classify(node, where) {
  if (!node || typeof node !== 'object') throw new Error(`Unsupported node at ${where}`);

  if (typeof node.$ref === 'string') {
    const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(node.$ref);
    if (!match) throw new Error(`Only #/$defs refs are supported, got ${node.$ref} at ${where}`);
    return { k: 'ref', name: match[1], doc: node.description };
  }

  if (Array.isArray(node.oneOf)) {
    const discriminator = node['x-discriminator'];
    if (typeof discriminator === 'string') {
      return {
        k: 'union',
        discriminator,
        variants: node.oneOf.map((branch, i) => classify(branch, `${where}.oneOf[${i}]`)),
        doc: node.description,
      };
    }
    const nulls = node.oneOf.filter((branch) => branch.type === 'null');
    const rest = node.oneOf.filter((branch) => branch.type !== 'null');
    if (nulls.length === 1 && rest.length === 1) {
      return { k: 'nullable', inner: classify(rest[0], where), doc: node.description };
    }
    throw new Error(`Unsupported oneOf at ${where}: needs x-discriminator or a single null branch`);
  }

  const types = Array.isArray(node.type) ? node.type : [node.type];
  const nullable = types.includes('null');
  const primary = types.filter((t) => t !== 'null');
  if (primary.length !== 1) throw new Error(`Exactly one non-null type required at ${where}`);
  const wrap = (inner) => (nullable ? { k: 'nullable', inner, doc: node.description } : inner);
  const type = primary[0];

  if (type === 'boolean') return wrap({ k: 'boolean', doc: node.description });

  if (type === 'string') {
    if (typeof node.const === 'string') return wrap({ k: 'const', value: node.const, jsonType: 'string', doc: node.description });
    if (Array.isArray(node.enum)) return wrap({ k: 'enum', values: node.enum, doc: node.description });
    return wrap({
      k: 'string',
      pattern: node.pattern,
      format: node.format,
      minLength: node.minLength,
      maxLength: node.maxLength,
      doc: node.description,
    });
  }

  if (type === 'integer' || type === 'number') {
    if (typeof node.const === 'number') return wrap({ k: 'const', value: node.const, jsonType: type, doc: node.description });
    return wrap({ k: type, minimum: node.minimum, maximum: node.maximum, doc: node.description });
  }

  if (type === 'array') {
    if (!node.items) throw new Error(`Array without items at ${where}`);
    return wrap({
      k: 'array',
      items: classify(node.items, `${where}[]`),
      minItems: node.minItems,
      maxItems: node.maxItems,
      doc: node.description,
    });
  }

  if (type === 'object') {
    const extra = node.additionalProperties;
    if (extra && typeof extra === 'object') {
      return wrap({
        k: 'record',
        keyPattern: node.propertyNames?.pattern,
        values: classify(extra, `${where}{}`),
        doc: node.description,
      });
    }
    if (!node.properties) throw new Error(`Object without properties at ${where}`);
    const required = new Set(node.required ?? []);
    return wrap({
      k: 'object',
      doc: node.description,
      fields: Object.entries(node.properties).map(([name, child]) => ({
        name,
        required: required.has(name),
        doc: child.description,
        node: classify(child, `${where}.${name}`),
      })),
    });
  }

  throw new Error(`Unsupported type "${type}" at ${where}`);
}

/** Walk every constraint carrying an `x-limit` annotation and lift its value. */
function collectLimits(schema) {
  const limits = {};
  const constants = schema['x-constants'] ?? {};
  for (const [name, value] of Object.entries(constants)) {
    if (name.startsWith('_')) continue;
    limits[name] = value;
  }

  const visit = (node, where) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, i) => visit(child, `${where}[${i}]`));
      return;
    }
    const annotation = node['x-limit'];
    if (annotation) {
      for (const [constraint, constantName] of Object.entries(annotation)) {
        const value = node[constraint];
        if (typeof value !== 'number') {
          throw new Error(`x-limit at ${where} names "${constraint}" but that constraint is missing`);
        }
        if (limits[constantName] !== undefined && limits[constantName] !== value) {
          throw new Error(`Limit ${constantName} declared twice with different values (${limits[constantName]} vs ${value}) at ${where}`);
        }
        limits[constantName] = value;
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'x-limit') continue;
      visit(child, `${where}.${key}`);
    }
  };
  visit(schema.$defs, '$defs');

  return Object.fromEntries(Object.entries(limits).sort(([a], [b]) => a.localeCompare(b)));
}

/** Order definitions so a type is always emitted before anything referencing it. */
function topoSort(defs) {
  const refsOf = (node, out = new Set()) => {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) {
      node.forEach((child) => refsOf(child, out));
      return out;
    }
    if (typeof node.$ref === 'string') {
      const match = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(node.$ref);
      if (match) out.add(match[1]);
    }
    Object.values(node).forEach((child) => refsOf(child, out));
    return out;
  };

  const dependencies = new Map(Object.keys(defs).map((name) => [name, refsOf(defs[name])]));
  const ordered = [];
  const state = new Map();

  const visit = (name, trail) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') {
      throw new Error(`Reference cycle: ${[...trail, name].join(' -> ')}. The emitters are single-pass and cannot express one.`);
    }
    state.set(name, 'visiting');
    for (const dependency of dependencies.get(name) ?? []) {
      if (!defs[dependency]) throw new Error(`${name} references missing $def ${dependency}`);
      visit(dependency, [...trail, name]);
    }
    state.set(name, 'done');
    ordered.push(name);
  };

  Object.keys(defs).forEach((name) => visit(name, []));
  return ordered;
}

// ── Shared emitter helpers ──────────────────────────────────────────────────

const screamingSnake = (pascal) => pascal.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
const enumConstName = (defName) => `${screamingSnake(defName)}_VALUES`;
const lowerFirst = (name) => name.charAt(0).toLowerCase() + name.slice(1);
const quote = (value) => JSON.stringify(value);

function banner(commentOpen, commentLine, commentClose) {
  const lines = [
    'GENERATED FILE — DO NOT EDIT.',
    '',
    `Source:    ${SCHEMA_REL}`,
    `Regenerate: ${COMMAND}`,
    '',
    'Every hand edit here is erased on the next run, and CI fails the build in',
    'the meantime. Change the JSON Schema instead.',
  ];
  return `${commentOpen}\n${lines.map((line) => `${commentLine}${line}`.trimEnd()).join('\n')}\n${commentClose}\n`;
}

function docBlock(text, indent, prefix) {
  if (!text) return '';
  const width = 96 - indent.length;
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (current && current.length + word.length + 1 > width) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) lines.push(current);
  return lines.map((line) => `${indent}${prefix}${line}`).join('\n');
}

function limitsBlock(limits, render) {
  return Object.entries(limits).map(([name, value]) => render(name, value)).join('\n');
}

// ── Target 1: frontend TypeScript types ─────────────────────────────────────

function emitTypeScriptTypes(defs, order, limits) {
  const tsType = (node) => {
    switch (node.k) {
      case 'ref': return node.name;
      case 'nullable': return `${tsType(node.inner)} | null`;
      case 'array': return `${wrapUnion(node.items)}[]`;
      case 'record': return `Record<string, ${tsType(node.values)}>`;
      case 'enum': return node.values.map(quote).join(' | ');
      case 'const': return node.jsonType === 'string' ? quote(node.value) : String(node.value);
      case 'string': return 'string';
      case 'integer':
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'union': return node.variants.map(tsType).join(' | ');
      case 'object': return `{ ${node.fields.map((f) => `${f.name}${f.required ? '' : '?'}: ${tsType(f.node)}`).join('; ')} }`;
      default: throw new Error(`No TS mapping for ${node.k}`);
    }
  };
  const wrapUnion = (node) => {
    const rendered = tsType(node);
    return rendered.includes('|') ? `(${rendered})` : rendered;
  };

  const chunks = [banner('//', '// ', '//')];
  chunks.push(
    '// The browser is a thin editor over this contract: it may pose and preview a',
    '// RigDocument, but every field here is authored server-side by the Python',
    '// geometry service. Treat an instance as read-only except through an API call.',
    '',
  );

  for (const name of order) {
    const raw = defs[name];
    const node = classify(raw, name);
    const doc = docBlock(raw.description, '', '// ');

    if (node.k === 'enum') {
      if (doc) chunks.push(doc);
      chunks.push(`export const ${enumConstName(name)} = [${node.values.map(quote).join(', ')}] as const;`);
      chunks.push(`export type ${name} = (typeof ${enumConstName(name)})[number];`, '');
      continue;
    }

    if (node.k === 'union') {
      if (doc) chunks.push(doc);
      chunks.push(`export type ${name} = ${node.variants.map(tsType).join(' | ')};`, '');
      continue;
    }

    if (node.k === 'object') {
      if (doc) chunks.push(doc);
      chunks.push(`export interface ${name} {`);
      for (const field of node.fields) {
        const fieldDoc = docBlock(field.doc, '  ', '/** ');
        if (fieldDoc) chunks.push(`${fieldDoc.replace(/\/\*\* /g, '// ')}`);
        chunks.push(`  ${field.name}${field.required ? '' : '?'}: ${tsType(field.node)};`);
      }
      chunks.push('}', '');
      continue;
    }

    if (doc) chunks.push(doc);
    chunks.push(`export type ${name} = ${tsType(node)};`, '');
  }

  chunks.push(
    '/** Every cap and epsilon the pipeline agrees on. Rule 9: import from here,',
    ' *  never re-declare a literal at a call site. */',
    'export const ANIBUDDY_LIMITS = {',
    limitsBlock(limits, (key, value) => `  ${key}: ${value},`),
    '} as const;',
    '',
    'export type AniBuddyLimitName = keyof typeof ANIBUDDY_LIMITS;',
    '',
  );

  return `${chunks.join('\n').replace(/\n{3,}/g, '\n\n')}`;
}

// ── Target 2: backend zod DTOs ──────────────────────────────────────────────

function emitZod(defs, order, limits) {
  const zodExpr = (node) => {
    switch (node.k) {
      case 'ref': return `${lowerFirst(node.name)}Schema`;
      case 'nullable': return `${zodExpr(node.inner)}.nullable()`;
      case 'array': {
        let expr = `z.array(${zodExpr(node.items)})`;
        if (typeof node.minItems === 'number') expr += `.min(${node.minItems})`;
        if (typeof node.maxItems === 'number') expr += `.max(${node.maxItems})`;
        return expr;
      }
      case 'record': {
        const key = node.keyPattern ? `z.string().regex(/${node.keyPattern}/)` : 'z.string()';
        return `z.record(${key}, ${zodExpr(node.values)})`;
      }
      case 'enum': return `z.enum([${node.values.map(quote).join(', ')}])`;
      case 'const': return `z.literal(${node.jsonType === 'string' ? quote(node.value) : node.value})`;
      case 'string': {
        let expr = 'z.string()';
        if (typeof node.minLength === 'number') expr += `.min(${node.minLength})`;
        if (typeof node.maxLength === 'number') expr += `.max(${node.maxLength})`;
        if (node.pattern) expr += `.regex(/${node.pattern}/)`;
        if (node.format === 'date-time') expr += '.datetime()';
        return expr;
      }
      case 'integer':
      case 'number': {
        let expr = node.k === 'integer' ? 'z.number().int()' : 'z.number()';
        if (typeof node.minimum === 'number') expr += `.min(${node.minimum})`;
        if (typeof node.maximum === 'number') expr += `.max(${node.maximum})`;
        return expr;
      }
      case 'boolean': return 'z.boolean()';
      case 'object': return `z.object({ ${node.fields.map((f) => `${f.name}: ${zodExpr(f.node)}${f.required ? '' : '.optional()'}`).join(', ')} }).strict()`;
      default: throw new Error(`No zod mapping for ${node.k}`);
    }
  };

  const chunks = [banner('//', '// ', '//')];
  chunks.push(
    "import { z } from 'zod';",
    '',
    '// The gateway validates at this boundary and nowhere else. Mongo stores a',
    '// projection of an already-validated document (unions land as Mixed there),',
    '// so anything that reaches the database has passed through a schema below.',
    '',
  );

  const exported = [];
  for (const name of order) {
    const raw = defs[name];
    const node = classify(raw, name);
    const constName = `${lowerFirst(name)}Schema`;
    const doc = docBlock(raw.description, '', '// ');
    if (doc) chunks.push(doc);

    if (node.k === 'enum') {
      chunks.push(`export const ${enumConstName(name)} = [${node.values.map(quote).join(', ')}] as const;`);
      chunks.push(`const ${constName} = z.enum(${enumConstName(name)});`);
    } else if (node.k === 'union') {
      const variants = node.variants.map((variant) => {
        if (variant.k !== 'ref') throw new Error(`Union ${name} must reference named variants`);
        return `${lowerFirst(variant.name)}Schema`;
      });
      chunks.push(`const ${constName} = z.discriminatedUnion(${quote(node.discriminator)}, [${variants.join(', ')}]);`);
    } else {
      chunks.push(`const ${constName} = ${zodExpr(node)};`);
    }

    chunks.push(`export type ${name} = z.infer<typeof ${constName}>;`, '');
    exported.push({ name, constName });
  }

  chunks.push(
    '/** Every cap and epsilon the pipeline agrees on. Rule 9: import from here,',
    ' *  never re-declare a literal at a call site. */',
    'export const ANIBUDDY_LIMITS = {',
    limitsBlock(limits, (key, value) => `  ${key}: ${value},`),
    '} as const;',
    '',
    '/** Rule 16: one PascalCase object, one named export, methods and members',
    ' *  declared directly inside it. */',
    'export const AniBuddyRigDocumentDto = {',
    ...exported.map(({ name, constName }) => `  ${lowerFirst(name)}: ${constName},`),
    '} as const;',
    '',
  );

  return chunks.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── Target 3: backend Mongoose schemas ──────────────────────────────────────

function emitMongoose(defs, order) {
  // Mongo is a storage projection, not the validating boundary. Tagged unions
  // and nested numeric arrays land as Mixed because Mongoose cannot express
  // them without either a discriminator model per variant or a validator
  // function, and Rule 10 keeps business logic out of a model file.
  // Only object $defs become Mongoose sub-schemas. A ref to an enum or to a
  // tagged union has no sub-schema to point at, so it is flattened here rather
  // than emitting a reference to a constant that was never declared.
  const deref = (node) => (node.k === 'ref' && defs[node.name] ? classify(defs[node.name], node.name) : node);
  const isSubSchema = (node) => node.k === 'ref' && deref(node).k === 'object';

  /** The `type:`/constraint half of a path definition, with no `required` or
   *  `default` key — those are decided once by the caller, so a nullable field
   *  cannot end up declaring `default` twice. */
  const mongoParts = (raw) => {
    const node = isSubSchema(raw) ? raw : deref(raw);
    switch (node.k) {
      case 'ref': return [`type: ${lowerFirst(node.name)}Schema`];
      case 'array': {
        const items = isSubSchema(node.items) ? node.items : deref(node.items);
        if (items.k === 'array' || items.k === 'union') return ['type: [Schema.Types.Mixed]'];
        if (items.k === 'ref') return [`type: [${lowerFirst(items.name)}Schema]`];
        return [`type: [${scalarCtor(items)}]`];
      }
      case 'record': {
        const values = isSubSchema(node.values) ? node.values : deref(node.values);
        const of = values.k === 'ref' ? `${lowerFirst(values.name)}Schema` : scalarCtor(values);
        return ['type: Map', `of: ${of}`];
      }
      case 'union': return ['type: Schema.Types.Mixed'];
      case 'enum': return ['type: String', `enum: [${node.values.map(quote).join(', ')}]`];
      case 'const': return node.jsonType === 'string'
        ? ['type: String', `enum: [${quote(node.value)}]`]
        : ['type: Number'];
      case 'string': {
        const parts = ['type: String'];
        if (typeof node.maxLength === 'number') parts.push(`maxlength: ${node.maxLength}`);
        if (node.pattern) parts.push(`match: /${node.pattern}/`);
        return parts;
      }
      case 'integer':
      case 'number': {
        const parts = ['type: Number'];
        if (typeof node.minimum === 'number') parts.push(`min: ${node.minimum}`);
        if (typeof node.maximum === 'number') parts.push(`max: ${node.maximum}`);
        return parts;
      }
      case 'boolean': return ['type: Boolean'];
      default: throw new Error(`No Mongoose mapping for ${node.k}`);
    }
  };

  const mongoField = (node, required) => {
    const nullable = node.k === 'nullable';
    const raw = nullable ? node.inner : node;
    const target = isSubSchema(raw) ? raw : deref(raw);
    const parts = mongoParts(raw);
    parts.push(`required: ${nullable ? false : required}`);
    if (nullable) parts.push('default: null');
    else if (target.k === 'const' && target.jsonType !== 'string') parts.push(`default: ${target.value}`);
    else if (target.k === 'const') parts.push(`default: ${quote(target.value)}`);
    else if (target.k === 'array') parts.push('default: undefined');
    return `{ ${parts.join(', ')} }`;
  };

  const scalarCtor = (node) => {
    switch (node.k) {
      case 'string':
      case 'enum':
      case 'const': return node.jsonType === 'number' ? 'Number' : 'String';
      case 'integer':
      case 'number': return 'Number';
      case 'boolean': return 'Boolean';
      default: return 'Schema.Types.Mixed';
    }
  };

  const chunks = [banner('//', '// ', '//')];
  chunks.push(
    "import { Schema } from 'mongoose';",
    '',
    '// Storage projection of the RigDocument contract. Rule 10: pure schema — no',
    '// hooks, no methods, no virtuals. Validation lives in the zod DTOs; anything',
    '// a document reaches Mongo with has already passed them. Tagged unions are',
    '// Mixed here because Mongoose can only express a union through a',
    '// discriminator model, which would drag behaviour into a model file.',
    '',
  );

  const exported = [];
  for (const name of order) {
    const node = classify(defs[name], name);
    if (node.k === 'enum' || node.k === 'union') continue;
    if (node.k !== 'object') continue;

    const constName = `${lowerFirst(name)}Schema`;
    chunks.push(`const ${constName} = new Schema({`);
    for (const field of node.fields) {
      chunks.push(`  ${field.name}: ${mongoField(field.node, field.required)},`);
    }
    chunks.push('}, { _id: false });', '');
    exported.push({ name, constName });
  }

  chunks.push(
    '/** Rule 16: one PascalCase object, one named export. Compose these into a',
    ' *  top-level model with `new Schema({ ... rig: AniBuddyRigDocumentSchemas.rigDocument })`. */',
    'export const AniBuddyRigDocumentSchemas = {',
    ...exported.map(({ name, constName }) => `  ${lowerFirst(name)}: ${constName},`),
    '} as const;',
    '',
  );

  return chunks.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ── Target 4: py_backend Pydantic models ────────────────────────────────────

function emitPydantic(defs, order, limits) {
  const pyType = (node) => {
    switch (node.k) {
      case 'ref': return node.name;
      case 'nullable': return `Optional[${pyType(node.inner)}]`;
      case 'array': return `List[${pyType(node.items)}]`;
      case 'record': return `Dict[str, ${pyType(node.values)}]`;
      case 'enum': return `Literal[${node.values.map(quote).join(', ')}]`;
      case 'const': return node.jsonType === 'string' ? `Literal[${quote(node.value)}]` : `Literal[${node.value}]`;
      case 'string': return 'str';
      case 'integer': return 'int';
      case 'number': return 'float';
      case 'boolean': return 'bool';
      default: throw new Error(`No Python mapping for ${node.k}`);
    }
  };

  const fieldArgs = (node, required) => {
    const args = [];
    const target = node.k === 'nullable' ? node.inner : node;
    if (target.k === 'string') {
      if (typeof target.minLength === 'number') args.push(`min_length=${target.minLength}`);
      if (typeof target.maxLength === 'number') args.push(`max_length=${target.maxLength}`);
      if (target.pattern) args.push(`pattern=r${quote(target.pattern)}`);
    }
    if (target.k === 'integer' || target.k === 'number') {
      if (typeof target.minimum === 'number') args.push(`ge=${target.minimum}`);
      if (typeof target.maximum === 'number') args.push(`le=${target.maximum}`);
    }
    if (target.k === 'array') {
      if (typeof target.minItems === 'number') args.push(`min_length=${target.minItems}`);
      if (typeof target.maxItems === 'number') args.push(`max_length=${target.maxItems}`);
    }
    const first = required ? '...' : 'None';
    if (args.length === 0) return required ? '' : ' = None';
    return ` = Field(${first}, ${args.join(', ')})`;
  };

  const chunks = [banner('"""', '', '"""')];
  chunks.push(
    'from __future__ import annotations',
    '',
    'from typing import Annotated, Dict, Final, List, Literal, Optional, Union',
    '',
    'from pydantic import BaseModel, ConfigDict, Field',
    '',
    '# Field names stay camelCase on purpose. These models sit directly on the',
    '# wire between the Node gateway and the geometry workers, and a snake_case',
    '# alias layer is one more place the three languages could disagree about a',
    '# name. Read them as the wire contract, not as idiomatic Python.',
    '',
    '_CONFIG = ConfigDict(extra="forbid", protected_namespaces=())',
    '',
    '',
  );

  for (const name of order) {
    const raw = defs[name];
    const node = classify(raw, name);
    const doc = raw.description ? docBlock(raw.description, '    ', '') : '';

    if (node.k === 'enum') {
      chunks.push(`${enumConstName(name)}: Final[tuple[str, ...]] = (`);
      for (const value of node.values) chunks.push(`    ${quote(value)},`);
      chunks.push(')');
      chunks.push(`${name} = Literal[${node.values.map(quote).join(', ')}]`, '', '');
      continue;
    }

    if (node.k === 'union') {
      const variants = node.variants.map((variant) => {
        if (variant.k !== 'ref') throw new Error(`Union ${name} must reference named variants`);
        return variant.name;
      });
      chunks.push(`${name} = Annotated[Union[${variants.join(', ')}], Field(discriminator=${quote(node.discriminator)})]`, '', '');
      continue;
    }

    if (node.k !== 'object') throw new Error(`Top-level $def ${name} must be an object, enum or union`);

    chunks.push(`class ${name}(BaseModel):`);
    if (doc) chunks.push('    """', doc, '    """', '');
    chunks.push('    model_config = _CONFIG', '');
    for (const field of node.fields) {
      if (PY_RESERVED.has(field.name)) throw new Error(`Field "${field.name}" in ${name} is a Python keyword`);
      const optional = field.required ? pyType(field.node) : `Optional[${pyType(field.node)}]`;
      chunks.push(`    ${field.name}: ${optional}${fieldArgs(field.node, field.required)}`);
    }
    chunks.push('', '');
  }

  chunks.push(
    '# Every cap and epsilon the pipeline agrees on. Rule 9: import from here,',
    '# never re-declare a literal at a call site.',
    'ANIBUDDY_LIMITS: Final[dict[str, float]] = {',
    limitsBlock(limits, (key, value) => `    ${quote(key)}: ${value},`),
    '}',
    '',
  );

  return `${chunks.join('\n').replace(/\n{4,}/g, '\n\n\n')}`;
}

// ── Driver ──────────────────────────────────────────────────────────────────

function build() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const defs = schema.$defs;
  const order = topoSort(defs);
  const limits = collectLimits(schema);

  return {
    [OUTPUTS.frontendTypes]: emitTypeScriptTypes(defs, order, limits),
    [OUTPUTS.backendZod]: emitZod(defs, order, limits),
    [OUTPUTS.backendMongoose]: emitMongoose(defs, order),
    [OUTPUTS.pythonPydantic]: emitPydantic(defs, order, limits),
  };
}

function main() {
  const check = process.argv.includes('--check');
  const files = build();
  const stale = [];

  for (const [path, contents] of Object.entries(files)) {
    const shown = relative(REPO_ROOT, path).split(sep).join('/');
    if (check) {
      const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
      if (current !== contents) stale.push(shown);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
    process.stdout.write(`wrote ${shown}\n`);
  }

  if (!check) {
    process.stdout.write(`\n${Object.keys(files).length} bindings generated from ${SCHEMA_REL}\n`);
    return;
  }

  if (stale.length > 0) {
    process.stderr.write(
      `AniBuddy schema bindings are out of date:\n${stale.map((path) => `  - ${path}`).join('\n')}\n\n` +
      `Run \`${COMMAND}\` and commit the result.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`AniBuddy schema bindings match ${SCHEMA_REL}\n`);
}

main();
