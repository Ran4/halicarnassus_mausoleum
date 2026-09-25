// Adds a shader patch on top of whatever onBeforeCompile a material already has (macro variation, then CSM in main.js).
export function chainPatch(material, key, patch) {
  const prev = material.onBeforeCompile, prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => { if (prev) prev.call(material, shader, r); patch(shader); };
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|' + key;
  return material;
}
