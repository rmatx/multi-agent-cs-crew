/**
 * CSAT submit (F-CSAT-01).
 *
 * Boundary note (`@frontend.eng` → `@integration.eng`): the persona rule says the frontend
 * does not connect to backend endpoints. This module is the seam that keeps that true of the
 * COMPONENTS — `CsatPrompt` knows only `submitCsat(...)`, exactly as the composer knows only
 * `runTurn(...)`. The endpoint shape lives here beside `turnService.ts`, where integration
 * already owns it, rather than being spread through JSX.
 *
 * It never throws. A failed rating is worth a quiet inline message and nothing more: nobody
 * should lose their answer, or see an error dialog, because a satisfaction survey did not save.
 */

export type CsatOutcome = { ok: true } | { ok: false; message: string };

export async function submitCsat(
  conversationId: string,
  score: number,
  comment?: string,
): Promise<CsatOutcome> {
  try {
    const response = await fetch(
      `/api/conversations/${encodeURIComponent(conversationId)}/csat`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(comment && comment.trim().length > 0 ? { score, comment } : { score }),
      },
    );
    if (response.ok) return { ok: true };
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    return { ok: false, message: body?.message ?? "That rating did not save." };
  } catch {
    return { ok: false, message: "That rating did not save." };
  }
}
