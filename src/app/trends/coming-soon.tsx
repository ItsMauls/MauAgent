export function ComingSoon({ platform }: { platform: string }) {
  return (
    <div className="pt-4">
      <h1 className="text-3xl font-bold tracking-tight">{platform} Trends</h1>
      <p className="card mt-6 p-8 text-center text-ink-2">No trend source is connected for {platform} yet.</p>
    </div>
  );
}
