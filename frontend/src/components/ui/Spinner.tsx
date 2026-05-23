export function Spinner({ size = 24 }: { size?: number }) {
  return <div className="border-2 border-primary/20 border-t-primary rounded-full animate-spin" style={{ width: size, height: size }} />;
}
