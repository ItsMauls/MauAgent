import { redirect } from "next/navigation";

// Character detail lives in the dialog of /boards/roles; old links keep working through this redirect.
export default async function RolePage({ params, searchParams }: { params: Promise<{ role: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ role }, sp] = await Promise.all([params, searchParams]);
  const q = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => e[1] !== undefined));
  q.set("role", role);
  redirect(`/boards/roles?${q}`);
}
