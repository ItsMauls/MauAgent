"use client";

import { useState, useTransition } from "react";
import { testAiConnection, type TestResult } from "./actions";

export function TestConnection() {
  const [pending, start] = useTransition();
  const [r, setR] = useState<TestResult | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} className="btn-soft" onClick={() => start(async () => setR(await testAiConnection()))}>
        <span className="material-symbols-outlined">network_check</span>
        {pending ? "Testing…" : "Test connection"}
      </button>
      {r && <span className={`text-sm ${r.ok ? "text-ok" : "text-bad"}`}>{r.message}</span>}
    </div>
  );
}
