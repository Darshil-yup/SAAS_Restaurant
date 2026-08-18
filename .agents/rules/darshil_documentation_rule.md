# Rule: Darshil Docs Automated Engineering & Testing Reports

**Applies to**: All code additions, modifications, architectural updates, and bug fixes in this repository.

---

## Mandate

Whenever any code or project asset is added, modified, or refactored:

1. **Maintain Audit Reports**:
   - Create or update a timestamped report file in `Darshil_docs/reports/` named `report_YYYY-MM-DD_<feature_name>.md`.
   - Update the master index table in `Darshil_docs/README.md`.

2. **Report Structure Requirements**:
   - **Timestamp & Author Metadata**: Exact ISO timestamp (`2026-08-18T18:31:12+05:30`) and Git Commit Hash.
   - **What Changed**: Itemized list of files, functions, routes, database tables, and UI components created or modified.
   - **Why It Changed**: Detailed technical rationale, root cause analysis, and business objectives.
   - **Test Cases**:
     - Pre-conditions & setup.
     - Execution steps.
     - Expected vs actual behavior.
     - Pass/Fail verification results.

3. **Git Integration**:
   - All reports in `Darshil_docs/` must be staged and committed alongside code changes.
