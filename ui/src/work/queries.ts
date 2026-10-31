import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, must, revisionZip, succeed, type Answer, type SheetLayout, type Work } from "../api/client";

/** How often an open project's work is asked for: often while a step runs, calmly otherwise. */
export const WORKING_POLL = 1000;
export const IDLE_POLL = 3000;

/** Whether the project's items may have moved between two answers: a step placed some, or finished. */
const itemsMoved = (before: Work, now: Work) =>
  before.run.state !== now.run.state ||
  before.coverage.items !== now.coverage.items ||
  before.coverage.placed !== now.coverage.placed ||
  before.coverage.unplaced !== now.coverage.unplaced ||
  before.coverage.waiting !== now.coverage.waiting;

function workQuery(client: ReturnType<typeof useQueryClient>, projectId: string) {
  return {
    queryKey: ["work", projectId],
    queryFn: async () => {
      const now = await must(api.GET("/projects/{project_id}/work", { params: { path: { project_id: projectId } } }));
      // Open item lists follow the work as it happens, without polling the lists themselves.
      const before = client.getQueryData<Work>(["work", projectId]);
      if (before && itemsMoved(before, now)) void client.invalidateQueries({ queryKey: ["items", projectId] });
      return now;
    },
    refetchInterval: (query: { state: { data?: Work } }) =>
      query.state.data?.run.state === "running" ? WORKING_POLL : IDLE_POLL,
  };
}

/** The whole work, progress included: it changes every second while a step runs, so only what shows that
 *  progress should read it. */
export function useWork(projectId: string) {
  return useQuery(workQuery(useQueryClient(), projectId));
}

/** Only the part of the work that `select` returns: the screen re-renders when that part changes, not on every
 *  poll. (Equal answers keep the same object, so a slice that did not change does not render again.) */
export function useWorkPart<T>(projectId: string, select: (work: Work) => T) {
  return useQuery({ ...workQuery(useQueryClient(), projectId), select });
}

/** What a project page needs apart from the running step's progress. */
export const withoutProgress = ({ run, ...rest }: Work) => ({ ...rest, running: run.state === "running" });
export type WorkPlan = ReturnType<typeof withoutProgress>;

export type ItemFilter = { package_id?: string; unplaced?: boolean };

const ITEMS = 200; // items fetched at a time

/** A group's items, a window at a time: `fetchNextPage` brings the next window; `total` is how many there are. */
export function useItems(projectId: string, filter: ItemFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["items", projectId, filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      must(
        api.GET("/projects/{project_id}/items", {
          params: { path: { project_id: projectId }, query: { ...filter, start: pageParam, count: ITEMS } },
        }),
      ),
    getNextPageParam: (_last, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < (pages.at(-1)?.total ?? 0) && pages.at(-1)?.items.length ? loaded : undefined;
    },
    enabled,
  });
}

/** After a change: ask again for what it changed. Mutations return this promise from onSuccess, so they stay
 *  pending until the new state is on screen, and a button can't be pressed twice against the old one. */
function useRefresh(projectId: string) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["work", projectId] }),
      client.invalidateQueries({ queryKey: ["project", projectId] }),
      client.invalidateQueries({ queryKey: ["projects"] }),
      client.invalidateQueries({ queryKey: ["items", projectId] }),
      client.invalidateQueries({ queryKey: ["source"] }),
    ]);
}

/** Stop the running step, carry on after a pause, or ask for the publish card again. */
export function useRun(projectId: string) {
  const onSuccess = useRefresh(projectId);
  const project = { params: { path: { project_id: projectId } } };
  return {
    stop: useMutation({ mutationFn: () => succeed(api.POST("/projects/{project_id}/stop", project)), onSuccess }),
    carryOn: useMutation({ mutationFn: () => succeed(api.POST("/projects/{project_id}/continue", project)), onSuccess }),
    publish: useMutation({ mutationFn: () => succeed(api.POST("/projects/{project_id}/publish", project)), onSuccess }),
  };
}

export type Redo =
  | { step: "read"; source_id: string; page?: number; note?: string }
  | { step: "place"; package_id?: string; note?: string };

/** Run a step again, with the engineer's note for the AI. */
export function useRedo(projectId: string) {
  const onSuccess = useRefresh(projectId);
  return useMutation({
    mutationFn: (body: Redo) =>
      succeed(api.POST("/projects/{project_id}/redo", { params: { path: { project_id: projectId } }, body })),
    onSuccess,
  });
}

/** The engineer's own reading of a page: a sheet's columns, or that it lists no items. */
export function useLayouts(projectId: string, sourceId: string) {
  const onSuccess = useRefresh(projectId);
  const page = (number: number) => ({ params: { path: { project_id: projectId, source_id: sourceId, number } } });
  return {
    columns: useMutation({
      mutationFn: ({ number, layout }: { number: number; layout: SheetLayout }) =>
        succeed(api.PUT("/projects/{project_id}/sources/{source_id}/pages/{number}/layout", { ...page(number), body: layout })),
      onSuccess,
    }),
    setAside: useMutation({
      mutationFn: ({ number, reason }: { number: number; reason: string }) =>
        succeed(
          api.POST("/projects/{project_id}/sources/{source_id}/pages/{number}/set-aside", {
            ...page(number),
            body: { reason },
          }),
        ),
      onSuccess,
    }),
  };
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
      // WebKitGTK and Firefox only follow a link that is in the page; the file is read once the click has been handled.
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
}
