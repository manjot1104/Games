const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');
const path = require('path');
 
const config = getDefaultConfig(__dirname);

// Exclude onnxruntime-web from Metro bundling
// It will be loaded from CDN in the HTML instead
// This is necessary because onnxruntime-web uses dynamic imports that Metro can't handle
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver = {
  ...config.resolver,
  resolveRequest: (context, moduleName, platform) => {
    // Exclude onnxruntime-web from bundling - it will be loaded from CDN
    if (moduleName === 'onnxruntime-web' || moduleName.startsWith('onnxruntime-web/')) {
      // Return a stub that will use the global window.ort loaded from CDN
      return {
        filePath: path.resolve(__dirname, 'utils/onnxRuntimeStub.js'),
        type: 'sourceFile',
      };
    }
    // Use default resolution for other modules
    if (originalResolveRequest) {
      return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};
 
module.exports = withNativeWind(config, { input: './app/globals.css' })