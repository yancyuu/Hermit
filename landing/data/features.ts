import { mdiAccountGroupOutline, mdiViewDashboardOutline, mdiCodeBracesBox, mdiMessageTextOutline, mdiAccountOutline, mdiChartTimelineVariant } from '@mdi/js'

export const features = [
  { id: "agentTeams", icon: mdiAccountGroupOutline, key: "agentTeams", accent: "#00f0ff" },
  { id: "kanban", icon: mdiViewDashboardOutline, key: "kanban", accent: "#ff00ff" },
  { id: "codeReview", icon: mdiCodeBracesBox, key: "codeReview", accent: "#39ff14" },
  { id: "crossTeam", icon: mdiMessageTextOutline, key: "crossTeam", accent: "#ffd700" },
  { id: "soloMode", icon: mdiAccountOutline, key: "soloMode", accent: "#00f0ff" },
  { id: "liveProcesses", icon: mdiChartTimelineVariant, key: "liveProcesses", accent: "#ff00ff" }
] as const;
