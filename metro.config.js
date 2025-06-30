// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname, {
  // [Web-only]: Enables CSS support in Metro.
  isCSSEnabled: true,
});

// Ajout du support pour les fichiers TypeScript
config.resolver.sourceExts = ['jsx', 'js', 'ts', 'tsx', 'json'];

// Assurez-vous que les extensions d'assets sont correctement configurées
config.resolver.assetExts = config.resolver.assetExts || [];

// Optimisations pour la stabilité
config.maxWorkers = 2;
config.resetCache = false;
config.transformer.minifierConfig = {
  keep_classnames: true,
  keep_fnames: true,
};

module.exports = config;