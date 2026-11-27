let gpu: boolean | null = null;

/**
 * Whether this browser gives a hardware WebGL2 context. A software one (SwiftShader, as headless test
 * browsers and machines without a usable GPU get) draws a 3D scene too slowly to animate, so the landing
 * page shows its flat version instead, as CityScene does for the maps. Asked once, then remembered.
 */
export function hasGpuWebGL(): boolean {
  if (gpu !== null) return gpu;
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    gpu = !!gl;
    // give the context back at once: browsers cap how many can be alive
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    gpu = false;
  }
  return gpu;
}
