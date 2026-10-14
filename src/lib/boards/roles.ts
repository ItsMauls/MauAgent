// Boards roles: the single list the sidebar, /boards/[role] and the Boards cards read. Add a role = add an entry.

export type RoleTab = "accounts" | "ready" | "queue" | "schedule" | "library" | "talent";

export type BoardRole = {
  slug: string;
  label: string;
  /** Agent role key (Step.agentRole / Artifact.agentRole / persona). Non-LLM roles still get a key for tasks. */
  agentRole: string;
  icon: string;
  blurb: string;
  /** Role-specific tabs that reuse existing pages/components. */
  tabs: RoleTab[];
  /** Slug of the previous role in the flow (Roles tree). No parent = root. */
  parent?: string;
  /** Purpose group: the sidebar submenu under Agent Roles and the highlight on the roles page. */
  group: RoleGroup;
};

export const GROUPS = [
  { slug: "planning", label: "Planning", icon: "event_note" },
  { slug: "creative", label: "Creative", icon: "palette" },
  { slug: "production", label: "Production", icon: "movie" },
  { slug: "delivery", label: "Delivery", icon: "local_shipping" },
] as const;
export type RoleGroup = (typeof GROUPS)[number]["slug"];

export const ROLES: BoardRole[] = [
  { slug: "socmed-specialist", group: "delivery", parent: "qc", label: "Socmed Specialist", agentRole: "socmedSpecialist", icon: "campaign", blurb: "Strategy, planning and connected accounts.", tabs: ["accounts"] },
  { slug: "content-creator", group: "production", parent: "producer", label: "Content Creator", agentRole: "videographer", icon: "videocam", blurb: "Socmed Officer: prompt packages, shot execution, schedule and publishing.", tabs: ["ready", "queue", "schedule", "library"] },
  { slug: "talent-manager", group: "creative", parent: "content-creator", label: "Talent Manager", agentRole: "talentManager", icon: "face", blurb: "Characters and talent sheets for the Content Creator.", tabs: ["talent"] },
  { slug: "account-manager", group: "planning", label: "Account Manager", agentRole: "accountManager", icon: "handshake", blurb: "Turns goals and raw ideas into an internal brief.", tabs: [] },
  { slug: "creative-director", group: "planning", parent: "account-manager", label: "Creative Director", agentRole: "creativeDirector", icon: "lightbulb", blurb: "Three concepts, one pick, with reasons.", tabs: [] },
  { slug: "art-director", group: "creative", parent: "creative-director", label: "Art Director", agentRole: "artDirector", icon: "brush", blurb: "Visual direction and shot list.", tabs: [] },
  { slug: "storyboard-artist", group: "creative", parent: "art-director", label: "Storyboard Artist", agentRole: "storyboardArtist", icon: "view_timeline", blurb: "Turns the Art Director's shot list into timed storyboard panels.", tabs: [] },
  { slug: "producer", group: "planning", parent: "art-director", label: "Producer", agentRole: "producer", icon: "request_quote", blurb: "Production plan with a deterministic cost estimate.", tabs: [] },
  { slug: "post-production", group: "production", parent: "content-creator", label: "Post-production", agentRole: "postProduction", icon: "movie_edit", blurb: "Edits clips into the final cut.", tabs: [] },
  { slug: "qc", group: "delivery", parent: "post-production", label: "QC (Account Team)", agentRole: "accountTeam", icon: "verified", blurb: "Quality check, captions and the approval package.", tabs: [] },
];

export const roleBySlug = (slug: string) => ROLES.find((r) => r.slug === slug);
export const roleByAgent = (agentRole: string) => ROLES.find((r) => r.agentRole === agentRole);
