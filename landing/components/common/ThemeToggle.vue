<script setup lang="ts">
import { mdiWeatherSunny, mdiWeatherNight } from '@mdi/js';

const { t } = useI18n();
const { isDark, toggleTheme } = useBrowserTheme();
const { trackThemeToggle } = useAnalytics();

const tooltip = computed(() => isDark.value ? t('theme.light') : t('theme.dark'));

const onToggle = () => {
  toggleTheme();
  trackThemeToggle(isDark.value ? 'dark' : 'light');
};
</script>

<template>
  <ClientOnly>
    <v-tooltip :text="tooltip" location="bottom">
      <template #activator="{ props }">
        <v-btn
          v-bind="props"
          :icon="isDark ? mdiWeatherSunny : mdiWeatherNight"
          variant="text"
          size="small"
          :aria-label="tooltip"
          @click="onToggle"
        />
      </template>
    </v-tooltip>
    <template #fallback>
      <v-btn
        :icon="mdiWeatherSunny"
        variant="text"
        size="small"
        aria-label="Toggle theme"
      />
    </template>
  </ClientOnly>
</template>
