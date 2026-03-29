import type { ActivityType, AssignmentContext } from "@/lib/activities/types";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Looks up the highest-version published blueprint for a class and returns its
 * id.
 *
 * Throws if no published blueprint exists so callers can surface a clear
 * "publish a blueprint first" error rather than silently creating an assignment
 * with a null blueprint reference.
 *
 * @param supabase  A server-side Supabase client (already authenticated).
 * @param classId   UUID of the class to look up the blueprint for.
 * @returns         The published blueprint's UUID.
 */
export async function requirePublishedBlueprintId(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  classId: string,
) {
  const { data: publishedBlueprint, error: publishedBlueprintError } = await supabase
    .from("blueprints")
    .select("id")
    .eq("class_id", classId)
    .eq("status", "published")
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (publishedBlueprintError) {
    throw new Error(publishedBlueprintError.message);
  }

  if (!publishedBlueprint) {
    throw new Error("Publish a blueprint before creating assignments.");
  }

  return publishedBlueprint.id;
}

/**
 * Creates an assignment for all currently enrolled students in a class.
 *
 * **Why a manual rollback closure instead of a DB transaction?**
 * Supabase's PostgREST client does not expose explicit transaction control.
 * Instead, we perform a manual two-phase write (assignment row first, then
 * recipient rows) and capture a rollback closure immediately after the first
 * write succeeds.  If the second write fails, the closure deletes the orphaned
 * assignment row so the DB is left in a consistent state.
 *
 * The closure pattern is used (rather than a flag at the call site) because
 * the rollback needs to close over the freshly generated `assignment.id`
 * returned by the insert — a value that only exists after the first DB call
 * and is not available to the outer scope before the insert completes.
 *
 * **Write sequencing:**
 * 1. Insert the `assignments` row — this is the authoritative record of the
 *    assignment; students will not see it until the `assignment_recipients`
 *    rows exist.
 * 2. Fetch enrolled students.
 * 3. Insert `assignment_recipients` rows — one per student.
 *
 * If step 3 fails after step 1 has committed, `rollbackAssignment` deletes
 * the `assignments` row.  Note: if the rollback itself fails, the combined
 * error message surfaces both failure causes so an operator can clean up
 * manually.
 *
 * @param input.supabase     Server-side Supabase client.
 * @param input.classId      UUID of the target class.
 * @param input.activityId   UUID of the activity being assigned.
 * @param input.teacherId    UUID of the teacher creating the assignment.
 * @param input.dueAt        Optional ISO-8601 due date, or null for no due date.
 * @returns                  The newly created assignment's UUID.
 */
export async function createWholeClassAssignment(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  activityId: string;
  teacherId: string;
  dueAt: string | null;
}) {
  // --- Assignment insert ---

  const { data: assignment, error: assignmentError } = await input.supabase
    .from("assignments")
    .insert({
      class_id: input.classId,
      activity_id: input.activityId,
      assigned_by: input.teacherId,
      due_at: input.dueAt,
    })
    .select("id")
    .single();

  if (assignmentError || !assignment) {
    throw new Error(assignmentError?.message ?? "Failed to create assignment.");
  }

  // --- Rollback registration ---
  // Capture assignment.id in a closure so the rollback can delete exactly
  // this row if a subsequent step fails.  The class_id filter is a belt-and-
  // suspenders guard against deleting rows in a different class.
  const rollbackAssignment = async () => {
    const { error } = await input.supabase
      .from("assignments")
      .delete()
      .eq("id", assignment.id)
      .eq("class_id", input.classId);

    return error;
  };

  // --- Fetch enrolled students ---

  const { data: students, error: studentsError } = await input.supabase
    .from("enrollments")
    .select("user_id")
    .eq("class_id", input.classId)
    .eq("role", "student");

  if (studentsError) {
    // The assignment row exists but we can't fetch recipients — roll it back.
    const rollbackError = await rollbackAssignment();
    if (rollbackError) {
      throw new Error(`${studentsError.message} (rollback failed: ${rollbackError.message})`);
    }

    throw new Error(studentsError.message);
  }

  // --- Recipient insert ---
  // If the class has no enrolled students we skip the insert entirely.
  // Once students enroll after the assignment is created they will be
  // handled by the enrollment trigger (separate concern).

  if ((students ?? []).length > 0) {
    const recipients = students!.map((student) => ({
      assignment_id: assignment.id,
      student_id: student.user_id,
      status: "assigned",
    }));

    const { error: recipientsError } = await input.supabase
      .from("assignment_recipients")
      .insert(recipients);

    if (recipientsError) {
      // Recipient insert failed — delete the orphaned assignment row.
      const rollbackError = await rollbackAssignment();
      if (rollbackError) {
        throw new Error(`${recipientsError.message} (rollback failed: ${rollbackError.message})`);
      }

      throw new Error(recipientsError.message);
    }
  }

  return assignment.id;
}

/**
 * Loads the full assignment context for a student viewing an assigned activity.
 *
 * Verifies in order:
 * 1. The student is a recipient of this assignment.
 * 2. The assignment exists and belongs to the given class.
 * 3. The activity exists, belongs to the class, and (optionally) matches the
 *    expected activity type.
 *
 * Throws on any missing or mismatched entity so the caller can return a 404
 * or 403 rather than rendering a partial or incorrect UI.
 *
 * @param input.supabase       Server-side Supabase client.
 * @param input.classId        UUID of the class containing the assignment.
 * @param input.assignmentId   UUID of the assignment to load.
 * @param input.userId         UUID of the student requesting access.
 * @param input.expectedType   Optional activity type check (e.g., "quiz"); throws
 *                             if the activity's type does not match.
 * @returns  A fully populated `AssignmentContext` ready for the activity page.
 */
export async function loadStudentAssignmentContext(input: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  classId: string;
  assignmentId: string;
  userId: string;
  expectedType?: ActivityType;
}) {
  const { data: recipient, error: recipientError } = await input.supabase
    .from("assignment_recipients")
    .select("assignment_id,status")
    .eq("assignment_id", input.assignmentId)
    .eq("student_id", input.userId)
    .maybeSingle();

  if (recipientError || !recipient) {
    throw new Error("You are not assigned to this activity.");
  }

  const { data: assignment, error: assignmentError } = await input.supabase
    .from("assignments")
    .select("id,class_id,activity_id,due_at")
    .eq("id", input.assignmentId)
    .eq("class_id", input.classId)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found.");
  }

  const { data: activity, error: activityError } = await input.supabase
    .from("activities")
    .select("id,title,type,status,config")
    .eq("id", assignment.activity_id)
    .eq("class_id", input.classId)
    .single();

  if (activityError || !activity) {
    throw new Error("Assignment activity not found.");
  }

  if (input.expectedType && activity.type !== input.expectedType) {
    throw new Error(`This assignment is not a ${input.expectedType} activity.`);
  }

  // Coerce the JSONB `config` column to a plain object.  Supabase returns it
  // as `unknown` so we guard against null or non-object values before casting.
  const safeConfig =
    activity.config && typeof activity.config === "object"
      ? (activity.config as Record<string, unknown>)
      : {};

  const context: AssignmentContext = {
    assignment,
    activity: {
      id: activity.id,
      title: activity.title,
      type: activity.type as ActivityType,
      status: activity.status,
      config: safeConfig,
    },
    recipient,
  };

  return context;
}
