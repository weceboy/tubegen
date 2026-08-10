# Providers

Provider interfaces keep business logic independent from external vendors.

Current interfaces:

- `LLMProvider`
- `ResearchProvider`

Mock implementations are included so the backend can be developed without external service configuration. Real adapters can be added behind the same interfaces.

The database model remains provider-neutral and stores provider metadata only where the canonical schema defines it.
