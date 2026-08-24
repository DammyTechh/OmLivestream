module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo is the whole story now.
    //
    // It resolves `@/...` from tsconfig `paths` itself (Metro has read
    // tsconfig paths since SDK 50, so babel-plugin-module-resolver is dead
    // weight), and it auto-appends `react-native-worklets/plugin` when
    // react-native-worklets is installed — which Reanimated 4 requires.
    //
    // Listing 'react-native-reanimated/plugin' by hand here, as this file used
    // to, now double-applies the worklet transform and breaks animations in
    // ways that only show up at runtime.
    presets: ['babel-preset-expo'],
  };
};
