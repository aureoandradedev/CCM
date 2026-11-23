import { readPendingPOs, readRecentSessions } from "@/lib/recebedor/data";
import { RecebedorHome } from "./_home";

export default async function RecebedorPage() {
  const [pos, sessions] = await Promise.all([readPendingPOs(), readRecentSessions()]);
  return <RecebedorHome pos={pos} sessions={sessions} />;
}
