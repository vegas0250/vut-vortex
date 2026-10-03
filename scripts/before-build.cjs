// VUI and the renderer are already inside the Vite bundles.
// Returning false tells electron-builder not to copy node_modules into the asar.
module.exports = async function beforeBuild() {
  return false;
};
