import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, must, succeed, type Provider } from "../api/client";

export const PROVIDERS: Provider[] = ["anthropic", "openai", "google", "xai", "openai_compatible"];

export function useConnections() {
  return useQuery({ queryKey: ["connections"], queryFn: () => must(api.GET("/ai/connections")) });
}

export function useModels(connectionId: string) {
  return useQuery({
    queryKey: ["connections", connectionId, "models"],
    queryFn: () =>
      must(api.GET("/ai/connections/{connection_id}/models", { params: { path: { connection_id: connectionId } } })),
  });
}

function useRefresh(...keys: string[]) {
  const client = useQueryClient();
  return () => Promise.all(keys.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

export function useAddConnection() {
  const refresh = useRefresh("connections");
  return useMutation({
    mutationFn: (body: { provider: Provider; api_key: string; base_url: string | null }) =>
      must(api.POST("/ai/connections", { body })),
    onSuccess: refresh,
  });
}

export function useRemoveConnection() {
  const refresh = useRefresh("connections", "settings");
  return useMutation({
    mutationFn: async (connectionId: string) => {
      const result = await api.DELETE("/ai/connections/{connection_id}", {
        params: { path: { connection_id: connectionId } },
      });
      if (!result.response.ok) await must(Promise.resolve(result));
    },
    onSuccess: refresh,
  });
}

export function useCheckModel(connectionId: string) {
  const refresh = useRefresh("connections");
  return useMutation({
    mutationFn: (model: string) =>
      must(
        api.POST("/ai/connections/{connection_id}/checks", {
          params: { path: { connection_id: connectionId } },
          body: { model },
        }),
      ),
    onSuccess: refresh,
  });
}

/** Placements the engineer chose to apply to every project. */
export function useRules() {
  return useQuery({ queryKey: ["rules"], queryFn: () => must(api.GET("/rules")) });
}

export function useForgetRule() {
  const refresh = useRefresh("rules");
  return useMutation({
    mutationFn: (ruleId: string) => succeed(api.DELETE("/rules/{rule_id}", { params: { path: { rule_id: ruleId } } })),
    onSuccess: refresh,
  });
}
