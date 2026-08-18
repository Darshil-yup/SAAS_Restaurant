# 📁 Darshil Docs — Automated Developer & Tester Audit Repository

Welcome to **Darshil Docs**, the authoritative audit log and testing repository for the SAAS Restaurant POS & KDS platform.

## 📌 Standard Operating Procedure (SOP) for Agents & Developers

For **every code modification or feature addition**, the assistant/developer **MUST**:

1. **Document WHAT changed**: List exact files, lines, endpoints, component props, database queries, and architectural modules created or edited.
2. **Document WHY it changed**: Detail the root cause, bug symptoms, business requirement, or architectural rationale for the change.
3. **Provide Comprehensive Test Cases**:
   - Test Case ID & Title
   - Pre-conditions & Environment Setup
   - Step-by-step Execution Steps
   - Expected vs Actual Behavior
   - Automated/Manual Verification Commands & Log Outputs
4. **Maintain Timestamped Audit Logs**: Save individual reports in `Darshil_docs/reports/` using the format `YYYY-MM-DD_HHMMSS_<feature_name>.md`.

---

## 🗂 Index of Timestamped Change & Test Reports

| Date & Timestamp | Report Document | Primary Scope / Feature | Status |
|---|---|---|---|
| 2026-08-18T18:31:12+05:30 | [`report_2026-08-18_hub_performance_idempotency_dashboard.md`](./reports/report_2026-08-18_hub_performance_idempotency_dashboard.md) | Async non-blocking I/O, Request Idempotency (`order_request_id`), Live Hub Operational Dashboard (`/dashboard`), & Full-Bleed PWA UI Cleanup | ✅ VERIFIED & COMMITTED |
