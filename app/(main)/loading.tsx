export default function MainLoading() {
  return (
    <div
      className="grid animate-pulse gap-5"
      aria-label="Loading AttendSafe"
      role="status"
    >
      <div className="bg-secondary h-32 rounded-3xl" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="bg-secondary h-28 rounded-2xl" />
        ))}
      </div>
      <div className="bg-secondary h-72 rounded-2xl" />
      <span className="sr-only">Loading your local attendance data…</span>
    </div>
  );
}
