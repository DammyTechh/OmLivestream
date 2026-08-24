/**
 * Refuse to start on a Node version Expo cannot use.
 *
 * Node 22 introduced experimental TypeScript type-stripping and Node 24
 * enabled it by default. Expo's bundler imports `expo-modules-core/src/index.ts`
 * directly, and Node refuses to strip types from anything inside node_modules —
 * so the whole toolchain dies with:
 *
 *   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *
 * That message names a file deep in node_modules and mentions neither Expo nor
 * Node versions, so it reads like a broken install. It is not: reinstalling
 * cannot fix it. This check turns a confusing crash into an instruction.
 */
const major = Number(process.versions.node.split('.')[0]);

if (major < 20 || major >= 22) {
  const bar = '─'.repeat(64);
  console.error(`\n\x1b[31m${bar}\x1b[0m`);
  console.error(`\x1b[31m  Wrong Node version: v${process.versions.node}\x1b[0m`);
  console.error(`\x1b[31m${bar}\x1b[0m\n`);
  console.error('  Expo needs Node 20. Node 22+ breaks the bundler.\n');
  console.error('  Windows:');
  console.error('    1. where.exe node          <- if this lists a path outside');
  console.error('       nvm, uninstall "Node.js" from Add or Remove Programs');
  console.error('    2. Open PowerShell AS ADMINISTRATOR');
  console.error('    3. nvm install 20.18.0');
  console.error('    4. nvm use 20.18.0');
  console.error('    5. node --version          <- must print v20.x\n');
  console.error('  macOS / Linux:');
  console.error('    nvm install 20 && nvm use 20\n');
  console.error('  Then: npm install\n');
  process.exit(1);
}

console.log(`\x1b[32m✓ Node v${process.versions.node}\x1b[0m`);
