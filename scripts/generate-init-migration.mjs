/**
 * Generates prisma/migrations/<ts>_init/migration.sql from schema.prisma.
 *
 * Normally `prisma migrate dev` does this for you. This script exists because
 * the initial migration was authored in an environment without access to
 * Prisma's migration engine binary. It follows Prisma's own DDL conventions
 * (constraint/index naming, type mapping, default handling) so that subsequent
 * `prisma migrate dev` runs see no drift.
 *
 * You should not need to run this again — future schema changes go through
 * `npm run db:migrate`.
 *
 *   node scripts/generate-init-migration.mjs > prisma/migrations/0_init/migration.sql
 */
import pkg from '@prisma/internals';
import { readFileSync } from 'node:fs';

const { getDMMF } = pkg;
const schemaText = readFileSync('prisma/schema.prisma', 'utf8');
const { datamodel } = await getDMMF({ datamodel: schemaText });

// ---------------------------------------------------------------------------
// The DMMF omits @@index and referential actions, so pull those from the text.
// ---------------------------------------------------------------------------
function parseSchemaExtras(text) {
  const models = {};
  const blockRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = blockRe.exec(text))) {
    const [, name, body] = m;
    const entry = { indexes: [], uniques: [], onDelete: {}, onUpdate: {} };

    const idxRe = /@@index\(\[([^\]]+)\]\)/g;
    let i;
    while ((i = idxRe.exec(body))) {
      entry.indexes.push(i[1].split(',').map((s) => s.trim()));
    }

    const uniqRe = /@@unique\(\[([^\]]+)\]\)/g;
    while ((i = uniqRe.exec(body))) {
      entry.uniques.push(i[1].split(',').map((s) => s.trim()));
    }

    // Relation attributes: `field Type @relation(fields: [x], references: [y], onDelete: Cascade)`
    const relRe = /^\s*(\w+)\s+\w+\??\s+@relation\(([^)]*)\)/gm;
    while ((i = relRe.exec(body))) {
      const [, fieldName, args] = i;
      const del = args.match(/onDelete:\s*(\w+)/);
      const upd = args.match(/onUpdate:\s*(\w+)/);
      if (del) entry.onDelete[fieldName] = del[1];
      if (upd) entry.onUpdate[fieldName] = upd[1];
    }

    models[name] = entry;
  }
  return models;
}

const extras = parseSchemaExtras(schemaText);
const enumNames = new Set(datamodel.enums.map((e) => e.name));

// ---------------------------------------------------------------------------
// Type mapping (Prisma -> PostgreSQL)
// ---------------------------------------------------------------------------
function columnType(field) {
  const nt = field.nativeType;
  let base;

  if (enumNames.has(field.type)) {
    base = `"${field.type}"`;
  } else if (nt) {
    const [name, args] = nt;
    base = args && args.length ? `${name.toUpperCase()}(${args.join(', ')})` : name.toUpperCase();
    if (name === 'Decimal') base = `DECIMAL(${args.join(',')})`;
    if (name === 'VarChar') base = `VARCHAR(${args.join(',')})`;
    if (name === 'Text') base = 'TEXT';
  } else {
    switch (field.type) {
      case 'String':
        base = 'TEXT';
        break;
      case 'Boolean':
        base = 'BOOLEAN';
        break;
      case 'Int':
        base = 'INTEGER';
        break;
      case 'BigInt':
        base = 'BIGINT';
        break;
      case 'Float':
        base = 'DOUBLE PRECISION';
        break;
      case 'Decimal':
        base = 'DECIMAL(65,30)';
        break;
      case 'DateTime':
        base = 'TIMESTAMP(3)';
        break;
      case 'Json':
        base = 'JSONB';
        break;
      case 'Bytes':
        base = 'BYTEA';
        break;
      default:
        throw new Error(`Unmapped scalar type: ${field.type}`);
    }
  }

  // Int @default(autoincrement()) becomes SERIAL.
  if (field.type === 'Int' && field.default?.name === 'autoincrement') base = 'SERIAL';

  return field.isList ? `${base}[]` : base;
}

function sqlLiteral(value, field) {
  if (typeof value === 'string') {
    if (enumNames.has(field.type)) return `'${value}'`;
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function defaultClause(field) {
  if (!field.hasDefaultValue) return '';
  const d = field.default;

  // List defaults: ARRAY['a','b']::TEXT[]
  if (Array.isArray(d)) {
    const inner = d.map((v) => sqlLiteral(v, field)).join(', ');
    const t = columnType({ ...field, isList: false });
    return ` DEFAULT ARRAY[${inner}]::${t}[]`;
  }

  if (d && typeof d === 'object' && d.name) {
    switch (d.name) {
      case 'now':
        return ' DEFAULT CURRENT_TIMESTAMP';
      case 'autoincrement':
        return ''; // handled by SERIAL
      case 'cuid':
      case 'uuid':
        return ''; // generated client-side, exactly like Prisma does it
      case 'dbgenerated':
        return ` DEFAULT ${d.args?.[0] ?? ''}`;
      default:
        return '';
    }
  }

  if (field.type === 'Json') {
    const raw = typeof d === 'string' ? d : JSON.stringify(d);
    return ` DEFAULT '${raw.replace(/'/g, "''")}'`;
  }

  return ` DEFAULT ${sqlLiteral(d, field)}`;
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------
const out = [];
out.push('-- Initial schema for the Insurance CRM.');
out.push('-- Generated from prisma/schema.prisma; see scripts/generate-init-migration.mjs.');
out.push('');

out.push('-- CreateEnum');
for (const e of datamodel.enums) {
  out.push(`CREATE TYPE "${e.name}" AS ENUM (${e.values.map((v) => `'${v.name}'`).join(', ')});`);
}
out.push('');

const fkStatements = [];
const indexStatements = [];

for (const model of datamodel.models) {
  const table = model.dbName ?? model.name;
  const scalars = model.fields.filter((f) => f.kind === 'scalar' || f.kind === 'enum');

  out.push(`-- CreateTable`);
  const cols = scalars.map((f) => {
    const nullability = f.isRequired ? ' NOT NULL' : '';
    return `    "${f.name}" ${columnType(f)}${nullability}${defaultClause(f)}`;
  });

  const idFields = model.fields.filter((f) => f.isId).map((f) => `"${f.name}"`);
  const pk = model.primaryKey
    ? model.primaryKey.fields.map((f) => `"${f}"`)
    : idFields;

  const body = [...cols];
  if (pk.length) body.push(`\n    CONSTRAINT "${table}_pkey" PRIMARY KEY (${pk.join(', ')})`);

  out.push(`CREATE TABLE "${table}" (\n${body.join(',\n').replace(/,\n\n/, ',\n\n')}\n);`);
  out.push('');

  // Single-field @unique
  for (const f of scalars) {
    if (f.isUnique && !f.isId) {
      indexStatements.push(
        `CREATE UNIQUE INDEX "${table}_${f.name}_key" ON "${table}"("${f.name}");`,
      );
    }
  }

  // Composite @@unique
  for (const u of extras[model.name]?.uniques ?? []) {
    indexStatements.push(
      `CREATE UNIQUE INDEX "${table}_${u.join('_')}_key" ON "${table}"(${u.map((c) => `"${c}"`).join(', ')});`,
    );
  }

  // @@index
  for (const idx of extras[model.name]?.indexes ?? []) {
    indexStatements.push(
      `CREATE INDEX "${table}_${idx.join('_')}_idx" ON "${table}"(${idx.map((c) => `"${c}"`).join(', ')});`,
    );
  }

  // Foreign keys
  for (const f of model.fields) {
    if (f.kind !== 'object') continue;
    if (!f.relationFromFields?.length) continue; // back-relation side

    const from = f.relationFromFields;
    const to = f.relationToFields ?? ['id'];
    const declaredDelete = extras[model.name]?.onDelete?.[f.name];
    const declaredUpdate = extras[model.name]?.onUpdate?.[f.name];

    // Prisma's defaults when not declared.
    const onDelete = declaredDelete
      ? declaredDelete.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()
      : f.isRequired
        ? 'RESTRICT'
        : 'SET NULL';
    const onUpdate = declaredUpdate
      ? declaredUpdate.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()
      : 'CASCADE';

    const constraintName = `${table}_${from.join('_')}_fkey`;
    fkStatements.push(
      `ALTER TABLE "${table}" ADD CONSTRAINT "${constraintName}" FOREIGN KEY (${from
        .map((c) => `"${c}"`)
        .join(', ')}) REFERENCES "${f.type}"(${to.map((c) => `"${c}"`).join(', ')}) ON DELETE ${onDelete} ON UPDATE ${onUpdate};`,
    );
  }
}

// A single-field @@unique([x]) also surfaces as field.isUnique in the DMMF,
// so the same index can be emitted twice. Keep the first occurrence only.
const seenIndexNames = new Set();
const dedupedIndexes = indexStatements.filter((stmt) => {
  const name = stmt.match(/INDEX "([^"]+)"/)?.[1];
  if (!name || seenIndexNames.has(name)) return false;
  seenIndexNames.add(name);
  return true;
});

out.push('-- CreateIndex');
out.push(...dedupedIndexes);
out.push('');
out.push('-- AddForeignKey');
out.push(...fkStatements);
out.push('');

process.stdout.write(out.join('\n'));
