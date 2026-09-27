import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, must, revisionZip, succeed, type Answer } from "../api/client";

/** How often an open project's work is asked for: often while the agent works, calmly otherwise. */
export const WORKING_POLL = 1000;
export const IDLE_POLL = 3000;

export function useWork(projectId: string) {
  return useQuery({
    queryKey: ["work", projectId],
    queryFn: () => must(api.GET("/projects/{project_id}/work", { params: { path: { project_id: projectId } } })),
    refetchInterval: (query) => (query.state.data?.agent === "working" ? WORKING_POLL : IDLE_POLL),
  });
}

export type ItemFilter = { package_id?: string; unplaced?: boolean };

export function useItems(projectId: string, filter: ItemFilter, enabled = true) {
  return useQuery({
    queryKey: ["items", projectId, filter],
    queryFn: () =>
      must(
        api.GET("/projects/{project_id}/items", {
          params: { path: { project_id: projectId }, query: { ...filter, count: 1000 } },
        }),
      ),
    enabled,
  });
}

function useRefresh(projectId: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ["work", projectId] });
    void client.invalidateQueries({ queryKey: ["items", projectId] });
  };
}

export function useSend(projectId: string) {
  const onSuccess = useRefresh(projectId);
  return useMutation({
    mutationFn: (text: string) =>
      must(api.POST("/projects/{project_id}/messages", { params: { path: { project_id: projectId } }, body: { text } })),
    onSuccess,
  });
}

export function useStop(projectId: string) {
  const onSuccess = useRefresh(projectId);
  return useMutation({
    mutationFn: () => succeed(api.POST("/projects/{project_id}/stop", { params: { path: { project_id: projectId } } })),
    onSuccess,
  });
}

export function useAnswer(projectId: string) {
  const onSuccess = useRefresh(projectId);
  return useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: Answer }) =>
      succeed(
        api.POST("/projects/{project_id}/decisions/{decision_id}", {
          params: { path: { project_id: projectId, decision_id: id } },
          body: answer,
        }),
      ),
    onSuccess,
  });
}

/** The engineer's direct edits to the packages. */
export function useEdits(projectId: string) {
  const onSuccess = useRefresh(projectId);
  const project = { params: { path: { project_id: projectId } } };
  const one = (id: string) => ({ params: { path: { project_id: projectId, package_id: id } } });
  return {
    create: useMutation({
      mutationFn: (name: string) =>
        must(api.POST("/projects/{project_id}/packages", { ...project, body: { name, scope: "" } })),
      onSuccess,
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        must(api.PATCH("/projects/{project_id}/packages/{package_id}", { ...one(id), body: { name } })),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: (id: string) => succeed(api.DELETE("/projects/{project_id}/packages/{package_id}", one(id))),
      onSuccess,
    }),
    merge: useMutation({
      mutationFn: ({ into, from }: { into: string; from: string }) =>
        succeed(
          api.POST("/projects/{project_id}/packages/{package_id}/merge", { ...one(into), body: { package_ids: [from] } }),
        ),
      onSuccess,
    }),
    place: useMutation({
      mutationFn: ({ itemIds, packageId }: { itemIds: string[]; packageId: string }) =>
        succeed(
          api.POST("/projects/{project_id}/placements", {
            ...project,
            body: { item_ids: itemIds, package_id: packageId },
          }),
        ),
      onSuccess,
    }),
  };
}

export function useRevisions(projectId: string, published: string | undefined) {
  return useQuery({
    queryKey: ["revisions", projectId, published], // asked again when a new revision is published
    queryFn: () =>
      must(api.GET("/projects/{project_id}/revisions", { params: { path: { project_id: projectId } } })),
    enabled: Boolean(published),
  });
}

export function useOpenRevision(projectId: string) {
  return useMutation({
    mutationFn: (number: number) =>
      succeed(
        api.POST("/projects/{project_id}/revisions/{number}/open", {
          params: { path: { project_id: projectId, number } },
        }),
      ),
  });
}

/** Save a revision's files as a zip, wherever the engineer's browser or Tawreed's window saves downloads. */
export function useExportRevision(projectId: string) {
  return useMutation({
    mutationFn: async ({ number, filename }: { number: number; filename: string }) => {
      const url = URL.createObjectURL(await revisionZip(projectId, number));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    },
  });
}
