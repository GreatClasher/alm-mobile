const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Path alias resolution for @/ → src/
config.resolver.extraNodeModules = {
  '@': path.resolve(__dirname, 'src'),
};

config.resolver.sourceExts.push('mjs');

module.exports = config;
