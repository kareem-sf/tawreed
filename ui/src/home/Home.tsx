import { ProjectView } from "./ProjectView";
import { Start } from "./Start";

/** Home: the drop zone, or the open project. */
export function Home({
  projectId,
  onOpen,
  onClose,
  onOpenSettings,
}: {
  projectId: string | null;
  onOpen: (id: string) => void;
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  return projectId ? (
    <ProjectView key={projectId} projectId={projectId} onClose={onClose} onOpenSettings={onOpenSettings} />
  ) : (
    <Start onOpen={onOpen} />
  );
}
