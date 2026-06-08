# Test Plan: [Product Name]

## Test Strategy
- **Unit test framework**: [jest / pytest / etc.]
- **Integration test approach**: [in-memory DB / test containers / mock server]
- **E2E test approach**: [playwright / cypress / manual flows]

## Test Matrix

### Module: [Name]

| Test ID | Scenario | Type | Input | Expected Output | Priority |
|---------|----------|------|-------|-----------------|----------|
| T-001 | | unit/intg/e2e | | | P0/P1/P2 |

### Critical User Flows

| Flow | Steps | Assertions | Covered By |
|------|-------|------------|------------|
| | | | T-XXX |

## Coverage Targets
- Unit: ≥80% line coverage on business logic
- Integration: 100% of API endpoints
- E2E: 100% of PRD user flows (happy path)

## Risk-Based Prioritization
- **P0 (must test)**: Auth, payments, data integrity, core flows
- **P1 (should test)**: Error handling, edge cases, concurrent access
- **P2 (nice to test)**: Performance, accessibility, UI polish
