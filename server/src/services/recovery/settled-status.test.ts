import { describe, expect, it } from "vitest";
import {
  strandedRecoverySettledStatus,
  strandedRecoveryUnblockDescriptor,
} from "./service.js";

// TES-2107. A recovery that only records "this run did not finish" must leave
// the task actionable. Blocking it produced a hold with no blocker and no
// unblock descriptor, which nothing could clear and no heartbeat could see.
describe("strandedRecoverySettledStatus", () => {
  it.each([
    "stranded_assigned_issue",
    "process_lost",
    "codex_output_inactivity_monitor",
    "native_session_interrupted",
    "native_runner_process_exited",
    "provider_transport_failed",
    "provider_frame_too_large",
  ] as const)("returns %s to todo", (cause) => {
    expect(
      strandedRecoverySettledStatus({ cause, blockerIssueIds: [], ownerCanRun: true }),
    ).toBe("todo");
  });

  it.each([
    "workspace_validation_failed",
    "configuration_incomplete",
    "provider_quota",
    "execution_review_participant_recovery",
    "deliberate_wait_without_target",
  ] as const)("holds %s at blocked", (cause) => {
    expect(
      strandedRecoverySettledStatus({ cause, blockerIssueIds: [], ownerCanRun: true }),
    ).toBe("blocked");
  });

  // TES-2562. This cause is not "the run did not finish" — the run finished and
  // one named agent owes one named write. `todo` says nobody started, which is
  // false, and two finished rows re-entered the assignment pool because of it.
  // `blocked` is honest here only because the descriptor names the exit.
  it("holds a missing disposition at blocked and names the owner and the write", () => {
    expect(
      strandedRecoverySettledStatus({
        cause: "successful_run_missing_state",
        blockerIssueIds: [],
        ownerCanRun: true,
      }),
    ).toBe("blocked");

    const descriptor = strandedRecoveryUnblockDescriptor({
      cause: "successful_run_missing_state",
      blockerIssueIds: [],
      sourceAssigneeAgentId: "agent-1",
      ownerCanRun: true,
    });
    expect(descriptor?.owner).toEqual({ agentId: "agent-1" });
    expect(descriptor?.action).toContain("status write");
    expect(descriptor?.action).toContain("a comment does not clear this");
  });

  // An owner that cannot run cannot make the write, so the exit is the board's.
  it("hands the missing-disposition repair to the board when the owner cannot run", () => {
    const descriptor = strandedRecoveryUnblockDescriptor({
      cause: "successful_run_missing_state",
      blockerIssueIds: [],
      sourceAssigneeAgentId: "agent-1",
      ownerCanRun: false,
    });
    expect(descriptor?.owner).toBe("board");
  });

  // A real dependency already names the exit; a descriptor would compete with it.
  it("leaves the descriptor off when a first-class blocker already names the exit", () => {
    expect(
      strandedRecoveryUnblockDescriptor({
        cause: "successful_run_missing_state",
        blockerIssueIds: ["issue-1"],
        sourceAssigneeAgentId: "agent-1",
        ownerCanRun: true,
      }),
    ).toBeNull();
  });

  // Causes that mean "this run did not finish" get no descriptor: nothing is
  // owed, the work just needs running again.
  it("leaves the descriptor off for causes that settle to todo", () => {
    expect(
      strandedRecoveryUnblockDescriptor({
        cause: "process_lost",
        blockerIssueIds: [],
        sourceAssigneeAgentId: "agent-1",
        ownerCanRun: true,
      }),
    ).toBeNull();
  });

  it("lets a first-class blocker outrank an otherwise actionable cause", () => {
    expect(
      strandedRecoverySettledStatus({
        cause: "successful_run_missing_state",
        blockerIssueIds: ["issue-1"],
        ownerCanRun: true,
      }),
    ).toBe("blocked");
  });

  // `todo` would promise a pickup nothing can deliver: a paused, terminated or
  // budget-stopped owner is the one case where the work really is held.
  it("holds an actionable cause at blocked when the owner cannot run", () => {
    expect(
      strandedRecoverySettledStatus({
        cause: "stranded_assigned_issue",
        blockerIssueIds: [],
        ownerCanRun: false,
      }),
    ).toBe("blocked");
  });
});
