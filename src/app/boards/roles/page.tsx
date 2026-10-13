import Link from "next/link";
import { ROLES, roleBySlug, type BoardRole } from "@/lib/boards/roles";
import { agentNames, boardSnapshot } from "@/lib/boards/snapshot";
import { roleWork } from "@/lib/boards/status";
import { initials, STATE_PILL } from "../cards";
import { RouteDialog } from "../modal";
import { RoleDetail } from "./detail";

export const dynamic = "force-dynamic";

type Info = { names: Record<string, string>; snap: Awaited<ReturnType<typeof boardSnapshot>> };

function Card({ role, info }: { role: BoardRole; info: Info }) {
  const name = info.names[role.agentRole] ?? role.label;
  const [stateLabel, stateCls] = STATE_PILL[roleWork(role.agentRole, info.snap).state];
  return (
    <Link href={`/boards/roles?role=${role.slug}`} scroll={false} className="card flex h-36 w-full min-w-0 flex-col items-center justify-center gap-1.5 p-3 text-center transition hover:bg-brand-soft">
      <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-agent-soft text-lg font-bold text-violet-700">{initials(name)}</span>
      <span className="w-full truncate font-bold">{name}</span>
      <span className="w-full truncate text-xs text-ink-2">
        <span className="material-symbols-outlined !text-[14px] align-[-2px]">{role.icon}</span> {role.label}
      </span>
      <span className={`pill !px-2 !py-0.5 !text-[10px] ${stateCls}`}>{stateLabel}</span>
    </Link>
  );
}

const PER_ROW = 4;
const kidsOf = (r: BoardRole) => ROLES.filter((k) => k.parent === r.slug);
/** Main flow: from the root, follow the child that continues the chain; the other children are side branches. */
function mainChain() {
  const chain: BoardRole[] = [];
  for (let cur: BoardRole | undefined = ROLES.find((r) => !r.parent); cur; ) {
    chain.push(cur);
    const kids = kidsOf(cur);
    cur = kids.find((k) => kidsOf(k).length) ?? kids[0];
  }
  return chain;
}

/** Animated connector: `dir` is the direction the stream flows (the dashes move that way). */
function Stream({ dir, grow }: { dir: "right" | "left" | "down"; grow?: boolean }) {
  const icon = { right: "chevron_right", left: "chevron_left", down: "keyboard_arrow_down" }[dir];
  return (
    <span aria-hidden className={`flex items-center text-slate-400 ${dir === "down" ? `flex-col ${grow ? "min-h-10 flex-1" : "h-10"}` : "h-36 flex-row"} ${dir === "left" ? "flex-row-reverse" : ""}`}>
      <span className={`flow flow-${dir} ${dir === "down" ? "w-0.5 flex-1" : "h-0.5 flex-1"}`} />
      <span className="material-symbols-outlined !text-[22px] leading-none">{icon}</span>
    </span>
  );
}

function Branches({ role, info }: { role: BoardRole; info: Info }) {
  const next = kidsOf(role).find((k) => kidsOf(k).length) ?? kidsOf(role)[0];
  return (
    <>
      {kidsOf(role).filter((k) => k !== next).map((s) => (
        <div key={s.slug} className="mt-2 flex w-full flex-col items-center">
          <Stream dir="down" />
          <Card role={s} info={info} />
          <Branches role={s} info={info} />
        </div>
      ))}
    </>
  );
}

const COLS = "grid grid-cols-[1fr_3rem_1fr_3rem_1fr_3rem_1fr] items-start";

function Rows({ info }: { info: Info }) {
  const chain = mainChain();
  const rows = Array.from({ length: Math.ceil(chain.length / PER_ROW) }, (_, i) => chain.slice(i * PER_ROW, (i + 1) * PER_ROW));
  return (
    <div className="space-y-1">
      {rows.map((row, r) => {
        const rtl = r % 2 === 1; // odd rows flow right to left (snake)
        const col = (j: number) => 2 * (rtl ? PER_ROW - 1 - j : j) + 1;
        return (
          <div key={r}>
            <div className={COLS}>
              {row.map((role, j) => (
                <div key={role.slug} style={{ gridColumn: col(j), gridRow: 1 }} className={`flex min-w-0 flex-col items-center ${j === row.length - 1 && r < rows.length - 1 ? "self-stretch" : ""}`}>
                  <Card role={role} info={info} />
                  <Branches role={role} info={info} />
                  {/* Arrow to the next row starts right under this card and stretches to the row's bottom. */}
                  {j === row.length - 1 && r < rows.length - 1 && <Stream dir="down" grow />}
                </div>
              ))}
              {row.slice(1).map((role, j) => (
                <div key={`s-${role.slug}`} style={{ gridColumn: rtl ? col(j) - 1 : col(j) + 1, gridRow: 1 }}>
                  <Stream dir={rtl ? "left" : "right"} />
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default async function RolesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [sp, names, snap] = await Promise.all([searchParams, agentNames(), boardSnapshot()]);
  const open = roleBySlug(sp.role ?? "");
  return (
    <div className="space-y-6 pt-4">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Agent Roles</h1>
        <p className="text-sm text-ink-2">The agents in flow order. Click one for its tasks, execution queue and memory.</p>
      </header>
      <div>
        <Rows info={{ names, snap }} />
      </div>
      {open && (
        <RouteDialog key={open.slug} title={names[open.agentRole] ?? open.label} closeHref="/boards/roles">
          <RoleDetail slug={open.slug} sp={sp} />
        </RouteDialog>
      )}
    </div>
  );
}
