export function StatTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color: color ?? "#2E253A" }}>
        {value}
      </p>
    </div>
  );
}
