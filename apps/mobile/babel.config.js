module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 moved this plugin into react-native-worklets. It has to stay last
    // in the list, so add any future plugins above it.
    plugins: ['react-native-worklets/plugin'],
  };
};
