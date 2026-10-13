"use client";

import { ErrorText, useAction } from "../ui";
import { setChannelDefault, setChannelEnabled } from "./actions";

export function ChannelControls({ id, active, isDefault, missing }: { id: string; active: boolean; isDefault: boolean; missing: boolean }) {
  const { pending, error, run } = useAction();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
      <label className="flex items-center gap-2 text-xs font-semibold">
        <input type="checkbox" checked={active} disabled={pending || missing} onChange={(e) => run(() => setChannelEnabled(id, e.target.checked))} className="h-4 w-4 accent-brand" />
        Enabled
      </label>
      <label className="flex items-center gap-2 text-xs font-semibold">
        <input type="checkbox" checked={isDefault} disabled={pending || !active} onChange={(e) => run(() => setChannelDefault(id, e.target.checked))} className="h-4 w-4 accent-brand" />
        Platform default
      </label>
      </div>
      <ErrorText error={error} />
    </div>
  );
}
