import { defineStore } from "pinia";

type ThemeName = "light" | "dark";

export const useThemeStore = defineStore("theme", {
  state: () => ({
    current: "dark" as ThemeName,
    userSelected: false
  }),
  actions: {
    getInitialTheme(): ThemeName {
      if (!process.client) return "dark";
      const saved = localStorage.getItem("theme");
      if (saved === "dark" || saved === "light") {
        this.userSelected = true;
        return saved;
      }
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
      return "dark";
    },
    setTheme(theme: ThemeName, fromUser: boolean) {
      this.current = theme;
      if (process.client && fromUser) {
        this.userSelected = true;
        localStorage.setItem("theme", theme);
      }
    }
  }
});
