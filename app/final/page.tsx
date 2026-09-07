/**
 * `/final` — the reviewer surface.
 *
 * Same application as `/`, with three differences and no fourth:
 *
 *   1. `forceDemo` — the crew strip, the scenario picker, the handoff packet and the operator
 *      trace are on at mount, with no query string to remember and no platform variable that
 *      has to be set right. The route IS the switch.
 *   2. The run sheet — the 23 scenarios this build is known to handle, linked as the workbook
 *      rather than retyped here, so the list a reviewer tests against is the same artifact
 *      `npm run demo:build` regenerates and cannot silently fall behind the fixture.
 *   3. A password, enforced in `middleware.ts` and NOT here. A gate drawn in a React component
 *      is a gate that has already served the page it is guarding.
 *
 * Deliberately NOT a different app, a different engine, or a different set of tools. A demo
 * surface that runs something other than what `/` runs demonstrates the demo surface.
 */

import ChatApp from "@/components/ChatApp";
import ReviewerHeader from "@/components/ReviewerHeader";

/* No reason for a search engine to hold this, gate or no gate. */
export const metadata = {
  title: "NovaMart Support — reviewer build",
  robots: { index: false, follow: false },
};

export default function FinalPage() {
  return (
    <>
      <ReviewerHeader />
      <ChatApp forceDemo />
    </>
  );
}
