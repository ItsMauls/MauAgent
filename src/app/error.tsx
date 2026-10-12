"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="card mx-auto mt-8 max-w-xl p-8 text-center">
      <span className="material-symbols-outlined !text-[40px] text-bad">error</span>
      <h1 className="mt-2 text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-2">{error.message || "The page could not be loaded."}</p>
      <button onClick={reset} className="btn-primary mt-6">Try again</button>
    </div>
  );
}
