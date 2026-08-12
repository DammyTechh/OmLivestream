export function Spinner({ size = 24 }: { size?: number }) {
  return <div className="border-2 border-border border-t-primary rounded-full animate-spin" style={{ width: size, height: size }} />;
}
