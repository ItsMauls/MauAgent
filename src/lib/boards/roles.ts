// Boards roles: the single list the sidebar, /boards/[role] and the Boards cards read. Add a role = add an entry.

export type BoardRole = {
  slug: string;
  label: string;
  /** Agent role key (Step.agentRole / Artifact.agentRole / persona). Non-LLM roles still get a key for tasks. */
  agentRole: string;
  icon: string;
  blurb: string;
  /** Slug of the previous role in the flow (Roles tree). No parent = root. */
  parent?: string;
  /** Purpose group: the filter on the Agent Roles page and the highlight on the roles page. */
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
  { slug: "socmed-specialist", group: "delivery", parent: "qc", label: "Socmed Specialist", agentRole: "socmedSpecialist", icon: "campaign", blurb: "Strategy, planning and connected accounts." },
  { slug: "content-creator", group: "production", parent: "producer", label: "Content Creator", agentRole: "videographer", icon: "videocam", blurb: "Socmed Officer: prompt packages, shot execution, schedule and publishing." },
  { slug: "talent-manager", group: "creative", parent: "content-creator", label: "Talent Manager", agentRole: "talentManager", icon: "face", blurb: "Characters and talent sheets for the Content Creator." },
  { slug: "account-manager", group: "planning", label: "Account Manager", agentRole: "accountManager", icon: "handshake", blurb: "Turns goals and raw ideas into an internal brief." },
  { slug: "creative-director", group: "planning", parent: "account-manager", label: "Creative Director", agentRole: "creativeDirector", icon: "lightbulb", blurb: "Three concepts, one pick, with reasons." },
  { slug: "art-director", group: "creative", parent: "creative-director", label: "Art Director", agentRole: "artDirector", icon: "brush", blurb: "Visual direction and shot list." },
  { slug: "storyboard-artist", group: "creative", parent: "art-director", label: "Storyboard Artist", agentRole: "storyboardArtist", icon: "view_timeline", blurb: "Turns the Art Director's shot list into timed storyboard panels." },
  { slug: "producer", group: "planning", parent: "art-director", label: "Producer", agentRole: "producer", icon: "request_quote", blurb: "Production plan with a deterministic cost estimate." },
  { slug: "post-production", group: "production", parent: "content-creator", label: "Post-production", agentRole: "postProduction", icon: "movie_edit", blurb: "Edits clips into the final cut." },
  { slug: "post-qc", group: "delivery", parent: "socmed-specialist", label: "Post QC", agentRole: "postQc", icon: "rule", blurb: "Strict check of automation campaign posts before they can be approved." },
  { slug: "qc", group: "delivery", parent: "post-production", label: "QC (Account Team)", agentRole: "accountTeam", icon: "verified", blurb: "Quality check, captions and the approval package." },
];

export const roleBySlug = (slug: string) => ROLES.find((r) => r.slug === slug);
export const roleByAgent = (agentRole: string) => ROLES.find((r) => r.agentRole === agentRole);
