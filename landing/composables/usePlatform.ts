import { computed, onMounted, ref } from "vue";
import { detectMacArch, detectPlatform } from "~/utils/platform";

export const usePlatform = () => {
  const platform = ref("unknown");
  const arch = ref("unknown");

  onMounted(() => {
    const ua = navigator.userAgent;
    platform.value = detectPlatform(ua);
    if (platform.value === "macos") {
      arch.value = detectMacArch(ua);
    }
  });

  const label = computed(() => {
    if (platform.value === "macos") return "macOS";
    if (platform.value === "windows") return "Windows";
    if (platform.value === "linux") return "Linux";
    return "your OS";
  });

  return { platform, arch, label };
};
