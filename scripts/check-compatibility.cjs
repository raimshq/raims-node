'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const BASELINE = path.join(ROOT, 'contracts/node-api.json');
const TYPESCRIPT_VERSION = '6.0.3';
const SCHEMA_VERSION = 1;
const WORKSPACE = [path.dirname(ROOT), path.dirname(path.dirname(ROOT))].find(candidate => fs.existsSync(path.join(candidate, 'Developer-Toolkit/scripts/release-preflight/node_sdk.py'))) || (path.basename(path.dirname(ROOT)).toLowerCase() === 'sdks' ? path.dirname(path.dirname(ROOT)) : path.dirname(ROOT));
function argumentsFor(argv) {
  let mode = null;
  let typescript = process.env.RAIMS_TYPESCRIPT;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--check' || arg === '--write') {
      if (mode !== null) throw new Error('Choose exactly one of --check or --write.');
      mode = arg;
    } else if (arg === '--typescript') {
      if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error('--typescript requires a module directory or typescript.js path.');
      typescript = argv[++index];
    } else {
      throw new Error('Usage: node scripts/check-compatibility.cjs [--check | --write] [--typescript <path>]');
    }
  }
  return { mode: mode ?? '--check', typescript: path.resolve(typescript || path.join(WORKSPACE, '.tmp/raims-node-sdk/tools/node-tools/node_modules/typescript')) };
}

function loadTypeScript(location) {
  let ts;
  try { ts = require(location); }
  catch { throw new Error(`TypeScript ${TYPESCRIPT_VERSION} is required. Prepare the pinned tools or configure --typescript / RAIMS_TYPESCRIPT.`); }
  if (ts.version !== TYPESCRIPT_VERSION) throw new Error(`Expected TypeScript ${TYPESCRIPT_VERSION}; found ${ts.version ?? 'an unsupported module'}.`);
  return ts;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function keyFor(value) { return JSON.stringify(stable(value)); }
function same(left, right) { return keyFor(left) === keyFor(right); }
function unique(values) { return [...new Map(values.map(value => [keyFor(value), value])).entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value); }

function declarationsFor(ts, file, moduleName) {
  const source = ts.createSourceFile(file, fs.readFileSync(path.join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Cannot parse public declarations: ${file}.`);
  const printer = ts.createPrinter({ removeComments: true });
  const aliases = new Map();
  const symbols = {};
  const exports = {};
  const isExported = node => node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const isPrivate = node => Boolean(node.name && ts.isPrivateIdentifier(node.name)) || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword);
  const isReadonly = node => Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ReadonlyKeyword));
  const isStatic = node => Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword));
  const text = node => printer.printNode(ts.EmitHint.Unspecified, node, source).replace(/\s+/g, ' ').trim();

  function entity(node, bindings = new Map()) {
    if (ts.isIdentifier(node)) {
      if (bindings.has(node.text)) return bindings.get(node.text);
      let name = node.text;
      const visited = new Set();
      while (aliases.has(name) && !visited.has(name)) { visited.add(name); name = aliases.get(name); }
      return name;
    }
    if (ts.isQualifiedName(node)) return `${entity(node.left, bindings)}.${node.right.text}`;
    if (ts.isPropertyAccessExpression(node)) return `${entity(node.expression, bindings)}.${node.name.text}`;
    return text(node);
  }

  function parametersFor(node, parentBindings) {
    const bindings = new Map(parentBindings);
    const genericParameters = node.typeParameters ?? [];
    genericParameters.forEach((parameter, index) => bindings.set(parameter.name.text, `$${parentBindings.size + index}`));
    return { bindings, generic: genericParameters.map(parameter => ({
      modifiers: (parameter.modifiers ?? []).map(modifier => ts.tokenToString(modifier.kind)).sort(),
      constraint: parameter.constraint ? typeFor(parameter.constraint, bindings) : null,
      default: parameter.default ? typeFor(parameter.default, bindings) : null,
    })) };
  }

  function signatureFor(node, parentBindings = new Map()) {
    const { bindings, generic } = parametersFor(node, parentBindings);
    return { generic, parameters: (node.parameters ?? []).map(parameter => ({
      optional: Boolean(parameter.questionToken || parameter.initializer), rest: Boolean(parameter.dotDotDotToken),
      thisParameter: ts.isIdentifier(parameter.name) && parameter.name.text === 'this',
      type: typeFor(parameter.type, bindings),
    })), returns: typeFor(node.type, bindings) };
  }

  function memberName(node) {
    const name = node.name;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
    if (ts.isComputedPropertyName(name)) return `[${entity(name.expression)}]`;
    throw new Error(`A public member name needs explicit compatibility support: ${text(node)}.`);
  }

  function membersFor(nodes, bindings = new Map()) {
    const members = {};
    for (const node of nodes ?? []) {
      if (isPrivate(node)) continue;
      let name;
      let member;
      if (ts.isConstructorDeclaration(node)) {
        name = 'constructor'; member = { kind: 'constructor', signatures: [signatureFor(node, bindings)] };
      } else if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
        name = memberName(node); member = { kind: 'method', optional: Boolean(node.questionToken), signatures: [signatureFor(node, bindings)] };
      } else if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
        let type = typeFor(node.type, bindings);
        if (isStatic(node) && node.name.text === 'VERSION' && type.kind === 'literal' && type.type === 'string') type = { kind: 'keyword', name: 'string' };
        name = memberName(node); member = { kind: 'property', optional: Boolean(node.questionToken), readonly: isReadonly(node),
          type };
      } else if (ts.isIndexSignatureDeclaration(node)) {
        name = `[index:${members['[index:0]'] ? Object.keys(members).filter(key => key.startsWith('[index:')).length : 0}]`;
        member = { kind: 'index', readonly: isReadonly(node), signature: signatureFor(node, bindings) };
      } else if (ts.isCallSignatureDeclaration(node) || ts.isConstructSignatureDeclaration(node)) {
        name = ts.isCallSignatureDeclaration(node) ? '[call]' : '[new]';
        member = { kind: 'method', optional: false, signatures: [signatureFor(node, bindings)] };
      } else if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
        name = memberName(node); member = { kind: 'accessor', accessor: ts.isGetAccessorDeclaration(node) ? 'get' : 'set', signature: signatureFor(node, bindings) };
      } else {
        throw new Error(`A public member needs explicit compatibility support: ${ts.SyntaxKind[node.kind]}.`);
      }
      member.visibility = node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ProtectedKeyword) ? 'protected' : 'public';
      member.abstract = Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword));
      const key = isStatic(node) ? `static:${name}` : name;
      if (Object.hasOwn(members, key)) {
        if (member.signatures && members[key].signatures && member.kind === members[key].kind) members[key].signatures.push(...member.signatures);
        else throw new Error(`Conflicting public declarations for ${key}.`);
      } else members[key] = member;
    }
    return members;
  }

  function typeFor(node, bindings = new Map()) {
    if (!node) return { kind: 'inferred' };
    if (ts.isParenthesizedTypeNode(node)) return typeFor(node.type, bindings);
    if (node.kind >= ts.SyntaxKind.FirstKeyword && node.kind <= ts.SyntaxKind.LastKeyword) {
      return { kind: 'keyword', name: ts.tokenToString(node.kind) ?? ts.SyntaxKind[node.kind] };
    }
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
      return { kind: 'reference', name: entity(node.typeName ?? node.expression, bindings), arguments: (node.typeArguments ?? []).map(arg => typeFor(arg, bindings)) };
    }
    if (ts.isTypeQueryNode(node)) return { kind: 'query', name: entity(node.exprName, bindings), arguments: (node.typeArguments ?? []).map(arg => typeFor(arg, bindings)) };
    if (ts.isTypeLiteralNode(node)) return { kind: 'object', members: membersFor(node.members, bindings) };
    if (ts.isLiteralTypeNode(node)) {
      const literal = node.literal;
      if (literal.kind === ts.SyntaxKind.NullKeyword) return { kind: 'keyword', name: 'null' };
      if (ts.isStringLiteralLike(literal)) return { kind: 'literal', type: 'string', value: literal.text };
      if (ts.isNumericLiteral(literal)) return { kind: 'literal', type: 'number', value: Number(literal.text) };
      if (literal.kind === ts.SyntaxKind.TrueKeyword || literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'literal', type: 'boolean', value: literal.kind === ts.SyntaxKind.TrueKeyword };
      return { kind: 'literal', type: 'expression', value: text(literal) };
    }
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      const kind = ts.isUnionTypeNode(node) ? 'union' : 'intersection';
      let types = unique(node.types.flatMap(child => { const value = typeFor(child, bindings); return value.kind === kind ? value.types : [value]; }));
      if (kind === 'union') {
        const keywords = new Set(types.filter(type => type.kind === 'keyword').map(type => type.name));
        if (types.some(type => type.kind === 'intersection' && type.types.length === 2 &&
            type.types.some(part => part.kind === 'keyword' && part.name === 'string') &&
            type.types.some(part => part.kind === 'object' && Object.keys(part.members).length === 0))) keywords.add('string');
        types = types.filter(type => type.kind !== 'literal' || !keywords.has(type.type));
      }
      return types.length === 1 ? types[0] : { kind, types };
    }
    if (ts.isArrayTypeNode(node)) return { kind: 'array', type: typeFor(node.elementType, bindings) };
    if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) return { kind: ts.isFunctionTypeNode(node) ? 'function' : 'constructorType', signature: signatureFor(node, bindings) };
    if (ts.isConditionalTypeNode(node)) return { kind: 'conditional', check: typeFor(node.checkType, bindings), extends: typeFor(node.extendsType, bindings), yes: typeFor(node.trueType, bindings), no: typeFor(node.falseType, bindings) };
    if (ts.isIndexedAccessTypeNode(node)) return { kind: 'indexed', object: typeFor(node.objectType, bindings), index: typeFor(node.indexType, bindings) };
    if (ts.isTypeOperatorNode(node)) return { kind: 'operator', operator: ts.tokenToString(node.operator), type: typeFor(node.type, bindings) };
    if (ts.isTupleTypeNode(node)) return { kind: 'tuple', elements: node.elements.map(element => typeFor(element, bindings)) };
    throw new Error(`A public type needs explicit compatibility support: ${ts.SyntaxKind[node.kind]}. Review the new construct before changing the baseline.`);
  }

  for (const statement of source.statements) {
    if (ts.isImportEqualsDeclaration(statement) && !ts.isExternalModuleReference(statement.moduleReference)) aliases.set(statement.name.text, entity(statement.moduleReference));
    else if (ts.isImportDeclaration(statement)) {
      const module = statement.moduleSpecifier.text === './index.cjs' ? 'commonjs' : `module:${statement.moduleSpecifier.text}`;
      if (statement.importClause?.name) aliases.set(statement.importClause.name.text, `${module}:Raims`);
      const binding = statement.importClause?.namedBindings;
      if (binding && ts.isNamedImports(binding)) for (const item of binding.elements) aliases.set(item.name.text, `${module}:${item.propertyName?.text ?? item.name.text}`);
    }
  }

  function record(name, descriptor) {
    if (!Object.hasOwn(symbols, name)) symbols[name] = { facets: {} };
    const facets = symbols[name].facets;
    if (Object.hasOwn(facets, descriptor.kind)) {
      if (descriptor.kind === 'function') facets.function.signatures.push(...descriptor.signatures);
      else if (descriptor.kind === 'namespace') return;
      else throw new Error(`Repeated public ${descriptor.kind} declaration needs explicit compatibility support: ${name}.`);
    } else facets[descriptor.kind] = descriptor;
  }

  function visit(statements, prefix = '') {
    for (const node of statements) {
      if (ts.isModuleDeclaration(node)) {
        if (prefix || node.name.text === 'Raims' || isExported(node)) {
          if (!node.body || !ts.isModuleBlock(node.body)) throw new Error('Nested dotted namespaces need explicit compatibility support.');
          record(`${prefix}${node.name.text}`, { kind: 'namespace' });
          visit(node.body.statements, `${prefix}${node.name.text}.`);
        }
      } else if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        if (!prefix && !isExported(node) && !(moduleName === 'commonjs' && node.name?.text === 'Raims')) continue;
        const name = `${prefix}${node.name.text}`;
        const { bindings, generic } = parametersFor(node, new Map());
        if (ts.isTypeAliasDeclaration(node)) record(name, { kind: 'type', generic, type: typeFor(node.type, bindings) });
        else record(name, { kind: ts.isClassDeclaration(node) ? 'class' : 'interface', generic,
          abstract: Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AbstractKeyword)),
          heritage: unique((node.heritageClauses ?? []).flatMap(clause => clause.types.map(type => ({ relation: ts.tokenToString(clause.token), type: typeFor(type, bindings) })))),
          members: membersFor(node.members, bindings) });
      } else if (ts.isFunctionDeclaration(node) && (prefix || isExported(node))) {
        record(`${prefix}${node.name.text}`, { kind: 'function', signatures: [signatureFor(node)] });
      } else if (ts.isImportEqualsDeclaration(node) && isExported(node)) {
        if (ts.isExternalModuleReference(node.moduleReference)) throw new Error('External exported aliases need explicit compatibility support.');
        record(`${prefix}${node.name.text}`, { kind: 'alias', target: entity(node.moduleReference) });
      } else if (ts.isVariableStatement(node) && (prefix || isExported(node))) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name)) throw new Error('Public destructured variables need explicit compatibility support.');
          record(`${prefix}${declaration.name.text}`, { kind: 'value', readonly: Boolean(node.declarationList.flags & ts.NodeFlags.Const), type: typeFor(declaration.type) });
        }
      } else if (ts.isExportAssignment(node)) {
        exports[node.isExportEquals ? 'export=' : 'default'] = entity(node.expression);
      } else if (ts.isExportDeclaration(node)) {
        if (!node.exportClause || !ts.isNamedExports(node.exportClause) || node.moduleSpecifier) throw new Error('Public star or external re-exports need explicit compatibility support.');
        for (const item of node.exportClause.elements) exports[item.name.text] = entity(item.propertyName ?? item.name);
      } else if (isExported(node)) {
        throw new Error(`A public declaration needs explicit compatibility support: ${ts.SyntaxKind[node.kind]}.`);
      }
    }
  }
  visit(source.statements);
  return { exports, symbols };
}

async function runtimeFor() {
  const metadata = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const commonjs = require(path.join(ROOT, metadata.exports['.'].require.default));
  const esm = await import(pathToFileURL(path.join(ROOT, metadata.exports['.'].import.default)).href);
  if (typeof commonjs !== 'function') throw new Error('The CommonJS entry point must export the client constructor.');
  const ignore = new Set(['length', 'name', 'prototype', 'arguments', 'caller']);
  function describe(value, depth = 0, sharedIdentity = null) {
    if (depth > 5) throw new Error('Runtime public objects exceed the supported inspection depth.');
    const identity = value === commonjs ? '$client' : sharedIdentity;
    if (typeof value === 'function') return { kind: 'function', arity: value.length, ...(identity ? { identity } : {}) };
    if (value === null) return { kind: 'null' };
    if (typeof value !== 'object') return { kind: typeof value };
    return { kind: 'object', ...(identity ? { identity } : {}), members: Object.fromEntries(Object.keys(value).sort().map(name => [name, describe(value[name], depth + 1)])) };
  }
  const instance = new commonjs('compatibility_probe', { fetch: async () => { throw new Error('Compatibility inspection must not send HTTP.'); } });
  const instanceMembers = {};
  for (const name of Object.keys(instance).sort()) instanceMembers[name] = describe(instance[name]);
  for (const name of Object.getOwnPropertyNames(commonjs.prototype).sort()) if (name !== 'constructor') instanceMembers[name] = describe(commonjs.prototype[name]);
  return {
    constructor: { kind: 'function', arity: commonjs.length },
    commonjs: Object.fromEntries(Object.getOwnPropertyNames(commonjs).filter(name => !ignore.has(name)).sort().map(name => [name, describe(commonjs[name])])),
    esm: Object.fromEntries(Object.keys(esm).sort().map(name => [name, describe(esm[name], 0, Object.hasOwn(commonjs, name) && esm[name] === commonjs[name] ? `commonjs.${name}` : null)])),
    instance: instanceMembers,
  };
}

function incompatibilities(baseline, current) {
  const errors = [];
  const issue = (location, message) => errors.push(`${location}: ${message}`);
  function compareType(before, after, location) {
    if (same(before, after)) return;
    if (before?.kind === 'object' && after?.kind === 'object') return compareMembers(before.members, after.members, location);
    if (before?.kind === 'function' && after?.kind === 'function') return compareSignature(before.signature, after.signature, location);
    if (before?.kind === after?.kind) {
      if (before.kind === 'reference' && before.name === after.name && before.arguments.length === after.arguments.length) {
        before.arguments.forEach((type, index) => compareType(type, after.arguments[index], `${location}.typeArgument[${index}]`));
        return;
      }
      if (['union', 'intersection'].includes(before.kind) && before.types.length === after.types.length) {
        before.types.forEach((type, index) => compareType(type, after.types[index], `${location}.${before.kind}[${index}]`));
        return;
      }
      if (before.kind === 'array') return compareType(before.type, after.type, `${location}.item`);
      if (before.kind === 'operator' && before.operator === after.operator) return compareType(before.type, after.type, location);
    }
    issue(location, 'type changed; complex type changes require explicit compatibility review');
  }
  function compareSignature(before, after, location) {
    if (!same(before.generic, after.generic)) issue(location, 'generic parameters, constraints or defaults changed');
    if (after.parameters.length < before.parameters.length) issue(location, 'a positional parameter was removed');
    before.parameters.forEach((parameter, index) => {
      const next = after.parameters[index];
      if (!next) return;
      if (parameter.optional !== next.optional || parameter.rest !== next.rest || parameter.thisParameter !== next.thisParameter) issue(`${location}.parameter[${index}]`, 'parameter optionality, rest or this-context semantics changed');
      compareType(parameter.type, next.type, `${location}.parameter[${index}]`);
    });
    after.parameters.slice(before.parameters.length).forEach((parameter, index) => {
      if (!parameter.optional && !parameter.rest) issue(`${location}.parameter[${before.parameters.length + index}]`, 'a required positional parameter was added');
    });
    compareType(before.returns, after.returns, `${location}.return`);
  }
  function compareMembers(before, after, location) {
    for (const [name, member] of Object.entries(before)) {
      const next = Object.hasOwn(after, name) ? after[name] : null;
      const here = `${location}.${name}`;
      if (!next) { issue(here, 'public member was removed or renamed'); continue; }
      if (member.kind !== next.kind) { issue(here, 'member kind changed'); continue; }
      if (member.optional !== next.optional || member.readonly !== next.readonly) issue(here, 'member optionality or readonly semantics changed');
      if (member.visibility !== next.visibility || member.abstract !== next.abstract) issue(here, 'member visibility or abstract semantics changed');
      if (member.type) compareType(member.type, next.type, here);
      if (member.signature && !same(member.signature, next.signature)) issue(here, 'index or accessor signature changed; explicit review is required');
      if (member.signatures) {
        if (member.signatures.length !== next.signatures.length) issue(here, 'overload set changed; explicit review is required');
        member.signatures.forEach((signature, index) => { if (next.signatures[index]) compareSignature(signature, next.signatures[index], `${here}.overload[${index}]`); });
      }
    }
    for (const [name, member] of Object.entries(after)) {
      if (Object.hasOwn(before, name)) continue;
      if (['property', 'method'].includes(member.kind) && !member.optional) issue(`${location}.${name}`, `a required ${member.kind} was added`);
      else if (!['property', 'method'].includes(member.kind)) issue(`${location}.${name}`, 'a new complex member requires explicit review');
    }
  }
  function compareFacet(before, after, location) {
    if (before.kind !== after.kind) { issue(location, 'public symbol kind changed'); return; }
    if (before.abstract !== after.abstract) issue(location, 'class or interface abstract semantics changed');
    if (!same(before.generic, after.generic) || !same(before.heritage, after.heritage)) issue(location, 'generic parameters or inheritance changed');
    if (before.kind === 'alias' && before.target !== after.target) issue(location, 'public alias target changed');
    if (before.readonly !== after.readonly) issue(location, 'export mutability changed');
    if (before.type) compareType(before.type, after.type, location);
    if (before.members) compareMembers(before.members, after.members, location);
    if (before.signatures) {
      if (before.signatures.length !== after.signatures.length) issue(location, 'overload set changed; explicit review is required');
      before.signatures.forEach((signature, index) => { if (after.signatures[index]) compareSignature(signature, after.signatures[index], `${location}.overload[${index}]`); });
    }
  }
  for (const moduleName of ['commonjs', 'esm']) {
    const before = baseline.declarations[moduleName];
    const after = current.declarations[moduleName];
    for (const [name, target] of Object.entries(before.exports)) if (after.exports[name] !== target) issue(`${moduleName}.export.${name}`, 'export or alias target was removed or changed');
    for (const [name, symbol] of Object.entries(before.symbols)) {
      if (!Object.hasOwn(after.symbols, name)) issue(`${moduleName}.${name}`, 'public symbol was removed or renamed');
      else for (const [kind, descriptor] of Object.entries(symbol.facets)) {
        if (!Object.hasOwn(after.symbols[name].facets, kind)) issue(`${moduleName}.${name}`, `public ${kind} facet was removed or changed`);
        else compareFacet(descriptor, after.symbols[name].facets[kind], `${moduleName}.${name}.${kind}`);
      }
    }
  }
  function compareRuntime(before, after, location) {
    if (!after || before.kind !== after.kind) { issue(location, 'runtime export/member was removed or changed'); return; }
    // Function.length is informational; optional parameters are checked through declarations.
    if (before.identity !== after.identity) issue(location, 'runtime export identity changed');
    if (before.members) for (const [name, value] of Object.entries(before.members)) compareRuntime(value, after.members?.[name], `${location}.${name}`);
  }
  compareRuntime(baseline.runtime.constructor, current.runtime.constructor, 'runtime.constructor');
  for (const scope of ['commonjs', 'esm', 'instance']) {
    for (const [name, value] of Object.entries(baseline.runtime[scope])) compareRuntime(value, current.runtime[scope][name], `runtime.${scope}.${name}`);
  }
  return errors;
}

async function main() {
  const config = argumentsFor(process.argv.slice(2));
  const ts = loadTypeScript(config.typescript);
  const current = stable({ schema_version: SCHEMA_VERSION, typescript_version: TYPESCRIPT_VERSION,
    declarations: { commonjs: declarationsFor(ts, 'types/index.d.cts', 'commonjs'), esm: declarationsFor(ts, 'types/index.d.mts', 'esm') },
    runtime: await runtimeFor() });
  if (config.mode === '--write') {
    fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
    console.log('Wrote contracts/node-api.json. Review its diff and compatibility impact before accepting the new baseline.');
    return;
  }
  if (!fs.existsSync(BASELINE)) throw new Error('Missing contracts/node-api.json. A baseline must be created explicitly with --write and reviewed.');
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  if (baseline.schema_version !== SCHEMA_VERSION || baseline.typescript_version !== TYPESCRIPT_VERSION) throw new Error('The compatibility baseline format or TypeScript version is unsupported; review it before updating.');
  const failures = incompatibilities(baseline, current);
  if (failures.length) throw new Error(`Public SDK compatibility failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  console.log('Public SDK compatibility passed (declarations, namespaces, aliases and runtime surface).');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
