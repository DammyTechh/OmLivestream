module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Lets `@/...` resolve the same way it does in tsconfig paths.
      ['module-resolver', { alias: { '@': './src' }, extensions: ['.ts', '.tsx', '.js', '.json'] }],
      // Must stay last — Reanimated requires it.
      'react-native-reanimated/plugin',
    ],
  };
};
