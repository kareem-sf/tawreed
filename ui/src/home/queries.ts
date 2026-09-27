import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, must, pageImage, upload, type Project, type SheetView } from "../api/client";

/** How often an open project is asked again while its files are being read. */
export const READING_POLL = 1000;

const ROWS = 200; // sheet rows fetched at a time

export const isReading = (project: Project) =>
  project.sources.some((source) => source.status === "added" || source.status === "reading");

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => must(api.GET("/projects")) });
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => must(api.GET("/projects/{project_id}", { params: { path: { project_id: projectId } } })),
    refetchInterval: (query) => (query.state.data && isReading(query.state.data) ? READING_POLL : false),
  });
}

export function useSource(projectId: string, sourceId: string) {
  return useQuery({
    queryKey: ["source", sourceId],
    queryFn: () =>
      must(
        api.GET("/projects/{project_id}/sources/{source_id}", {
          params: { path: { project_id: projectId, source_id: sourceId } },
        }),
      ),
  });
}

/** A sheet's rows, a window at a time; `fetchNextPage` brings the next window. */
export function useSheet(projectId: string, sourceId: string, page: number) {
  return useInfiniteQuery({
    queryKey: ["sheet", sourceId, page],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) =>
      (await must(
        api.GET("/projects/{project_id}/sources/{source_id}/pages/{number}", {
          params: {
            path: { project_id: projectId, source_id: sourceId, number: page },
            query: { start: pageParam, count: ROWS },
          },
        }),
      )) as SheetView,
    getNextPageParam: (last) => {
      const next = last.first_row + last.rows.length;
      return next <= last.total_rows ? next : undefined;
    },
  });
}

export function usePageImage(projectId: string, sourceId: string, page: number) {
  return useQuery({
    queryKey: ["page-image", sourceId, page],
    queryFn: () => pageImage(projectId, sourceId, page),
    staleTime: Infinity, // a page image never changes
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
