// AI completion commands, split by protocol. Job cancellation and the retry policy are
// shared; each provider family owns its own request shaping and response parsing.
mod anthropic;
mod jobs;
mod openai_compat;
mod retry;

pub use anthropic::*;
pub use jobs::*;
pub use openai_compat::*;

use serde_json::Value;

const MAX_LLM_REQUEST_BYTES: usize = 256 * 1024;

/// Matched by the `output budget` branch of src/features/workflow/errors.ts. Reword only
/// alongside that branch — see src-tauri/src/error_contract.rs.
pub(crate) const REQUEST_TOO_LARGE_MESSAGE: &str =
    "The request exceeds the 256 KB limit — split the batch and retry";
/// Matches the Codex `--output-schema` ceiling, so every provider caps a schema alike.
const MAX_OUTPUT_SCHEMA_BYTES: usize = 128 * 1024;

/// Validate `request.output_schema` before it is forwarded to a provider's structured
/// output mechanism. Absent is fine — that path just falls back to prompt-only JSON.
///
/// The engine builds these schemas itself (engine/classify/llm.ts); the check is here
/// because everything arriving from the webview is treated as untrusted at this boundary.
pub(super) fn output_schema(request: &Value) -> Result<Option<&Value>, String> {
    let Some(schema) = request.get("output_schema") else {
        return Ok(None);
    };
    if schema.is_null() {
        return Ok(None);
    }
    if !schema.is_object() {
        return Err("request.output_schema must be a JSON object".into());
    }
    let encoded = serde_json::to_vec(schema).map_err(|e| format!("serialize schema: {e}"))?;
    if encoded.len() > MAX_OUTPUT_SCHEMA_BYTES {
        return Err("request.output_schema exceeds the 128 KB limit".into());
    }
    Ok(Some(schema))
}

pub(super) fn serialize_capped(payload: &Value) -> Result<Vec<u8>, String> {
    let body = serde_json::to_vec(payload).map_err(|e| format!("serialize request: {e}"))?;
    if body.len() > MAX_LLM_REQUEST_BYTES {
        return Err(REQUEST_TOO_LARGE_MESSAGE.into());
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn absent_or_null_schema_is_not_an_error() {
        assert!(output_schema(&json!({})).unwrap().is_none());
        assert!(output_schema(&json!({ "output_schema": null }))
            .unwrap()
            .is_none());
    }

    #[test]
    fn a_non_object_schema_is_rejected() {
        for bad in [json!("{}"), json!([]), json!(7), json!(true)] {
            let request = json!({ "output_schema": bad });
            assert!(output_schema(&request).is_err(), "accepted {bad}");
        }
    }

    #[test]
    fn an_object_schema_is_passed_through_unchanged() {
        let request = json!({
            "output_schema": { "type": "object", "additionalProperties": false }
        });
        let schema = output_schema(&request).unwrap().expect("schema");
        assert_eq!(schema, &request["output_schema"]);
    }

    #[test]
    fn an_oversized_schema_is_rejected() {
        let request = json!({
            "output_schema": { "description": "x".repeat(MAX_OUTPUT_SCHEMA_BYTES + 1) }
        });
        assert!(output_schema(&request).is_err());
    }
}
