# Analysis availability UI fix

The evidence status API now reports current AI availability. When the provider is not configured, the interface shows a neutral saved-upload/manual-review explanation and an Add information manually button instead of an unusable analysis retry. A configuration failure is no longer shown as a green Processing status updated success. The retry control becomes available again when the server reports READY.

Validation: 3 UI tests and 29 evidence/API regression tests passed (32 total); the production build passed. The actual claim screen was inspected and showed the manual-review guidance without an analysis retry button.

This UI fix does not activate an unconfigured provider. Live extraction still requires the existing server ANTHROPIC_API_KEY and CLAUDE_MODEL settings. No credentials were generated or embedded.

Changed files: backend/src/app.js, frontend/src/components/EvidenceAnalysis.jsx, frontend/src/theme.css, backend/tests/analysis-unavailable.test.jsx, and this note.
