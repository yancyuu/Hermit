import type { PlatformArch, PlatformOs } from "~/types/platform";

export const detectPlatform = (userAgent: string): PlatformOs => {
  const ua = userAgent.toLowerCase();
  if (ua.includes("mac")) return "macos";
  if (ua.includes("win")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "unknown";
};

export const detectMacArch = (userAgent: string): PlatformArch => {
  const ua = userAgent.toLowerCase();
  if (ua.includes("arm") || ua.includes("aarch64")) return "arm64";

  // Браузеры на Apple Silicon всё равно шлют "Intel Mac OS X" в UA,
  // поэтому проверяем GPU через WebGL — Apple Silicon репортится как "Apple M1/M2/..."
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          const renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string;
          if (/apple\s*m\d|apple\s*gpu/i.test(renderer)) return "arm64";
        }
      }
    } catch {
      // WebGL недоступен — fallback на x64
    }
  }

  return "x64";
};
