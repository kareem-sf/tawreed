import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, must, pageImage, succeed, upload, type Project, type SheetView } from "../api/client";

/** How often an open project is asked again while its files are being read. */
export const READING_POLL = 1000;

const ROWS = 200; // sheet rows fetched at a time

/** A window of sheet rows: where it starts, and how many rows it holds. */
type Window = { start: number; count: number };

export const isReading = (project: Project) =>
  project.sources.some((source) => source.status === "added" || source.status === "reading");

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: () => must(api.GET("/projects")) });
}

/** `working`: a step is running on the project, which changes its files' status and its name list, so ask again. */
export function useProject(projectId: string, working = false) {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: () => must(api.GET("/projects/{project_id}", { params: { path: { project_id: projectId } } })),
    refetchInterval: (query) => (working || (query.state.data && isReading(query.state.data)) ? READING_POLL : false),
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

/** A sheet's rows from row `from`, a window at a time; `fetchNextPage` brings the next window. */
export function useSheet(projectId: string, sourceId: string, page: number, from = 1) {
  return useInfiniteQuery({
    queryKey: ["sheet", sourceId, page, from],
    initialPageParam: { start: from, count: ROWS } as Window,
    queryFn: async ({ pageParam }): Promise<SheetView> => {
      const view = await must(
        api.GET("/projects/{project_id}/sources/{source_id}/pages/{number}", {
          params: {
            path: { project_id: projectId, source_id: sourceId, number: page },
            query: pageParam,
          },
        }),
      );
      if (!("rows" in view)) throw new ApiError("unknown"); // a sheet page always answers with rows
      return view;
    },
    getNextPageParam: (last): Window | undefined => {
      const next = last.first_row + last.rows.length;
      return next <= last.total_rows ? { start: next, count: ROWS } : undefined;
    },
    // A sheet opened at a marked row starts a few rows above it: the rows before are one step back.
    getPreviousPageParam: (first): Window | undefined => {
      if (first.first_row <= 1) return undefined;
      const start = Math.max(1, first.first_row - ROWS);
      return { start, count: first.first_row - start };
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

/** Delete a project and everything Tawreed keeps for it; the projects list forgets it. */
export function useDeleteProject(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => succeed(api.DELETE("/projects/{project_id}", { params: { path: { project_id: projectId } } })),
    onSuccess: () => {
      client.removeQueries({ queryKey: ["project", projectId] });
      void client.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useRename(projectId: string) {
  const keep = useKeep();
  return useMutation({
    mutationFn: (name: string) =>
      must(api.PATCH("/projects/{project_id}", { params: { path: { project_id: projectId } }, body: { name } })),
    onSuccess: keep,
  });
}
