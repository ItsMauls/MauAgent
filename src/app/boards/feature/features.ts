// Boards sidebar submenu: one entry per feature (a task can involve many roles). perRole = shows a role picker.
// Tasks, Execution queue and Memory live in the Roles tree (/boards/roles → /boards/[role]).
export const FEATURES = [
  { slug: "publishing", label: "Publishing", icon: "schedule_send", perRole: false, blurb: "Schedule and track posts." },
  { slug: "library", label: "Library", icon: "photo_library", perRole: false, blurb: "Design characters, locations and video styles once, then link them to any upcoming or existing campaign. The Art Director must use the linked items in the shot list and generation prompts." },
  { slug: "artifacts", label: "Artifacts & results", icon: "inventory_2", perRole: true, blurb: "What an agent has produced, how it turned out, and feedback." },
] as const;
