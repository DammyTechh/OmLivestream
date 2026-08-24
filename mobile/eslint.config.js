// ESLint 9 flat config. `eslint-config-expo` ships the TypeScript, React and
// React Native rules that used to require four separate devDependencies.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*', 'ios/*', 'android/*', '.expo/*'] },
]);
