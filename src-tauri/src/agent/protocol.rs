use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Mutex;
use std::task::{Context, Poll};
use tokio::sync::oneshot;

pub const JSONRPC_VERSION: &str = "2.0";
pub const KERNEL_PROTOCOL_VERSION: u64 = 1;
pub const KERNEL_INITIALIZE_METHOD: &str = "kernel.initialize";
pub const KERNEL_HEALTH_METHOD: &str = "kernel.health";
pub const TURNS_CANCEL_METHOD: &str = "turns.cancel";
const AGENT_EVENT_METHOD: &str = "agent.event";
// JavaScript `Number.MAX_SAFE_INTEGER`: request ids must stay routable on the Node side.
pub const MAX_SAFE_REQUEST_ID: u64 = 9_007_199_254_740_991;
const MAX_SHORT_FIELD_CHARACTERS: usize = 160;
const MAX_EVENT_PAYLOAD_BYTES: usize = 256 * 1024;

#[derive(Debug, Serialize)]
pub struct AgentRequest {
    pub jsonrpc: &'static str,
    pub id: u64,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Deserialize)]
pub struct AgentResponse {
    pub jsonrpc: String,
    pub id: u64,
    pub result: Option<Value>,
    pub error: Option<AgentError>,
}

#[derive(Debug, Deserialize)]
pub struct AgentError {
    pub code: String,
    // The envelope carries both strings; routing propagates only the stable code.
    #[allow(dead_code)]
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentNotification {
    pub jsonrpc: String,
    pub method: String,
    pub params: Value,
}

/// What a single accepted stdout line produced.
#[derive(Debug, PartialEq)]
pub enum RouterOutput {
    /// Routed to a registered waiter (or dropped as unsolicited).
    Response,
    /// A normalized `agent.event` payload ready for renderer emission.
    Event(Value),
    /// A well-formed notification whose content failed validation; never emitted.
    Ignored,
}

/// Routes child stdout lines: responses to their registered waiters, `agent.event`
/// notifications to the caller, everything else rejected as a protocol fault.
#[derive(Default)]
pub struct JsonRpcRouter {
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
}

impl JsonRpcRouter {
    pub fn register(&self, id: u64) -> Result<PendingReply, String> {
        let mut pending = lock_unpoison(&self.pending);
        if pending.contains_key(&id) {
            return Err("duplicate_agent_request_id".into());
        }
        let (sender, receiver) = oneshot::channel();
        pending.insert(id, sender);
        Ok(PendingReply { receiver })
    }

    /// Removes a waiter after a failed write so it cannot leak.
    pub fn abandon(&self, id: u64) {
        lock_unpoison(&self.pending).remove(&id);
    }

    /// Fails every outstanding request (child exit or fatal protocol fault).
    pub fn fail_all(&self, error: &str) {
        for (_, sender) in lock_unpoison(&self.pending).drain() {
            let _ = sender.send(Err(error.to_string()));
        }
    }

    pub fn accept_line(&self, line: &str) -> Result<RouterOutput, String> {
        let value: Value =
            serde_json::from_str(line).map_err(|_| "invalid_agent_protocol".to_string())?;
        if value.get("method").is_some() {
            let notification: AgentNotification =
                serde_json::from_value(value).map_err(|_| "invalid_agent_protocol".to_string())?;
            self.accept_notification(notification)
        } else {
            let response: AgentResponse =
                serde_json::from_value(value).map_err(|_| "invalid_agent_protocol".to_string())?;
            self.accept_response(response)
        }
    }

    fn accept_response(&self, response: AgentResponse) -> Result<RouterOutput, String> {
        if response.jsonrpc != JSONRPC_VERSION || response.id > MAX_SAFE_REQUEST_ID {
            return Err("invalid_agent_protocol".into());
        }
        match (response.result, response.error) {
            (Some(result), None) => {
                if let Some(sender) = lock_unpoison(&self.pending).remove(&response.id) {
                    let _ = sender.send(Ok(result));
                }
                Ok(RouterOutput::Response)
            }
            (None, Some(error)) => {
                if let Some(sender) = lock_unpoison(&self.pending).remove(&response.id) {
                    let _ = sender.send(Err(error.code));
                }
                Ok(RouterOutput::Response)
            }
            (Some(_), Some(_)) | (None, None) => Err("invalid_agent_protocol".into()),
        }
    }

    fn accept_notification(&self, notification: AgentNotification) -> Result<RouterOutput, String> {
        if notification.jsonrpc != JSONRPC_VERSION || notification.method != AGENT_EVENT_METHOD {
            return Err("invalid_agent_protocol".into());
        }
        match normalize_agent_event(&notification.params) {
            Some(event) => Ok(RouterOutput::Event(event)),
            None => Ok(RouterOutput::Ignored),
        }
    }
}

/// Resolves to the kernel reply, or to `agent_process_exited` when the waiter is
/// abandoned or the routing channel closes before a reply arrives.
#[derive(Debug)]
pub struct PendingReply {
    receiver: oneshot::Receiver<Result<Value, String>>,
}

impl std::future::Future for PendingReply {
    type Output = Result<Value, String>;

    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        match Pin::new(&mut self.receiver).poll(cx) {
            Poll::Ready(Ok(reply)) => Poll::Ready(reply),
            Poll::Ready(Err(_)) => Poll::Ready(Err("agent_process_exited".into())),
            Poll::Pending => Poll::Pending,
        }
    }
}

/// Validates an `agent.event` params object against the kernel's declared bounds
/// (`runId`/`type` short fields, bounded payload) before renderer emission.
fn normalize_agent_event(params: &Value) -> Option<Value> {
    let run_id = bounded_short_field(params.get("runId")?)?;
    let event_type = bounded_short_field(params.get("type")?)?;
    let payload = params.get("payload")?;
    let payload_bytes = serde_json::to_vec(payload).ok()?;
    if payload_bytes.len() > MAX_EVENT_PAYLOAD_BYTES {
        return None;
    }
    Some(serde_json::json!({
        "runId": run_id,
        "type": event_type,
        "payload": payload,
    }))
}

fn bounded_short_field(value: &Value) -> Option<&str> {
    let text = value.as_str()?;
    let trimmed = text.trim();
    if trimmed.is_empty() || text.chars().count() > MAX_SHORT_FIELD_CHARACTERS {
        return None;
    }
    Some(text)
}

fn lock_unpoison<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn routes_responses_to_the_matching_request() {
        let router = JsonRpcRouter::default();
        let waiting = router.register(7).unwrap();
        router
            .accept_line(r#"{"jsonrpc":"2.0","id":7,"result":{"status":"ok"}}"#)
            .unwrap();
        assert_eq!(waiting.await.unwrap()["status"], "ok");
    }

    #[test]
    fn rejects_stdout_that_is_not_json_rpc() {
        let router = JsonRpcRouter::default();
        assert_eq!(
            router.accept_line("debug text").unwrap_err(),
            "invalid_agent_protocol"
        );
    }

    #[test]
    fn rejects_envelopes_with_a_foreign_protocol_version() {
        let router = JsonRpcRouter::default();

        assert_eq!(
            router
                .accept_line(r#"{"jsonrpc":"1.0","id":1,"result":{}}"#)
                .unwrap_err(),
            "invalid_agent_protocol"
        );
        assert_eq!(
            router
                .accept_line(r#"{"jsonrpc":"1.0","method":"agent.event","params":{}}"#)
                .unwrap_err(),
            "invalid_agent_protocol"
        );
    }

    #[test]
    fn rejects_responses_carrying_both_result_and_error() {
        let router = JsonRpcRouter::default();

        assert_eq!(
            router
                .accept_line(
                    r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true},"error":{"code":"internal_error","message":"Internal kernel error."}}"#
                )
                .unwrap_err(),
            "invalid_agent_protocol"
        );
    }

    #[test]
    fn rejects_responses_carrying_neither_result_nor_error() {
        let router = JsonRpcRouter::default();

        assert_eq!(
            router
                .accept_line(r#"{"jsonrpc":"2.0","id":1}"#)
                .unwrap_err(),
            "invalid_agent_protocol"
        );
    }

    #[test]
    fn treats_null_ids_as_unsolicited_protocol_faults() {
        let router = JsonRpcRouter::default();

        assert_eq!(
            router
                .accept_line(
                    r#"{"jsonrpc":"2.0","id":null,"error":{"code":"invalid_request","message":"Invalid JSON-RPC request."}}"#
                )
                .unwrap_err(),
            "invalid_agent_protocol"
        );
    }

    #[test]
    fn treats_unsafe_integer_ids_as_unsolicited_protocol_faults() {
        let router = JsonRpcRouter::default();
        let unsafe_id = 9_007_199_254_740_992_u64;

        assert_eq!(
            router
                .accept_line(&format!(
                    r#"{{"jsonrpc":"2.0","id":{unsafe_id},"result":{{}}}}"#
                ))
                .unwrap_err(),
            "invalid_agent_protocol"
        );
    }

    #[tokio::test]
    async fn delivers_kernel_error_codes_to_the_waiting_caller() {
        let router = JsonRpcRouter::default();
        let waiting = router.register(3).unwrap();

        router
            .accept_line(
                r#"{"jsonrpc":"2.0","id":3,"error":{"code":"invalid_params","message":"Invalid method parameters."}}"#,
            )
            .unwrap();

        assert_eq!(waiting.await.unwrap_err(), "invalid_params");
    }

    #[test]
    fn rejects_duplicate_registrations_of_one_request_id() {
        let router = JsonRpcRouter::default();
        router.register(5).unwrap();

        assert_eq!(
            router.register(5).unwrap_err(),
            "duplicate_agent_request_id"
        );
    }

    #[test]
    fn drops_responses_without_registered_waiters() {
        let router = JsonRpcRouter::default();

        assert!(router
            .accept_line(r#"{"jsonrpc":"2.0","id":11,"result":{"late":true}}"#)
            .is_ok());
    }

    #[tokio::test]
    async fn abandons_pending_requests_without_delivering_a_response() {
        let router = JsonRpcRouter::default();
        let waiting = router.register(9).unwrap();
        router.abandon(9);
        assert_eq!(waiting.await.unwrap_err(), "agent_process_exited");
    }

    #[tokio::test]
    async fn fails_every_pending_request_on_exit_or_fault() {
        let router = JsonRpcRouter::default();
        let first = router.register(1).unwrap();
        let second = router.register(2).unwrap();

        router.fail_all("agent_process_exited");

        assert_eq!(first.await.unwrap_err(), "agent_process_exited");
        assert_eq!(second.await.unwrap_err(), "agent_process_exited");
    }

    #[test]
    fn forwards_agent_event_notifications_with_normalized_fields() {
        let router = JsonRpcRouter::default();

        let forwarded = router
            .accept_line(
                r#"{"jsonrpc":"2.0","method":"agent.event","params":{"runId":"run-1","type":"item.completed","payload":{"text":"hi"}}}"#,
            )
            .unwrap();

        assert_eq!(
            forwarded,
            RouterOutput::Event(json!({
                "runId": "run-1",
                "type": "item.completed",
                "payload": { "text": "hi" }
            }))
        );
    }

    #[test]
    fn rejects_unknown_notification_methods() {
        let router = JsonRpcRouter::default();

        assert_eq!(
            router
                .accept_line(
                    r#"{"jsonrpc":"2.0","method":"kernel.internal","params":{"secret":1}}"#
                )
                .unwrap_err(),
            "invalid_agent_protocol"
        );
    }

    #[test]
    fn drops_events_that_fail_field_validation_before_emission() {
        let oversized_payload = "x".repeat(256 * 1024 + 1);
        let invalid = [
            json!({ "runId": "", "type": "item.completed", "payload": {} }),
            json!({ "type": "item.completed", "payload": {} }),
            json!({ "runId": "run-1", "payload": {} }),
            json!({ "runId": "run-1", "type": "  ", "payload": {} }),
            json!({ "runId": "r".repeat(161), "type": "item", "payload": {} }),
            json!({ "runId": "run-1", "type": 7, "payload": {} }),
            json!({ "runId": "run-1", "type": "item", "payload": oversized_payload }),
        ];
        for params in invalid {
            assert!(
                normalize_agent_event(&params).is_none(),
                "accepted invalid event params: {params}"
            );
        }
    }
}
