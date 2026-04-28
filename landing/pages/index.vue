<script setup lang="ts">
usePageSeo("meta.homeTitle", "meta.homeDescription");
useTrackSections();
const { containerRef } = useParallaxSections();
</script>

<template>
  <div ref="containerRef" class="page">
    <PageBackground />
    <HeroSection />
    <SectionDivider />
    <LazyScreenshotsSection />
    <SectionDivider :flip="true" />
    <LazyDownloadSection />
    <SectionDivider />
    <LazyComparisonSection />
    <SectionDivider :flip="true" />
    <LazyPricingSection />
    <SectionDivider />
    <LazyFAQSection />
    <!-- <LazyFeaturesSection /> -->
    <!-- <LazyTestimonialsSection /> -->
  </div>
</template>
