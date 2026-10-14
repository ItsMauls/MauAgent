// Boards sidebar submenu: one entry per feature (a task can involve many roles). perRole = shows a role picker.
// `roles` = the agents that handle a multi-agent feature; each of them links to it from its dialog ("Works in").
// `menu` = the sidebar menu it sits in (src/app/nav.tsx); the first feature of a menu is that menu's own page.
// Every direct task starts from a feature; the agent dialog (/boards/roles) is for chat, memory, current focus and artifacts.
export const FEATURES = [
  { slug: "text-posts", menu: "posts", label: "Text posts", icon: "edit_note", perRole: false, roles: ["socmed-specialist", "qc"], blurb: "Posts for X and Threads: the Socmed Specialist writes them, QC checks every one, then you approve and schedule." },
  { slug: "concept", menu: "studio", label: "Concept", icon: "tips_and_updates", perRole: false, roles: ["account-manager", "creative-director"], blurb: "From a raw idea to an internal brief, then automatically to three concepts with one pick." },
  { slug: "production-pack", menu: "studio", label: "Production pack", icon: "inventory", perRole: false, roles: ["art-director", "storyboard-artist", "producer", "content-creator"], blurb: "One visual direction becomes a storyboard, a production plan and the prompt packages at once." },
  { slug: "final-delivery", menu: "campaigns", label: "Final delivery", icon: "local_shipping", perRole: false, roles: ["post-production", "qc"], blurb: "One campaign's clips become the final cut and the QC approval package, side by side." },
  { slug: "talent", menu: "studio", label: "Talent hand-off", icon: "face", perRole: false, roles: ["content-creator", "talent-manager"], blurb: "The Content Creator asks for talent, the Talent Manager answers, and the owner locks it." },
  { slug: "execution-queue", menu: "studio", label: "Execution queue", icon: "format_list_numbered", perRole: false, roles: ["content-creator"], blurb: "Shots waiting for footage across all campaigns: copy each prompt, then upload the clip." },
  { slug: "publishing", menu: "posts", label: "Publishing", icon: "schedule_send", perRole: false, roles: ["socmed-specialist", "content-creator"], blurb: "Schedule and track posts." },
  { slug: "library", menu: "briefs", label: "Library", icon: "photo_library", perRole: false, roles: ["content-creator", "art-director"], blurb: "Design characters, locations and video styles once, then link them to any upcoming or existing campaign. The Art Director must use the linked items in the shot list and generation prompts." },
  { slug: "artifacts", menu: "campaigns", label: "Artifacts & results", icon: "inventory_2", perRole: true, roles: [], blurb: "What an agent has produced, how it turned out, and feedback." },
] as const;
