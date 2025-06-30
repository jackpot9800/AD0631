// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname, {
  // [Web-only]: Enables CSS support in Metro.
  isCSSEnabled: true,
});

// Add support for TypeScript files
config.resolver.sourceExts.push('ts', 'tsx');

// Add support for all file extensions supported by Expo
config.resolver.assetExts = config.resolver.assetExts || [];
config.resolver.sourceExts = config.resolver.sourceExts || [];

module.exports = config;