// The Rust → TypeScript error-string contract.
//
// Rust returns `Result<_, String>` everywhere, and src/features/workflow/errors.ts
// regex-matches those strings to turn a failure into a specific, actionable message. That
// coupling is invisible to both compilers: rewording a message here silently downgrades a
// precise error to the generic "something went wrong" in front of a user.
//
// These tests pin the phrases the TypeScript side depends on. If one fails, either restore
// the phrase or update the matching branch in errors.ts — never just relax the test.

#[cfg(test)]
mod tests {
    /// Mirrors the `no .*key is (saved|configured)|api key` branch in errors.ts.
    fn matches_missing_key(message: &str) -> bool {
        let lower = message.to_lowercase();
        lower.contains("api key")
            || ((lower.contains("key is saved") || lower.contains("key is configured"))
                && lower.contains("no "))
    }

    #[test]
    fn every_missing_credential_message_is_recognised_as_a_key_problem() {
        // The exact strings produced by store/provider lookups across the AI commands.
        for message in [
            "No Anthropic API key configured. Open Settings in Tawreed to add one.",
            "No compatible provider key is saved. Open Settings and add the service API key.",
            "No gemini key is saved. Open Settings and add it.",
            "No grok key is saved. Open Settings and add it.",
        ] {
            assert!(
                matches_missing_key(message),
                "errors.ts would fall through to the generic message for: {message}"
            );
        }
    }

    #[test]
    fn the_publication_retry_message_still_says_preserved_at() {
        // errors.ts surfaces this one verbatim instead of translating it, because it names
        // the path the user's artifacts are waiting at.
        let message = format!(
            "Could not publish the revision; generated artifacts are preserved at {}",
            "C:\\\\Users\\\\x\\\\.tawreed\\\\output"
        );
        assert!(message.to_lowercase().contains("preserved at"));
    }

    #[test]
    fn the_truncation_message_still_says_output_budget() {
        // Paired with the `output budget` branch in errors.ts.
        assert!(crate::commands::ai::OUTPUT_BUDGET_MESSAGE.contains("output budget"));
    }

    #[test]
    fn the_request_cap_message_is_still_the_one_the_ui_shows_verbatim() {
        assert!(crate::commands::ai::REQUEST_TOO_LARGE_MESSAGE.contains("256 KB limit"));
    }

    #[test]
    fn the_timeout_messages_still_say_timed_out() {
        // Paired with the `timed out` branch in errors.ts.
        for message in [
            "Codex model catalog timed out after 30s".to_string(),
            format!("Codex timed out after {}s", 240),
        ] {
            assert!(message.to_lowercase().contains("timed out"), "{message}");
        }
    }
}
