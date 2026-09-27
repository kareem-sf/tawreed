import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, must, upload, type Project } from "../api/client";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => must(api.GET("/projects")) });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => must(api.GET("/projects/{project_id}", { params: { path: { project_id: projectId } } })),
  });
}

function useKeep() {
  const client = useQueryClient();
  return (project: Project) => {
    client.setQueryData(["project", project.id], project);
    void client.invalidateQueries({ queryKey: ["projects"] });
  };
}

/** Start a project from dropped files. */
export function useStartProject() {
  const keep = useKeep();
  return useMutation({ mutationFn: (files: File[]) => upload("/projects", files), onSuccess: keep });
}

/** Add dropped files to an open project. */
export function useAddFiles(projectId: string) {
  const keep = useKeep();
  return useMutation({ mutationFn: (files: File[]) => upload(`/projects/${projectId}/sources`, files), onSuccess: keep });
}

export function useRename(projectId: string) {
  const keep = useKeep();
  return useMutation({
    mutationFn: (name: string) =>
      must(api.PATCH("/projects/{project_id}", { params: { path: { project_id: projectId } }, body: { name } })),
    onSuccess: keep,
  });
}
