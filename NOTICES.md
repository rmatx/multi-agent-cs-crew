# NOTICES

Third-party content and attribution for this repository.

## Design influence — react-bits (no code included)

The frontend's waiting state, streaming caret and message-entrance transitions were informed by
patterns catalogued in [react-bits](https://github.com/DavidHDev/react-bits) by David Haz.

**No react-bits source is vendored, copied or depended on here.** That library is distributed
under **MIT + Commons Clause**, and the Commons Clause restricts selling software whose value
derives substantially from it — a term worth knowing about before copying components into a
product, even though this project would not trip it. The patterns implemented here are written
from scratch in plain CSS, which also keeps the project's zero-added-dependency position: most
react-bits components require `framer-motion` or `gsap`, and this repository has taken no
runtime dependency it does not need — not even a test framework.

Recorded because AAMAD core requires third-party content to be attributed, and because "we took
the idea, not the code, and here is why that distinction mattered" is the honest description.
