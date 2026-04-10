type StatusHeaderProps = {
  count: number;
  status: string;
  isError: boolean;
};

export function StatusHeader({ count, status, isError }: StatusHeaderProps) {
  return (
    <>
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <h2>Hunks</h2>
        <div className="muted">{count} hunks</div>
      </div>
      <div className="status" style={{ color: isError ? "var(--warn)" : "var(--accent-2)" }}>
        {status}
      </div>
    </>
  );
}
